import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareRoutes } from './route-insights';
import { haversine, planRoutes } from './routing';
import type { CityDataset, PlannedRoute, StreetEdge } from './types';
const edge = (id: string, name: string, x: number): StreetEdge => ({
  id,
  name,
  from: `${id}a`,
  to: `${id}b`,
  coordinates: [
    [x, 0],
    [x + 0.001, 0],
  ],
  meters: 1,
  bidirectional: true,
});
const data = {
  edges: [
    edge('shared', 'Common', 0),
    edge('a', 'Main', 0.001),
    edge('b', 'Main', 0.002),
    edge('c', 'Unnamed walking connection', 0.003),
  ],
};
const route = (ids: string[], minutes = 10, exposure = 10): PlannedRoute => ({
  id: JSON.stringify(ids),
  label: '',
  nodeIds: [],
  edgeIds: ids,
  coordinates: [],
  minutes,
  meters: minutes * 81,
  exposure,
  exposureByBucket: [exposure, exposure, exposure, exposure],
  extraMinutes: 999,
  reductionPercent: 999,
  segments: [],
});
describe('route insights', () => {
  it('measures geometry rather than untrusted recorded meters and distinguishes same-named sections', () => {
    const insight = compareRoutes(
      route(['shared', 'a'], 12, 8.5),
      route(['shared', 'b']),
      data,
    );
    const length = haversine([0, 0], [0.001, 0]);
    expect(insight.sharedMeters).toBeCloseTo(length);
    expect(insight.selectedOnlyMeters).toBeCloseTo(length);
    expect(insight.fastestOnlyMeters).toBeCloseTo(length);
    expect(insight.addedMeters).toBe(162);
    expect(insight.takeaway).toContain('2 extra minutes for 15% lower');
    expect(insight.differentSectionsOf).toEqual(['Main']);
    expect(insight.streetSummary).toContain('different sections of Main');
    expect(insight.streetSummary).not.toContain('instead');
  });
  it('matches each repeated edge traversal only once, ignoring direction/order', () => {
    const insight = compareRoutes(
      route(['shared', 'shared', 'a']),
      route(['a', 'shared']),
      data,
    );
    expect(insight.sharedMeters).toBeCloseTo(2 * insight.selectedOnlyMeters);
    expect(insight.fastestOnlyMeters).toBe(0);
    expect(
      compareRoutes(route(['a', 'shared']), route(['shared', 'a']), data)
        .takeaway,
    ).toContain('fastest walk');
  });
  it('does not round small benefits to zero or invent index comparisons', () => {
    expect(
      compareRoutes(route(['a'], 10.2, 9.95), route(['b']), data).takeaway,
    ).toContain('Less than 1 extra minute for less than 1% lower');
    expect(
      compareRoutes(route(['a'], 10.001, 9), route(['b']), data).takeaway,
    ).toContain('same walking time');
    expect(
      compareRoutes(route(['a'], 12, 0), route(['b'], 10, 0), data)
        .reductionPercent,
    ).toBeNull();
    expect(
      compareRoutes(route(['a'], 12, 0), route(['b'], 10, 0), data).takeaway,
    ).toContain('unavailable');
    expect(
      compareRoutes(route(['a'], 12, 11), route(['b']), data).takeaway,
    ).toContain('higher');
  });
  it.each(['Walking path', 'Unnamed street', 'UNNAMED STREET', 'walking path'])(
    'excludes builder fallback %s from named streets',
    (name) => {
      const result = compareRoutes(route(['fallback']), route(['a']), {
        edges: [...data.edges, edge('fallback', name, 0.004)],
      });
      expect(result.selectedOnlyStreets).toEqual([]);
      expect(result.selectedOnlyMeters).toBeGreaterThan(0);
    },
  );
  it('excludes unnamed placeholders and fails on unknown edges', () => {
    expect(
      compareRoutes(route(['c']), route(['a']), data).selectedOnlyStreets,
    ).toEqual([]);
    expect(() => compareRoutes(route(['missing']), route(['a']), data)).toThrow(
      'unavailable',
    );
  });
  for (const city of ['sao-paulo-centro', 'nyc-manhattan'])
    it(`conserves actual route geometry for ${city}`, () => {
      const dataset = JSON.parse(
        readFileSync(`public/data/${city}.json`, 'utf8'),
      ) as CityDataset;
      const defaults =
        city === 'sao-paulo-centro'
          ? ['copan', 'se']
          : ['penn', 'grand-central'];
      const [origin, destination] = defaults.map(
        (id) => dataset.landmarks.find((l) => l.id === id)!.point,
      );
      const routes = planRoutes(dataset, {
        origin,
        destination,
        bucket: 2,
        maxExtraMinutes: 8,
      }).routes;
      expect(routes.length).toBeGreaterThan(1);
      for (const selected of routes) {
        const insight = compareRoutes(selected, routes[0], dataset);
        expect(insight.sharedMeters + insight.selectedOnlyMeters).toBeCloseTo(
          selected.meters,
          5,
        );
        expect(insight.sharedMeters + insight.fastestOnlyMeters).toBeCloseTo(
          routes[0].meters,
          5,
        );
        expect(insight.extraMinutes).toBeCloseTo(selected.extraMinutes);
      }
    });
});
