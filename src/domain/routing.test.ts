import { describe, expect, it } from 'vitest';
import { haversine, planRoutes, RoutingError } from './routing';
import type { CityDataset, DataManifest, LngLat, PlanRequest } from './types';
const a: LngLat = [0, 0],
  b: LngLat = [0.002, 0],
  c: LngLat = [0.001, 0.001];
function fixture(): CityDataset {
  return {
    manifest: { planningBounds: [-0.01, -0.01, 0.01, 0.01] } as DataManifest,
    nodes: [
      { id: 'a', point: a },
      { id: 'b', point: b },
      { id: 'c', point: c },
    ],
    edges: [
      {
        id: 'direct',
        from: 'a',
        to: 'b',
        coordinates: [a, b],
        meters: 1,
        bidirectional: true,
        name: 'Main',
      },
      {
        id: 'up',
        from: 'a',
        to: 'c',
        coordinates: [a, c],
        meters: 1,
        bidirectional: true,
        name: 'Park',
      },
      {
        id: 'down',
        from: 'c',
        to: 'b',
        coordinates: [c, b],
        meters: 1,
        bidirectional: true,
        name: 'Park',
      },
    ],
    cells: [
      {
        id: 'main',
        center: a,
        bounds: [-0.01, -0.01, 0.01, 0.0002],
        counts: [0, 0, 0, 0],
        weighted: [0, 0, 0, 0],
        total: 0,
        intensity: [1, 0, 0, 0],
      },
      {
        id: 'park',
        center: c,
        bounds: [-0.01, 0.0002, 0.01, 0.01],
        counts: [0, 0, 0, 0],
        weighted: [0, 0, 0, 0],
        total: 0,
        intensity: [0, 1, 0, 0],
      },
    ],
    landmarks: [],
  };
}
const request: PlanRequest = {
  origin: a,
  destination: b,
  bucket: 0,
  maxExtraMinutes: 3,
};
function errorCode(fn: () => unknown, code: string) {
  try {
    fn();
    throw Error('Expected routing failure');
  } catch (error) {
    expect(error).toBeInstanceOf(RoutingError);
    expect((error as RoutingError).code).toBe(code);
  }
}
describe('graph walking routes', () => {
  it('returns a real low-exposure detour and sums actual geometry, score and segments', () => {
    const result = planRoutes(fixture(), request);
    expect(result.routes).toHaveLength(2);
    const [fast, low] = result.routes;
    expect(fast.edgeIds).toEqual(['direct']);
    expect(low.edgeIds).toEqual(['up', 'down']);
    expect(low.coordinates).toEqual([a, c, b]);
    expect(low.nodeIds).toEqual(['a', 'c', 'b']);
    expect(fast.meters).toBeCloseTo(haversine(a, b));
    expect(fast.minutes).toBeCloseTo(fast.meters / 81);
    expect(low.exposure).toBeLessThan(fast.exposure);
    expect(low.reductionPercent).toBeGreaterThan(0);
    expect(low.segments).toHaveLength(1);
    expect(low.segments[0].exposure).toBeCloseTo(low.exposure);
  });
  it('measures every bend of an edge geometry and preserves its street summary', () => {
    const data = fixture();
    data.edges = [{ ...data.edges[0], coordinates: [a, c, b] }];
    const r = planRoutes(data, request).routes[0];
    expect(r.coordinates).toEqual([a, c, b]);
    expect(r.meters).toBeCloseTo(haversine(a, c) + haversine(c, b));
    expect(r.segments[0].minutes).toBeCloseTo(r.minutes);
  });
  it('enforces the unrounded time budget, including the exact boundary', () => {
    const data = fixture(),
      low = planRoutes(data, request).routes[1];
    expect(
      planRoutes(data, { ...request, maxExtraMinutes: low.extraMinutes })
        .routes,
    ).toHaveLength(2);
    expect(
      planRoutes(data, { ...request, maxExtraMinutes: low.extraMinutes - 1e-9 })
        .routes,
    ).toHaveLength(1);
  });
  it('scores long edges across cells at closely spaced samples', () => {
    const data = fixture();
    data.edges = [data.edges[0]];
    data.cells[0].bounds = [-0.01, -0.01, 0.001, 0.01];
    data.cells[1].bounds = [0.001, -0.01, 0.01, 0.01];
    const r = planRoutes(data, request).routes[0];
    expect(r.exposure / r.minutes).toBeGreaterThan(0.4);
    expect(r.exposure / r.minutes).toBeLessThan(0.6);
  });
  it('uses bucket-specific caches and suppresses percentages for zero exposure', () => {
    const data = fixture();
    planRoutes(data, request);
    const result = planRoutes(data, { ...request, bucket: 1 });
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].exposure).toBe(0);
    expect(result.routes[0].reductionPercent).toBeNull();
    expect(result.message).toBeTruthy();
  });
  it('respects directed edges and reverses bidirectional route geometry', () => {
    const data = fixture();
    data.edges = [data.edges[0]];
    expect(
      planRoutes(data, { ...request, origin: b, destination: a }).routes[0]
        .coordinates,
    ).toEqual([b, a]);
    const directed = fixture();
    directed.edges = [{ ...directed.edges[0], bidirectional: false }];
    errorCode(
      () => planRoutes(directed, { ...request, origin: b, destination: a }),
      'DISCONNECTED',
    );
  });
  it('rejects unsupported scoring rather than interpreting missing cells as zero', () => {
    const data = fixture();
    data.cells = [];
    errorCode(() => planRoutes(data, request), 'DISCONNECTED');
  });
  it('excludes invalid scoring values instead of allowing a cheap path', () => {
    const data = fixture();
    data.cells[0].intensity[0] = NaN;
    errorCode(() => planRoutes(data, request), 'DISCONNECTED');
  });
  it('rejects geometry bending outside the planning area despite incident halo support', () => {
    const data = fixture();
    data.edges = [{ ...data.edges[0], coordinates: [a, [0.02, 0], b] }];
    data.cells[0].bounds = [-1, -1, 1, 1];
    errorCode(() => planRoutes(data, request), 'DISCONNECTED');
  });
  it('rejects disconnected points', () => {
    const data = fixture();
    data.edges = [];
    errorCode(() => planRoutes(data, request), 'DISCONNECTED');
  });
  it('rejects out-of-bounds and distant snaps', () => {
    errorCode(
      () => planRoutes(fixture(), { ...request, origin: [1, 1] }),
      'OUTSIDE_COVERAGE',
    );
    errorCode(
      () => planRoutes(fixture(), { ...request, origin: [0.009, 0.009] }),
      'SNAP_TOO_FAR',
    );
  });
  it('returns actual snapped endpoints and rejects same-node endpoints', () => {
    const result = planRoutes(fixture(), { ...request, origin: [0.00001, 0] });
    expect(result.snappedOrigin).toEqual(a);
    expect(result.originSnapMeters).toBeGreaterThan(0);
    errorCode(
      () => planRoutes(fixture(), { ...request, destination: [0.00001, 0] }),
      'SAME_ENDPOINT',
    );
  });
  it.each([NaN, Infinity, -Infinity])(
    'rejects nonfinite coordinates and budgets: %s',
    (value) => {
      errorCode(
        () => planRoutes(fixture(), { ...request, origin: [value, 0] }),
        'INVALID_COORDINATES',
      );
      errorCode(
        () => planRoutes(fixture(), { ...request, maxExtraMinutes: value }),
        'INVALID_REQUEST',
      );
    },
  );
});

describe('dataset-isolated spatial sampling', () => {
  it('keeps matching node and edge IDs isolated across datasets', () => {
    const first = fixture(),
      second = fixture();
    second.cells.forEach((cell) => {
      cell.intensity = [0.25, 0.25, 0.25, 0.25];
    });
    expect(planRoutes(first, request).routes[0].exposure).toBeCloseTo(
      haversine(a, b) / 81,
    );
    expect(planRoutes(second, request).routes[0].exposure).toBeCloseTo(
      haversine(a, b) / 81 / 4,
    );
    expect(planRoutes(first, request).routes[0].exposure).toBeCloseTo(
      haversine(a, b) / 81,
    );
  });
  it('preserves original-cell precedence exactly on inclusive shared boundaries', () => {
    const data = fixture();
    data.edges = [data.edges[0]];
    data.cells[0].bounds = [-0.01, -0.01, 0.01, 0];
    data.cells[1].bounds = [-0.01, 0, 0.01, 0.01];
    expect(planRoutes(data, request).routes[0].exposure).toBeCloseTo(
      haversine(a, b) / 81,
    );
  });
  it('does not fill gaps between irregular cells', () => {
    const data = fixture();
    data.edges = [data.edges[0]];
    data.cells[0].bounds = [-0.01, -0.01, 0.0005, 0.01];
    data.cells[1].bounds = [0.0015, -0.01, 0.01, 0.01];
    errorCode(() => planRoutes(data, request), 'DISCONNECTED');
  });
});
