import { describe, expect, it, vi } from 'vitest';
import { getRecentSource, loadRecentFeed } from './recent-reports';
import type { CoverageArea } from '../domain/types';
const area = (cityId = 'sf') =>
  ({ id: 'test', cityId, bounds: [-123, 37, -122, 38] }) as CoverageArea;
const now = new Date('2026-10-03T14:15:00Z');
const row = {
  cad_number: '123',
  received_datetime: '2026-10-03T06:00:00.000',
  call_type_final: '211',
  agency: 'Police',
  sensitive_call: false,
  intersection_point: { type: 'Point', coordinates: [-122.4, 37.8] },
};
function mock(rows: unknown, latest = '2026-10-03T06:00:00.000') {
  return vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify([{ latest }])))
    .mockResolvedValueOnce(new Response(JSON.stringify(rows))) as typeof fetch;
}
const signal = () => new AbortController().signal;
describe('recent official feeds', () => {
  it('supports only verified cities', () => {
    expect(getRecentSource('sao-paulo')).toBeUndefined();
    expect(getRecentSource('sf')?.kind).toBe('calls');
  });
  it('normalizes selected calls and excludes sensitive, future, invalid and duplicate records', async () => {
    const fetcher = mock([
      row,
      row,
      { ...row, cad_number: '2', sensitive_call: true },
      { ...row, cad_number: '3', received_datetime: '2026-10-03T09:00:00' },
      { ...row, cad_number: '4', call_type_final: '800' },
      { ...row, cad_number: '5', received_datetime: '2026-02-30T06:00:00' },
    ]);
    const result = await loadRecentFeed(area(), signal(), { now, fetcher });
    expect(result.records).toHaveLength(1);
    expect(result.excludedRows).toBe(5);
    expect(result.windowStart).toBe('2026-10-01T07:15:00');
    expect(result.windowEnd).toBe('2026-10-03T07:15:00');
    expect(result.records[0]).toMatchObject({
      category: 'Robbery',
      status: 'open',
      eventAt: '2026-10-03T06:00:00',
    });
    const url = new URL(vi.mocked(fetcher).mock.calls[1][0] as string);
    expect(url.hostname).toBe('data.sf.gov');
    expect(url.searchParams.get('$select')).not.toMatch(/notes|address/);
  });
  it('anchors NYC to latest published calendar month and validates subtype', async () => {
    const a = {
      ...area('nyc'),
      bounds: [-74.02, 40.7, -73.965, 40.78],
    } as CoverageArea;
    const r = {
      cmplnt_num: '123',
      cmplnt_fr_dt: '2026-06-15T00:00:00.000',
      cmplnt_fr_tm: '12:30:00',
      ky_cd: '109',
      pd_cd: '404',
      prem_typ_desc: 'STREET',
      longitude: '-74',
      latitude: '40.75',
    };
    const result = await loadRecentFeed(a, signal(), {
      now,
      fetcher: mock(
        [r, { ...r, cmplnt_num: '2', pd_cd: '999' }],
        '2026-06-30T00:00:00.000',
      ),
    });
    expect(result.windowStart).toBe('2026-06-01T00:00:00');
    expect(result.windowEnd).toBe('2026-06-30T23:59:59');
    expect(result.records).toHaveLength(1);
  });
  it('requires non-domestic eligible Chicago premises', async () => {
    const a = {
      ...area('chicago'),
      bounds: [-87.644, 41.866, -87.617, 41.891],
    } as CoverageArea;
    const r = {
      id: '1',
      date: '2026-09-24T12:00:00',
      domestic: false,
      primary_type: 'ROBBERY',
      location_description: 'STREET',
      longitude: '-87.63',
      latitude: '41.88',
    };
    const result = await loadRecentFeed(a, signal(), {
      now,
      fetcher: mock(
        [
          r,
          { ...r, id: '2', domestic: true },
          { ...r, id: '3', location_description: 'RESIDENCE' },
        ],
        '2026-09-24T23:00:00',
      ),
    });
    expect(result.records).toHaveLength(1);
    expect(result.excludedRows).toBe(2);
  });
  it('fails closed on cap and malformed responses', async () => {
    await expect(
      loadRecentFeed(area(), signal(), {
        now,
        fetcher: mock(Array(5000).fill(row)),
      }),
    ).rejects.toThrow('limit');
    await expect(
      loadRecentFeed(area(), signal(), {
        now,
        fetcher: mock({ error: 'oops' }),
      }),
    ).rejects.toThrow('Invalid');
  });
  it('rejects invalid bounds, unsupported sources and pre-aborted requests', async () => {
    await expect(
      loadRecentFeed({ ...area(), bounds: [0, 0, 999, 1] }, signal()),
    ).rejects.toThrow('bounds');
    await expect(loadRecentFeed(area('sao-paulo'), signal())).rejects.toThrow(
      'verified',
    );
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    await expect(
      loadRecentFeed(area(), controller.signal, { now, fetcher }),
    ).rejects.toThrow('aborted');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('recent feed failure and revision handling', () => {
  it('rejects conflicting duplicate before later revision eligibility', async () => {
    await expect(
      loadRecentFeed(area(), signal(), {
        now,
        fetcher: mock([row, { ...row, sensitive_call: true }]),
      }),
    ).rejects.toThrow('Conflicting duplicate');
  });
  it('rejects malformed maxima but accepts an empty calls feed', async () => {
    await expect(
      loadRecentFeed(area(), signal(), { now, fetcher: mock([], 'bad') }),
    ).rejects.toThrow('latest date');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('[{}]'))
      .mockResolvedValueOnce(new Response('[]')) as typeof fetch;
    expect(
      (await loadRecentFeed(area(), signal(), { now, fetcher })).records,
    ).toEqual([]);
  });
  it('excludes malformed or future optional dates, validates closure', async () => {
    const rows = [
      row,
      { ...row, cad_number: '2', close_datetime: 'yes' },
      { ...row, cad_number: '3', call_last_updated_at: '2027-01-01T00:00:00' },
      { ...row, cad_number: '4', close_datetime: '2026-10-03T06:30:00' },
    ];
    const result = await loadRecentFeed(area(), signal(), {
      now,
      fetcher: mock(rows),
    });
    expect(result.records.map((r) => r.status)).toEqual(['open', 'closed']);
    expect(result.excludedRows).toBe(2);
  });
  it('captures a valid publication header separately from checked time', async () => {
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response('[]', {
          headers: { 'Last-Modified': 'Sat, 03 Oct 2026 14:00:00 GMT' },
        }),
    ) as typeof fetch;
    const result = await loadRecentFeed(area(), signal(), { now, fetcher });
    expect(result.publisherUpdatedAt).toBe('2026-10-03T14:00:00.000Z');
    expect(result.checkedAt).toBe(now.toISOString());
  });
  it('rejects HTTP errors and invalid JSON', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('busy', { status: 429 })) as typeof fetch;
    await expect(
      loadRecentFeed(area(), signal(), { now, fetcher }),
    ).rejects.toThrow('429');
    await expect(
      loadRecentFeed(area(), signal(), {
        now,
        fetcher: vi
          .fn()
          .mockResolvedValue(new Response('not-json')) as typeof fetch,
      }),
    ).rejects.toThrow();
  });
  it('propagates midflight abort and timeout to the request', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            ),
          ),
      ) as typeof fetch;
    const controller = new AbortController();
    const pending = loadRecentFeed(area(), controller.signal, { now, fetcher });
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    vi.useFakeTimers();
    try {
      const timed = loadRecentFeed(area(), signal(), { now, fetcher });
      const assertion = expect(timed).rejects.toThrow('Aborted');
      await vi.advanceTimersByTimeAsync(25_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
