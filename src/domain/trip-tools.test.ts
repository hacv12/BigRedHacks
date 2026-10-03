import { describe, expect, it } from 'vitest';
import {
  encodeTripUrl,
  exportRouteGpx,
  exportRouteText,
  parseTripUrl,
  routePreference,
  selectSharedRoute,
} from './trip-tools';
import type { SharedTrip, RouteExportContext } from './trip-tools';
import type { CoverageArea, DataManifest, PlannedRoute } from './types';
const areas = [
  { id: 'nyc-manhattan', cityId: 'nyc', bounds: [-75, 40, -73, 42] },
] as CoverageArea[];
const trip: SharedTrip = {
  areaId: 'nyc-manhattan',
  cityId: 'nyc',
  request: {
    origin: [-74.001234567, 40.7],
    destination: [-73.99, 40.8],
    bucket: 3,
    maxExtraMinutes: 8.5,
  },
  preference: 'lower-exposure',
};
const base = 'https://brisa.example/app';
const route: PlannedRoute = {
  id: 'selected',
  label: 'Lower modeled exposure',
  coordinates: [
    [-74, 40.7],
    [-73.999, 40.705],
    [-73.99, 40.8],
  ],
  nodeIds: [],
  edgeIds: [],
  meters: 1000,
  minutes: 12.3,
  exposure: 0.5,
  exposureByBucket: [0.5, 0.5, 0.5, 0.5],
  extraMinutes: 2.3,
  reductionPercent: 12,
  segments: [
    { name: 'A & B <Lane>', meters: 1000, minutes: 12.3, exposure: 0.5 },
  ],
};
const context: RouteExportContext = {
  manifest: {
    city: 'New York',
    district: 'Manhattan',
    datasetId: 'snapshot-1',
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    modelVersion: 'model-2',
    timeBuckets: ['a', 'b', 'c', 'night'],
    timezone: 'America/New_York',
  } as DataManifest,
  bucket: 3,
  maxExtraMinutes: 8.5,
  generatedAt: new Date('2026-10-03T12:00:00Z'),
};
describe('opt-in trip links', () => {
  it('roundtrips all request values without rounding coordinates or retaining unrelated state', () => {
    const encoded = encodeTripUrl(`${base}?token=secret#old`, trip);
    expect(parseTripUrl(encoded, areas)).toEqual(trip);
    expect(encoded).not.toContain('secret');
    expect(encoded).not.toContain('#');
    expect(new URL(encoded).origin).toBe(new URL(base).origin);
  });
  it('leaves legacy area-only links to the existing area loader', () => {
    expect(parseTripUrl(`${base}?area=nyc-manhattan`, areas)).toBeNull();
  });
  it.each([
    ['trip', '2'],
    ['city', 'chicago'],
    ['area', 'unknown'],
    ['origin', ''],
    ['origin', '-74'],
    ['origin', '-74,40.7,0'],
    ['origin', 'NaN,40.7'],
    ['origin', '-181,40.7'],
    ['origin', '-74,91'],
    ['origin', '-74,39'],
    ['origin', ' -74,40.7'],
    ['origin', '-7.4e1,40.7'],
    ['bucket', '4'],
    ['bucket', '1.5'],
    ['detour', '16'],
    ['detour', '-1'],
    ['detour', 'Infinity'],
    ['route', 'safest'],
  ])('rejects invalid %s=%s', (key, value) => {
    const url = new URL(encodeTripUrl(base, trip));
    url.searchParams.set(key, value);
    expect(() => parseTripUrl(url.toString(), areas)).toThrow();
  });
  it('rejects missing and duplicate fields instead of silently using defaults', () => {
    for (const key of [
      'area',
      'trip',
      'city',
      'origin',
      'destination',
      'bucket',
      'detour',
    ]) {
      const missing = new URL(encodeTripUrl(base, trip));
      missing.searchParams.delete(key);
      expect(() => parseTripUrl(missing.toString(), areas)).toThrow();
      const duplicate = new URL(encodeTripUrl(base, trip));
      duplicate.searchParams.append(key, duplicate.searchParams.get(key)!);
      expect(() => parseTripUrl(duplicate.toString(), areas)).toThrow();
    }
  });
  it('rejects executable URL schemes and credential-bearing share bases', () => {
    expect(() => encodeTripUrl('javascript:alert(1)', trip)).toThrow();
    expect(() =>
      encodeTripUrl('https://user:secret@brisa.example', trip),
    ).toThrow();
  });
  it('stores route role and gracefully falls back when that role no longer exists', () => {
    expect(routePreference(route)).toBe('lower-exposure');
    const fastest = { ...route, id: 'other', label: 'Fastest' };
    expect(selectSharedRoute([fastest, route], 'lower-exposure')).toBe(route);
    expect(selectSharedRoute([fastest], 'balanced')).toBe(fastest);
  });
});
describe('selected route exports', () => {
  it('exports exact selected WGS84 geometry in traversal order and historical context', () => {
    const gpx = exportRouteGpx(route, context);
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    const points = [
      ...gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"\/>/g),
    ].map((match) => [Number(match[2]), Number(match[1])]);
    expect(points).toEqual(route.coordinates);
    for (const value of [
      'snapshot-1',
      'model-2',
      'night',
      'America/New_York',
      '2025-01-01',
      '2026-10-03T12:00:00.000Z',
    ])
      expect(gpx).toContain(value);
    expect(gpx).not.toContain('<rtept');
  });
  it('escapes XML names and rejects invalid track vertices', () => {
    expect(
      exportRouteGpx({ ...route, label: 'A & <B> "C" \'D\'' }, context),
    ).toContain('A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;');
    expect(() =>
      exportRouteGpx(
        {
          ...route,
          coordinates: [
            [181, 0],
            [0, 0],
          ],
        },
        context,
      ),
    ).toThrow();
  });
  it('describes contiguous street segments without invented turns or safety promises', () => {
    const text = exportRouteText(route, context);
    expect(text).toContain('A & B <Lane> — 1000 m');
    expect(text).toContain('not a safety prediction');
    expect(text).toContain('not turn-by-turn navigation');
  });
});
