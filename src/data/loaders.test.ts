import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCatalog,
  loadDataset,
  validateCatalog,
  validateDataset,
} from './loaders';
import type { CityCatalog, CityDataset, CoverageArea } from '../domain/types';

const area: CoverageArea = {
  id: 'test-city',
  cityId: 'test',
  city: 'Test City',
  region: 'Central',
  regionCode: 'TC',
  countryCode: 'US',
  timezone: 'America/New_York',
  bounds: [0, 0, 0.001, 0.001],
  datasetUrl: '/data/test-city.json',
  defaultOriginId: 'a',
  defaultDestinationId: 'b',
  description: 'Fixture coverage',
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
};
const catalog = (): CityCatalog => ({
  version: 1,
  defaultAreaId: area.id,
  areas: [structuredClone(area)],
});
function dataset(): CityDataset {
  return {
    manifest: {
      schemaVersion: 1,
      datasetId: area.id,
      cityId: area.cityId,
      city: area.city,
      district: area.region,
      timezone: area.timezone,
      sourceName: 'Fixture source',
      sourceAdapter: 'normalized_csv',
      coverageDescription: area.description,
      periodStart: area.periodStart,
      periodEnd: area.periodEnd,
      downloadedAt: '2026-01-01T00:00:00Z',
      osmTimestamp: '2026-01-01T00:00:00Z',
      sourceUrl: 'https://example.test/reports',
      osmSourceUrl: 'https://example.test/streets',
      planningBounds: area.bounds,
      incidentBounds: [-0.00675, -0.00675, 0.009, 0.009],
      cellSizeMeters: 250,
      sourceReportCount: 0,
      eligibleReportCount: 0,
      excludedReportCount: 0,
      missingCoordinateCount: 0,
      categoryWeights: { ROBBERY: 1 },
      timeBuckets: ['00–06', '06–12', '12–18', '18–24'],
      modelVersion: 'test',
      normalization: 1,
      notes: ['Test fixture'],
    },
    cells: Array.from({ length: 49 }, (_, index) => {
      const x = index % 7,
        y = Math.floor(index / 7),
        w = -0.00675 + x * 0.00225,
        s = -0.00675 + y * 0.00225;
      return {
        id: `${x}:${y}`,
        center: [w + 0.001125, s + 0.001125],
        bounds: [w, s, w + 0.00225, s + 0.00225],
        counts: [0, 0, 0, 0],
        weighted: [0, 0, 0, 0],
        intensity: [0, 0, 0, 0],
        total: 0,
      };
    }),
    nodes: [
      { id: 'a', point: [0, 0] },
      { id: 'b', point: [0.001, 0.001] },
    ],
    edges: [
      {
        id: 'ab',
        from: 'a',
        to: 'b',
        coordinates: [
          [0, 0],
          [0.001, 0.001],
        ],
        meters: 157,
        name: 'Test Street',
        bidirectional: true,
      },
    ],
    landmarks: [
      { id: 'a', name: 'Start', point: [0, 0] },
      { id: 'b', name: 'End', point: [0.001, 0.001] },
    ],
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('coverage catalog and package validation', () => {
  it('accepts a complete package with zero observed reports', () => {
    expect(validateCatalog(catalog()).defaultAreaId).toBe(area.id);
    expect(validateDataset(dataset(), area).manifest.eligibleReportCount).toBe(
      0,
    );
  });
  it('rejects duplicate or unknown coverage identifiers', () => {
    const duplicate = catalog();
    duplicate.areas.push(area);
    expect(() => validateCatalog(duplicate)).toThrow('catalog');
    expect(() =>
      validateCatalog({ ...catalog(), defaultAreaId: 'missing' }),
    ).toThrow('catalog');
  });
  it('restricts dataset fetches to bundled local JSON paths', () => {
    for (const url of [
      'https://example.test/data.json',
      '/data/../secret.json',
      '//example.test/data.json',
      '/data/x.json?redirect=1',
    ]) {
      const bad = catalog();
      bad.areas[0].datasetUrl = url;
      expect(() => validateCatalog(bad)).toThrow('catalog');
    }
  });
  it('rejects invalid dates, timezones and inverted coverage', () => {
    for (const changed of [
      { periodStart: '2025-02-31' },
      { timezone: 'Invalid/Zone' },
      { bounds: [1, 1, 0, 0] },
      { periodEnd: '2024-01-01' },
    ]) {
      expect(() =>
        validateCatalog({ ...catalog(), areas: [{ ...area, ...changed }] }),
      ).toThrow('catalog');
    }
  });
  it('rejects a stale or mismatched package before rendering', () => {
    for (const changed of [
      { datasetId: 'other-city' },
      { schemaVersion: 2 },
      { timezone: 'America/Chicago' },
      { periodEnd: '2024-12-31' },
    ]) {
      const bad = dataset();
      Object.assign(bad.manifest, changed);
      expect(() => validateDataset(bad, area)).toThrow(
        'incomplete or incompatible',
      );
    }
  });
  it('distinguishes a missing cell from a valid zero cell', () => {
    const bad = dataset();
    bad.cells.pop();
    expect(() => validateDataset(bad, area)).toThrow('incomplete');
    const duplicated = dataset();
    duplicated.cells[8] = { ...duplicated.cells[0], id: 'different-id' };
    expect(() => validateDataset(duplicated, area)).toThrow('incomplete');
  });
  it('rejects broken graph references, geometry and out-of-range intensity', () => {
    const graph = dataset();
    graph.edges[0].to = 'missing';
    expect(() => validateDataset(graph, area)).toThrow('incomplete');
    const geometry = dataset();
    geometry.edges[0].coordinates[0] = [0.0001, 0];
    expect(() => validateDataset(geometry, area)).toThrow('incomplete');
    const intensity = dataset();
    intensity.cells[0].intensity[0] = NaN;
    expect(() => validateDataset(intensity, area)).toThrow('incomplete');
  });
  it('rejects inconsistent report totals and missing default destinations', () => {
    const counts = dataset();
    counts.manifest.eligibleReportCount = 1;
    expect(() => validateDataset(counts, area)).toThrow('incomplete');
    const missing = dataset();
    missing.manifest.missingCoordinateCount = 1;
    expect(() => validateDataset(missing, area)).toThrow('incomplete');
    expect(() =>
      validateDataset(dataset(), { ...area, defaultDestinationId: 'missing' }),
    ).toThrow('incomplete');
  });
  it('rejects a complete grid cropped to the planning boundary without a scoring halo', () => {
    const bad = dataset();
    bad.manifest.planningBounds = bad.manifest.incidentBounds;
    expect(() =>
      validateDataset(bad, { ...area, bounds: bad.manifest.planningBounds }),
    ).toThrow('incomplete');
  });
  it('surfaces network/JSON errors and can retry after failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(catalog()))),
    );
    await expect(loadCatalog()).rejects.toThrow('Unable to load');
    await expect(loadCatalog()).resolves.toEqual(catalog());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{partial')));
    await expect(loadDataset(area)).rejects.toThrow('Unable to load');
  });
  it('rejects a fetch result whose request was aborted during parsing', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          controller.abort();
          return dataset();
        },
      }),
    );
    await expect(loadDataset(area, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('preserves an AbortError from an interrupted JSON response stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new DOMException('Cancelled', 'AbortError');
        },
      }),
    );
    await expect(loadDataset(area)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
