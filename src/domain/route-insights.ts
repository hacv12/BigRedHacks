import { haversine } from './routing';
import type { CityDataset, PlannedRoute } from './types';

export interface RouteInsight {
  takeaway: string;
  extraMinutes: number;
  addedMeters: number;
  reductionPercent: number | null;
  sharedMeters: number;
  selectedOnlyMeters: number;
  fastestOnlyMeters: number;
  /** Names rank by measured length of differing edge traversals, not whole streets. */
  selectedOnlyStreets: string[];
  fastestOnlyStreets: string[];
  differentSectionsOf: string[];
  streetSummary: string;
}
const TIME_NOISE = 1 / 60; // Do not turn sub-second numerical noise into a detour.
const INDEX_NOISE = 1e-8;
function counts(ids: string[]) {
  const result = new Map<string, number>();
  for (const id of ids) result.set(id, (result.get(id) ?? 0) + 1);
  return result;
}
function named(name: string): boolean {
  return (
    !!name.trim() &&
    !/^(unnamed(?: walking connection| road| street| path)?|walking connection|walking path|footway|path|steps|pedestrian path)$/i.test(
      name.trim(),
    )
  );
}
/** Compare graph edge traversals regardless of direction; repeated traversals match once each. */
export function compareRoutes(
  selected: PlannedRoute,
  fastest: PlannedRoute,
  data: Pick<CityDataset, 'edges'>,
): RouteInsight {
  const edges = new Map(data.edges.map((edge) => [edge.id, edge]));
  const chosen = counts(selected.edgeIds),
    baseline = counts(fastest.edgeIds);
  const selectedNames = new Map<string, number>(),
    fastestNames = new Map<string, number>();
  let sharedMeters = 0,
    selectedOnlyMeters = 0,
    fastestOnlyMeters = 0;
  for (const id of new Set([...chosen.keys(), ...baseline.keys()])) {
    const edge = edges.get(id);
    if (!edge) throw new Error('Route references an unavailable street edge.');
    const meters = edge.coordinates
      .slice(1)
      .reduce(
        (sum, point, index) => sum + haversine(edge.coordinates[index], point),
        0,
      );
    if (edge.coordinates.length < 2 || !Number.isFinite(meters))
      throw new Error('Street edge geometry is invalid.');
    const a = chosen.get(id) ?? 0,
      b = baseline.get(id) ?? 0;
    sharedMeters += Math.min(a, b) * meters;
    const selectedLength = Math.max(0, a - b) * meters,
      fastestLength = Math.max(0, b - a) * meters;
    selectedOnlyMeters += selectedLength;
    fastestOnlyMeters += fastestLength;
    const name = edge.name.trim();
    if (named(name)) {
      if (selectedLength)
        selectedNames.set(
          name,
          (selectedNames.get(name) ?? 0) + selectedLength,
        );
      if (fastestLength)
        fastestNames.set(name, (fastestNames.get(name) ?? 0) + fastestLength);
    }
  }
  const top = (names: Map<string, number>) =>
    [...names]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([name]) => name);
  const selectedOnlyStreets = top(selectedNames),
    fastestOnlyStreets = top(fastestNames);
  const differentSectionsOf = top(
    new Map([...selectedNames].filter(([name]) => fastestNames.has(name))),
  );
  const extraMinutes = selected.minutes - fastest.minutes;
  const addedMeters = selected.meters - fastest.meters;
  const sameGeometry = selectedOnlyMeters < 0.001 && fastestOnlyMeters < 0.001;
  const reductionPercent =
    Number.isFinite(fastest.exposure) &&
    fastest.exposure > INDEX_NOISE &&
    Number.isFinite(selected.exposure) &&
    selected.exposure >= 0
      ? (100 * (fastest.exposure - selected.exposure)) / fastest.exposure
      : null;
  const time =
    Math.abs(extraMinutes) <= TIME_NOISE
      ? 'About the same walking time'
      : extraMinutes < 0
        ? `${Math.abs(extraMinutes) < 1 ? 'Less than 1' : Math.round(Math.abs(extraMinutes))} minute${Math.abs(extraMinutes) < 1 || Math.round(Math.abs(extraMinutes)) === 1 ? '' : 's'} less walking`
        : extraMinutes < 1
          ? 'Less than 1 extra minute'
          : `About ${Math.round(extraMinutes)} extra minute${Math.round(extraMinutes) === 1 ? '' : 's'}`;
  const percentage =
    reductionPercent === null
      ? ''
      : Math.abs(reductionPercent) < 1
        ? 'less than 1%'
        : `${Math.round(Math.abs(reductionPercent))}%`;
  const takeaway = sameGeometry
    ? 'This is the fastest walk’s street path.'
    : reductionPercent === null
      ? `${time}; a percentage comparison is unavailable because the baseline index is zero or unavailable.`
      : Math.abs(reductionPercent) < INDEX_NOISE
        ? `${time}, with approximately the same historical report index.`
        : `${time} for ${percentage} ${reductionPercent > 0 ? 'lower' : 'higher'} historical report index on this walk.`;
  let streetSummary = sameGeometry
    ? 'The routes use the same street sections.'
    : 'The routes use different street sections.';
  if (
    !sameGeometry &&
    (selectedOnlyStreets.length || fastestOnlyStreets.length)
  ) {
    streetSummary = [
      selectedOnlyStreets.length
        ? `Selected walk’s differing sections: ${selectedOnlyStreets.join(', ')}.`
        : 'Selected walk’s differing sections have no named street.',
      fastestOnlyStreets.length
        ? `Fastest walk’s differing sections: ${fastestOnlyStreets.join(', ')}.`
        : 'Fastest walk’s differing sections have no named street.',
      differentSectionsOf.length
        ? `Both use different sections of ${differentSectionsOf.join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return {
    takeaway,
    extraMinutes,
    addedMeters,
    reductionPercent,
    sharedMeters,
    selectedOnlyMeters,
    fastestOnlyMeters,
    selectedOnlyStreets,
    fastestOnlyStreets,
    differentSectionsOf,
    streetSummary,
  };
}
