import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCatalog, validateDataset } from '../data/loaders';
import { haversine, planRoutes } from './routing';
import type { BucketIndex, LngLat } from './types';

const catalog = validateCatalog(
  JSON.parse(readFileSync('public/data/catalog.json', 'utf8')),
);
const packages = catalog.areas.map((area) => ({
  label: `${area.city} · ${area.region}`,
  area,
  data: validateDataset(
    JSON.parse(readFileSync(`public${area.datasetUrl}`, 'utf8')),
    area,
  ),
}));

it('ships real NYC and Chicago packages with NYC as the default', () => {
  expect(catalog.defaultAreaId).toBe('nyc-manhattan');
  expect(packages.some((p) => p.area.cityId === 'nyc')).toBe(true);
  expect(packages.some((p) => p.area.cityId === 'chicago')).toBe(true);
});

describe.each(packages)('$label real-data routing', ({ data, area }) => {
  const origin = data.landmarks.find(
    (p) => p.id === area.defaultOriginId,
  )!.point;
  const destination = data.landmarks.find(
    (p) => p.id === area.defaultDestinationId,
  )!.point;

  it('returns continuous real streets within exact detour limits in every time window', () => {
    const bounds = data.manifest.planningBounds;
    const nodes = new Map(data.nodes.map((n) => [n.id, n]));
    const edges = new Map(data.edges.map((e) => [e.id, e]));
    let alternatives = 0;
    for (const bucket of [0, 1, 2, 3] as BucketIndex[]) {
      for (const maxExtraMinutes of [0, 8]) {
        const result = planRoutes(data, {
          origin,
          destination,
          bucket,
          maxExtraMinutes,
        });
        expect(result.routes.length).toBeGreaterThan(0);
        expect(result.routes.length).toBeLessThanOrEqual(3);
        alternatives += result.routes.length - 1;
        for (const route of result.routes) {
          expect(route.minutes).toBeLessThanOrEqual(
            result.routes[0].minutes + maxExtraMinutes,
          );
          expect(route.coordinates[0]).toEqual(result.snappedOrigin);
          expect(route.coordinates.at(-1)).toEqual(result.snappedDestination);
          expect(route.nodeIds).toHaveLength(route.edgeIds.length + 1);
          let meters = 0;
          route.edgeIds.forEach((id, index) => {
            const edge = edges.get(id)!;
            expect(edge).toBeDefined();
            const forward =
              edge.from === route.nodeIds[index] &&
              edge.to === route.nodeIds[index + 1];
            expect(
              forward ||
                (edge.bidirectional &&
                  edge.to === route.nodeIds[index] &&
                  edge.from === route.nodeIds[index + 1]),
            ).toBe(true);
            const coordinates = forward
              ? edge.coordinates
              : [...edge.coordinates].reverse();
            expect(coordinates[0]).toEqual(
              nodes.get(route.nodeIds[index])!.point,
            );
            expect(coordinates.at(-1)).toEqual(
              nodes.get(route.nodeIds[index + 1])!.point,
            );
            for (let k = 1; k < coordinates.length; k++)
              meters += haversine(coordinates[k - 1], coordinates[k]);
          });
          expect(route.meters).toBeCloseTo(meters, 6);
          expect(route.minutes).toBeCloseTo(meters / 81, 6);
          expect(route.exposure).toBeGreaterThanOrEqual(0);
          expect(route.exposure).toBeLessThanOrEqual(route.minutes);
          expect(route.exposure).toBeLessThanOrEqual(
            result.routes[0].exposure + 1e-8,
          );
          expect(
            route.segments.reduce((sum, s) => sum + s.exposure, 0),
          ).toBeCloseTo(route.exposure, 8);
          route.coordinates.forEach(([lng, lat]) => {
            expect(lng).toBeGreaterThanOrEqual(bounds[0]);
            expect(lng).toBeLessThanOrEqual(bounds[2]);
            expect(lat).toBeGreaterThanOrEqual(bounds[1]);
            expect(lat).toBeLessThanOrEqual(bounds[3]);
          });
        }
      }
    }
    expect(alternatives).toBeGreaterThan(0);
  }, 60_000);

  it('changes actual scores across historical windows and rejects points outside its package', () => {
    const scores = ([0, 1, 2, 3] as BucketIndex[]).map(
      (bucket) =>
        planRoutes(data, { origin, destination, bucket, maxExtraMinutes: 8 })
          .routes[0].exposure,
    );
    expect(new Set(scores.map((v) => v.toFixed(8))).size).toBeGreaterThan(1);
    const outside: LngLat = [area.bounds[2] + 0.01, area.bounds[3] + 0.01];
    expect(() =>
      planRoutes(data, {
        origin: outside,
        destination,
        bucket: 2,
        maxExtraMinutes: 8,
      }),
    ).toThrow('inside the supported planning area');
  });

  it('supports another landmark pair beyond the default demonstration', () => {
    const first = data.landmarks[0].point,
      last = data.landmarks.at(-1)!.point;
    const result = planRoutes(data, {
      origin: first,
      destination: last,
      bucket: 1,
      maxExtraMinutes: 5,
    });
    expect(result.routes[0].coordinates.length).toBeGreaterThan(2);
    expect(result.snappedOrigin).toEqual(first);
    expect(result.snappedDestination).toEqual(last);
  }, 30_000);
});
