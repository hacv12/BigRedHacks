import type {
  BucketIndex,
  CoverageArea,
  DataManifest,
  LngLat,
  PlannedRoute,
  PlanRequest,
} from './types';

export type RoutePreference = 'fastest' | 'balanced' | 'lower-exposure';
export interface SharedTrip {
  areaId: string;
  cityId: string;
  request: PlanRequest;
  preference?: RoutePreference;
}
export interface RouteExportContext {
  manifest: DataManifest;
  bucket: BucketIndex;
  maxExtraMinutes: number;
  generatedAt?: Date;
}
const preferences: RoutePreference[] = [
  'fastest',
  'balanced',
  'lower-exposure',
];
const tripKeys = [
  'trip',
  'city',
  'origin',
  'destination',
  'bucket',
  'detour',
  'route',
];
const decimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const invalid = (): never => {
  throw new Error('This shared trip link is incomplete or invalid.');
};
/** Expand the shortest roundtripping number string; never round route vertices. */
function decimalText(value: number): string {
  if (!Number.isFinite(value)) return invalid();
  if (Object.is(value, -0)) return '-0';
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const sign = value < 0 ? '-' : '';
  const [coefficient, exponent] = Math.abs(value).toString().split('e');
  const digits = coefficient.replace('.', '');
  const position = coefficient.split('.')[0].length + Number(exponent);
  if (position <= 0) return `${sign}0.${'0'.repeat(-position)}${digits}`;
  if (position >= digits.length)
    return `${sign}${digits}${'0'.repeat(position - digits.length)}`;
  return `${sign}${digits.slice(0, position)}.${digits.slice(position)}`;
}
function point(value: string | null): LngLat {
  if (!value) return invalid();
  const parts = value.split(',');
  if (parts.length !== 2 || parts.some((v) => !decimal.test(v)))
    return invalid();
  const pair = parts.map(Number) as LngLat;
  if (
    !pair.every(Number.isFinite) ||
    Math.abs(pair[0]) > 180 ||
    Math.abs(pair[1]) > 90
  )
    return invalid();
  return pair;
}
function parseParams(p: URLSearchParams): SharedTrip {
  for (const key of ['area', ...tripKeys])
    if (p.getAll(key).length > 1) invalid();
  const areaId = p.get('area'),
    cityId = p.get('city');
  if (
    p.get('trip') !== '1' ||
    !areaId ||
    !cityId ||
    !/^[\w-]{1,100}$/.test(areaId) ||
    !/^[\w-]{1,100}$/.test(cityId)
  )
    return invalid();
  const bucket = p.get('bucket'),
    detour = p.get('detour'),
    preference = p.get('route');
  if (
    !bucket ||
    !/^[0-3]$/.test(bucket) ||
    !detour ||
    !decimal.test(detour) ||
    !Number.isFinite(Number(detour)) ||
    Number(detour) < 0 ||
    Number(detour) > 15
  )
    return invalid();
  if (
    preference !== null &&
    !preferences.includes(preference as RoutePreference)
  )
    return invalid();
  return {
    areaId,
    cityId,
    request: {
      origin: point(p.get('origin')),
      destination: point(p.get('destination')),
      bucket: Number(bucket) as BucketIndex,
      maxExtraMinutes: Number(detour),
    },
    ...(preference ? { preference: preference as RoutePreference } : {}),
  };
}
/** Reading never changes browser history; area-only legacy links have no trip. */
export function parseTripUrl(
  url: string,
  areas: CoverageArea[],
): SharedTrip | null {
  if (url.length > 4096) return invalid();
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) return invalid();
  const p = parsed.searchParams;
  if (!tripKeys.some((key) => p.has(key))) return null;
  const trip = parseParams(p);
  const area = areas.find(
    (a) => a.id === trip.areaId && a.cityId === trip.cityId,
  );
  if (!area) return invalid();
  const [west, south, east, north] = area.bounds;
  if (!area.bounds.every(Number.isFinite) || west > east || south > north)
    return invalid();
  for (const [lng, lat] of [trip.request.origin, trip.request.destination]) {
    if (lng < west || lng > east || lat < south || lat > north) invalid();
  }
  return trip;
}
/** Call only after an explicit share action: URLs disclose both coordinates. */
export function encodeTripUrl(baseUrl: string, trip: SharedTrip): string {
  const url = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return invalid();
  url.search = '';
  url.hash = '';
  const p = url.searchParams;
  p.set('area', trip.areaId);
  p.set('trip', '1');
  p.set('city', trip.cityId);
  p.set('origin', trip.request.origin.map(decimalText).join(','));
  p.set('destination', trip.request.destination.map(decimalText).join(','));
  p.set('bucket', String(trip.request.bucket));
  p.set('detour', decimalText(trip.request.maxExtraMinutes));
  if (trip.preference !== undefined) p.set('route', trip.preference);
  parseParams(p);
  return url.toString();
}
export function routePreference(
  route: PlannedRoute,
): RoutePreference | undefined {
  switch (route.label) {
    case 'Fastest':
      return 'fastest';
    case 'Balanced':
      return 'balanced';
    case 'Lower modeled exposure':
      return 'lower-exposure';
    default:
      return undefined;
  }
}
/** A preference is a semantic role, never a promise of identical future geometry. */
export function selectSharedRoute(
  routes: PlannedRoute[],
  preference?: RoutePreference,
): PlannedRoute | undefined {
  if (!preference) return routes[0];
  return (
    routes.find((route) => routePreference(route) === preference) ?? routes[0]
  );
}
const plain = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ');
const xml = (value: string) =>
  plain(value)
    .replace(
      /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu,
      '',
    )
    .replace(
      /[<>&"']/g,
      (c) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        })[c]!,
    );
function contextText(context: RouteExportContext): string {
  const m = context.manifest;
  return `${m.city} / ${m.district}; dataset ${m.datasetId}; historical reports ${m.periodStart} to ${m.periodEnd}; model ${m.modelVersion}; window ${m.timeBuckets[context.bucket]} (${m.timezone}); extra walking budget ${context.maxExtraMinutes} min. Historical modeled exposure is not a safety prediction. Street geometry is a planning reference, not turn-by-turn navigation. Shared requests are recalculated and results may change. Incident source: ${m.sourceName} (${m.sourceUrl}). Streets: © OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright.`;
}
export function exportRouteText(
  route: PlannedRoute,
  context: RouteExportContext,
): string {
  return [
    plain(`Brisa — ${route.label}`),
    `${(route.meters / 1000).toFixed(2)} km · ${Math.round(route.minutes)} min estimated walking · +${route.extraMinutes.toFixed(1)} min`,
    plain(contextText(context)),
    '',
    'Street sequence (contiguous segments):',
    ...route.segments.map(
      (segment, i) =>
        `${i + 1}. ${plain(segment.name)} — ${Math.round(segment.meters)} m · ${segment.minutes.toFixed(1)} min`,
    ),
  ].join('\n');
}
/** GPX track retains every selected-route vertex in order, without invented turns. */
export function exportRouteGpx(
  route: PlannedRoute,
  context: RouteExportContext,
): string {
  if (route.coordinates.length < 2)
    throw new Error('Route geometry is missing.');
  for (const coordinates of route.coordinates)
    point(coordinates.map(decimalText).join(','));
  const description = xml(contextText(context));
  const time = (context.generatedAt ?? new Date()).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Brisa" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xml(route.label)}</name><desc>${description}</desc><time>${time}</time></metadata>\n  <trk><name>${xml(route.label)}</name><desc>${description}</desc><trkseg>\n${route.coordinates.map(([lng, lat]) => `    <trkpt lat="${decimalText(lat)}" lon="${decimalText(lng)}"/>`).join('\n')}\n  </trkseg></trk>\n</gpx>\n`;
}
