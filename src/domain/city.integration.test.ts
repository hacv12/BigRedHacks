import snapshot from '../../public/data/chicago-loop.json';
import { describe, expect, it } from 'vitest';
import { haversine, planRoutes } from './routing';
import type { BucketIndex, CityDataset } from './types';

const data = snapshot as unknown as CityDataset;

describe('bundled Chicago routing integration', () => {
  it('routes landmark pairs on continuous real edges within coverage and exact budgets', () => {
    const bounds = data.manifest.planningBounds;
    const nodes = new Map(data.nodes.map((node) => [node.id, node]));
    const edges = new Map(data.edges.map((edge) => [edge.id, edge]));
    let alternatives = 0;
    for (const i of [0, 2]) {
      for (const j of [4, 6]) {
        for (const bucket of [0, 1, 2, 3] as BucketIndex[]) {
          for (const maxExtraMinutes of [0, 5]) {
            const result = planRoutes(data, {
              origin: data.landmarks[i].point,
              destination: data.landmarks[j].point,
              bucket,
              maxExtraMinutes,
            });
            expect(result.originSnapMeters).toBeLessThanOrEqual(75);
            expect(result.destinationSnapMeters).toBeLessThanOrEqual(75);
            expect(result.routes.length).toBeLessThanOrEqual(3);
            alternatives += result.routes.length - 1;
            for (const route of result.routes) {
              expect(route.minutes).toBeLessThanOrEqual(
                result.routes[0].minutes + maxExtraMinutes,
              );
              expect(route.coordinates[0]).toEqual(result.snappedOrigin);
              expect(route.coordinates.at(-1)).toEqual(
                result.snappedDestination,
              );
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
              expect(
                route.segments.reduce(
                  (sum, segment) => sum + segment.exposure,
                  0,
                ),
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
      }
    }
    expect(alternatives).toBeGreaterThan(0);
  }, 60000);
  it('provides a substantial real-data example within a modest detour budget', () => {
    const origin = data.landmarks.find((place) => place.id === 'willis')!;
    const destination = data.landmarks.find((place) => place.id === 'river')!;
    const result = planRoutes(data, {
      origin: origin.point,
      destination: destination.point,
      bucket: 2,
      maxExtraMinutes: 5,
    });
    const lower = result.routes.at(-1)!;
    expect(result.routes.length).toBeGreaterThan(1);
    expect(lower.reductionPercent).toBeGreaterThan(20);
    expect(lower.extraMinutes).toBeLessThan(1);
  });
  it('changes actual baseline scores when the historical time window changes', () => {
    const scores = ([0, 1, 2, 3] as BucketIndex[]).map(
      (bucket) =>
        planRoutes(data, {
          origin: data.landmarks[0].point,
          destination: data.landmarks[1].point,
          bucket,
          maxExtraMinutes: 5,
        }).routes[0].exposure,
    );
    expect(
      new Set(scores.map((value) => value.toFixed(8))).size,
    ).toBeGreaterThan(1);
  });
});
