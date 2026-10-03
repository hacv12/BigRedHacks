import { describe, expect, it } from 'vitest';
import {
  aggregateRecentBubbles,
  bubbleRadius,
  formatSourceTime,
} from './recent-bubbles';
import type { IncidentCell, Bounds } from './types';
import type { RecentRecord } from './recent-types';
const bounds: Bounds = [0, 0, 2, 1];
const cells: IncidentCell[] = [0, 1].map((x) => ({
  id: `${x}:0`,
  center: [x + 0.5, 0.5],
  bounds: [x, 0, x + 1, 1],
  counts: [0, 0, 0, 0],
  weighted: [0, 0, 0, 0],
  intensity: [0, 0, 0, 0],
  total: 0,
}));
const record = (
  id: string,
  changes: Partial<RecentRecord> = {},
): RecentRecord => ({
  id,
  point: [0.25, 0.25],
  category: 'Theft',
  eventAt: '2026-10-01T12:00:00',
  ...changes,
});

describe('fixed-area recent report bubbles', () => {
  it('counts reports, date ranges, categories and call statuses without raw identifiers or points', () => {
    const data = [
      record('one', { status: 'open', reportedAt: '2026-10-02T01:00:00' }),
      record('two', {
        category: 'Robbery',
        eventAt: '2026-09-30T23:30:00',
        reportedAt: '2026-10-02T08:00:00',
        status: 'closed',
      }),
      record('three'),
    ];
    const output = aggregateRecentBubbles(data, cells, bounds);
    expect(output).toEqual([
      {
        id: '0:0',
        center: [0.5, 0.5],
        bounds: [0, 0, 1, 1],
        count: 3,
        categories: [
          { name: 'Theft', count: 2 },
          { name: 'Robbery', count: 1 },
        ],
        firstAt: '2026-09-30T23:30:00',
        lastAt: '2026-10-01T12:00:00',
        lastReportedAt: '2026-10-02T08:00:00',
        openCalls: 1,
        closedCalls: 1,
      },
    ]);
    expect(JSON.stringify(output)).not.toContain('one');
    expect(JSON.stringify(output)).not.toContain('0.25');
  });
  it('deduplicates identical rows and keeps the latest revision regardless of input order', () => {
    const old = record('same', {
      updatedAt: '2026-10-01T12:00:00',
      status: 'open',
    });
    const newer = record('same', {
      updatedAt: '2026-10-02T12:00:00',
      point: [1.2, 0.4],
      status: 'closed',
    });
    for (const input of [
      [old, newer, old, newer],
      [newer, old, newer, old],
    ]) {
      const output = aggregateRecentBubbles(input, cells, bounds);
      expect(output).toHaveLength(1);
      expect(output[0]).toMatchObject({
        id: '1:0',
        count: 1,
        openCalls: 0,
        closedCalls: 1,
      });
    }
  });
  it('excludes conflicting equal-version rows, while a strictly newer valid version can resolve them', () => {
    const a = record('same', { updatedAt: '2026-10-01T12:00:00' });
    const b = { ...a, category: 'Robbery' };
    expect(aggregateRecentBubbles([a, b], cells, bounds)).toEqual([]);
    expect(aggregateRecentBubbles([b, a], cells, bounds)).toEqual([]);
    const newer = { ...a, updatedAt: '2026-10-02T12:00:00' };
    expect(aggregateRecentBubbles([a, b, newer], cells, bounds)[0].count).toBe(
      1,
    );
    expect(aggregateRecentBubbles([newer, b, a], cells, bounds)[0].count).toBe(
      1,
    );
  });
  it('deduplicates before geographic and category filters so stale records cannot reappear', () => {
    const old = record('same');
    const newer = record('same', {
      updatedAt: '2026-10-02T12:00:00',
      category: 'Robbery',
      point: [1.2, 0.4],
    });
    expect(
      aggregateRecentBubbles([old, newer], cells, bounds, 'Theft'),
    ).toEqual([]);
    const outside = { ...newer, point: [3, 0.4] as [number, number] };
    expect(aggregateRecentBubbles([old, outside], cells, bounds)).toEqual([]);
    const invalid = { ...newer, point: [NaN, 0.4] as [number, number] };
    expect(aggregateRecentBubbles([old, invalid], cells, bounds)).toEqual([]);
  });
  it('fails closed on an unorderable revision timestamp rather than restoring an older record', () => {
    expect(
      aggregateRecentBubbles(
        [record('same'), record('same', { updatedAt: 'bad' })],
        cells,
        bounds,
      ),
    ).toEqual([]);
  });
  it('uses half-open cells exactly once on shared edges and excludes the external cell boundary', () => {
    const output = aggregateRecentBubbles(
      [
        record('west', { point: [0, 0] }),
        record('shared', { point: [1, 0.5] }),
        record('east', { point: [2, 0.5] }),
        record('north', { point: [0.5, 1] }),
      ],
      cells,
      bounds,
    );
    expect(output.map((b) => [b.id, b.count])).toEqual([
      ['0:0', 1],
      ['1:0', 1],
    ]);
    expect(
      aggregateRecentBubbles(
        [record('halo', { point: [1.5, 0.5] })],
        cells,
        [0, 0, 1.4, 1],
      ),
    ).toEqual([]);
  });
  it('recomputes the whole bubble population for category filters', () => {
    const input = [
      record('one'),
      record('two', {
        category: 'Robbery',
        status: 'closed',
        eventAt: '2026-09-01T00:00:00',
        reportedAt: '2026-10-02T01:00:00',
      }),
    ];
    const filtered = aggregateRecentBubbles(input, cells, bounds, 'Theft')[0];
    expect(filtered.count).toBe(1);
    expect(filtered.categories).toEqual([{ name: 'Theft', count: 1 }]);
    expect(filtered.firstAt).toBe(input[0].eventAt);
    expect(filtered.closedCalls).toBe(0);
    expect(filtered.lastReportedAt).toBeUndefined();
  });
  it('rejects invalid coordinates, calendar dates, timestamps and empty category/identity', () => {
    const bad: Partial<RecentRecord>[] = [
      { point: [Infinity, 0] },
      { point: [181, 0] },
      { point: [0, 91] },
      { eventAt: '2026-02-29T12:00:00' },
      { eventAt: '2026-10-01T24:00:00' },
      { eventAt: '2026-10-01T12:60:00' },
      { eventAt: '2026-10-01T12:00:00Z' },
      { eventAt: '2026-10-01' },
      { reportedAt: 'invalid' },
      { category: ' ' },
      { id: '' },
      { status: 'unknown' as 'open' },
    ];
    for (const changes of bad)
      expect(
        aggregateRecentBubbles([record('bad', changes)], cells, bounds),
      ).toEqual([]);
    expect(
      aggregateRecentBubbles(
        [record('leap', { eventAt: '2024-02-29T12:00:00' })],
        cells,
        bounds,
      )[0].count,
    ).toBe(1);
  });
  it('compares fractional seconds and canonicalizes equivalent representations deterministically', () => {
    const a = record('same', {
      eventAt: '2026-10-01T12:00:00.000',
      updatedAt: '2026-10-01T13:00:00.0',
    });
    const b = record('same', {
      eventAt: '2026-10-01T12:00:00',
      updatedAt: '2026-10-01T13:00:00',
    });
    expect(aggregateRecentBubbles([a, b], cells, bounds)).toEqual(
      aggregateRecentBubbles([b, a], cells, bounds),
    );
    expect(aggregateRecentBubbles([a, b], cells, bounds)[0].count).toBe(1);
    const newer = record('same', {
      updatedAt: '2026-10-01T13:00:00.000001',
      category: 'Robbery',
    });
    expect(
      aggregateRecentBubbles([a, newer], cells, bounds)[0].categories[0].name,
    ).toBe('Robbery');
  });
  it('is deterministic, leaves inputs untouched and does not alias routing cell geometry', () => {
    const input = [
      record('b', { point: [1.2, 0.2] }),
      record('a', { category: 'Robbery' }),
      record('c'),
    ];
    const before = JSON.stringify({ input, cells });
    const output = aggregateRecentBubbles(input, cells, bounds);
    expect(output).toEqual(
      aggregateRecentBubbles(
        [...input].reverse(),
        [...cells].reverse(),
        bounds,
      ),
    );
    expect(JSON.stringify({ input, cells })).toBe(before);
    output[0].center[0] = 99;
    output[0].bounds[0] = 99;
    expect(JSON.stringify({ input, cells })).toBe(before);
  });
  it('does not invent cells for gaps, invalid or duplicated grid identifiers', () => {
    expect(aggregateRecentBubbles([record('one')], [], bounds)).toEqual([]);
    expect(aggregateRecentBubbles([record('one')], [cells[1]], bounds)).toEqual(
      [],
    );
    expect(
      aggregateRecentBubbles([record('one')], [cells[0], cells[0]], bounds),
    ).toEqual([]);
    expect(
      aggregateRecentBubbles([record('one')], cells, [2, 0, 1, 1]),
    ).toEqual([]);
  });
});

describe('bubble presentation helpers', () => {
  it('scales radius with the square root of positive integer counts and caps the visual size', () => {
    expect(bubbleRadius(4)).toBe(bubbleRadius(1) * 2);
    expect(bubbleRadius(10000)).toBe(32);
    for (const value of [
      0,
      -1,
      0.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(bubbleRadius(value)).toBe(0);
  });
  it('formats source civil time without a timezone shift or false UTC label', () => {
    expect(formatSourceTime('2026-10-01T23:30:00')).toBe('2026-10-01 23:30:00');
    expect(formatSourceTime('2026-10-01T23:30:00.123')).toBe(
      '2026-10-01 23:30:00',
    );
    expect(formatSourceTime('2026-02-30T23:30:00')).toBe('Time unavailable');
    expect(formatSourceTime('2026-10-01T23:30:00Z')).toBe('Time unavailable');
  });
});
