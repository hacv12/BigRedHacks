import type { CityDataset, LngLat } from './types';
export interface LocalPlace {
  id: string;
  name: string;
  kind: 'landmark' | 'street';
  point: LngLat;
}
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/g, ' ');
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Street results are graph-node references, never inferred entrances or addresses. */
export function buildPlaceIndex(data: CityDataset): LocalPlace[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, { name: string; nodeIds: Set<string> }>();
  for (const edge of data.edges) {
    const name = edge.name.trim(),
      key = normalize(name);
    if (
      !key ||
      /^(walking\s*path|steps|unnamed\s*street|unnamed walking connection)$/i.test(
        key,
      )
    )
      continue;
    const group = groups.get(key) ?? { name, nodeIds: new Set<string>() };
    if (compare(name, group.name) < 0) group.name = name;
    if (nodes.has(edge.from)) group.nodeIds.add(edge.from);
    if (nodes.has(edge.to)) group.nodeIds.add(edge.to);
    groups.set(key, group);
  }
  const places: LocalPlace[] = data.landmarks.map((landmark) => ({
    id: `landmark:${landmark.id}`,
    name: landmark.name,
    kind: 'landmark',
    point: [...landmark.point],
  }));
  for (const [key, group] of groups) {
    const candidates = [...group.nodeIds]
      .map((id) => nodes.get(id)!)
      .filter((node) => node.point.every(Number.isFinite));
    if (!candidates.length) continue;
    const bounds = candidates.reduce(
      (b, node) => [
        Math.min(b[0], node.point[0]),
        Math.min(b[1], node.point[1]),
        Math.max(b[2], node.point[0]),
        Math.max(b[3], node.point[1]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const center: LngLat = [
      (bounds[0] + bounds[2]) / 2,
      (bounds[1] + bounds[3]) / 2,
    ];
    const scale = Math.cos((center[1] * Math.PI) / 180);
    const distance = (point: LngLat) =>
      ((point[0] - center[0]) * scale) ** 2 + (point[1] - center[1]) ** 2;
    candidates.sort(
      (a, b) => distance(a.point) - distance(b.point) || compare(a.id, b.id),
    );
    places.push({
      id: `street:${key}`,
      name: group.name,
      kind: 'street',
      point: [...candidates[0].point],
    });
  }
  return places.sort(
    (a, b) =>
      compare(normalize(a.name), normalize(b.name)) || compare(a.id, b.id),
  );
}
export function searchPlaces(
  index: LocalPlace[],
  query: string,
  limit = 6,
): LocalPlace[] {
  const term = normalize(query);
  if (!term || !Number.isFinite(limit) || limit <= 0) return [];
  const count = Math.min(6, Math.floor(limit));
  const rank = (place: LocalPlace) =>
    normalize(place.name) === term
      ? 0
      : normalize(place.name).startsWith(term)
        ? 1
        : 2;
  return index
    .filter((place) => normalize(place.name).includes(term))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        compare(normalize(a.name), normalize(b.name)) ||
        compare(a.id, b.id),
    )
    .slice(0, count);
}
