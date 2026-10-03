import type { Bounds, IncidentCell, LngLat } from './types';
import type { RecentBubble, RecentRecord } from './recent-types';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finitePoint = (p: unknown): p is LngLat =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every(Number.isFinite) &&
  Math.abs(p[0]) <= 180 &&
  Math.abs(p[1]) <= 90;
const validBounds = (b: Bounds) =>
  b.length === 4 &&
  finitePoint(b.slice(0, 2)) &&
  finitePoint(b.slice(2)) &&
  b[0] < b[2] &&
  b[1] < b[3];
const contains = (p: LngLat, b: Bounds) =>
  p[0] >= b[0] && p[0] < b[2] && p[1] >= b[1] && p[1] < b[3];

/** Canonical sortable civil time; UTC is used only to check calendar arithmetic. */
function civil(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(
      value,
    );
  if (!m) return;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return;
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  check.setUTCHours(hour, minute, second, 0);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return;
  return `${value.slice(0, 19)}.${(m[7] ?? '').padEnd(6, '0')}`;
}

/** Display source civil time without interpreting it in the browser's timezone. */
export function formatSourceTime(value: string): string {
  return civil(value)
    ? value.slice(0, 19).replace('T', ' ')
    : 'Time unavailable';
}

interface Version {
  version: string;
  fingerprint: string;
  record: RecentRecord;
  valid: boolean;
  conflict: boolean;
}
function latestRecords(records: RecentRecord[]): RecentRecord[] {
  const latest = new Map<string, Version>();
  const unknowable = new Set<string>();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || !record.id.trim()) continue;
    const id = record.id.trim();
    const updated =
      record.updatedAt === undefined ? '' : civil(record.updatedAt);
    // A malformed revision time cannot safely be ordered against another version.
    if (updated === undefined) {
      unknowable.add(id);
      continue;
    }
    const event = civil(record.eventAt);
    const reported =
      record.reportedAt === undefined ? '' : civil(record.reportedAt);
    const valid =
      finitePoint(record.point) &&
      typeof record.category === 'string' &&
      record.category.trim().length > 0 &&
      event !== undefined &&
      reported !== undefined &&
      (record.status === undefined ||
        record.status === 'open' ||
        record.status === 'closed');
    const fingerprint = JSON.stringify([
      record.point,
      record.category,
      event,
      reported,
      record.status,
    ]);
    const previous = latest.get(id);
    if (!previous || updated > previous.version) {
      latest.set(id, {
        version: updated,
        fingerprint,
        record,
        valid,
        conflict: false,
      });
    } else if (updated === previous.version) {
      if (fingerprint !== previous.fingerprint) previous.conflict = true;
      if (!valid) previous.valid = false;
    }
  }
  const normalized = (value: string) => {
    const key = civil(value)!;
    const fraction = key.slice(20).replace(/0+$/, '');
    return key.slice(0, 19) + (fraction ? `.${fraction}` : '');
  };
  return [...latest]
    .filter(([id, v]) => !unknowable.has(id) && v.valid && !v.conflict)
    .map(([, v]) => ({
      ...v.record,
      eventAt: normalized(v.record.eventAt),
      ...(v.record.reportedAt !== undefined
        ? { reportedAt: normalized(v.record.reportedAt) }
        : {}),
    }));
}

/** Bins accelerate fixed-grid lookup; final half-open checks settle boundaries. */
function lookupFor(cells: IncidentCell[]) {
  const seen = new Set<string>(),
    duplicates = new Set<string>();
  for (const c of cells) {
    if (seen.has(c.id)) duplicates.add(c.id);
    seen.add(c.id);
  }
  const valid = cells
    .filter(
      (c) =>
        typeof c.id === 'string' &&
        c.id &&
        !duplicates.has(c.id) &&
        validBounds(c.bounds) &&
        finitePoint(c.center) &&
        contains(c.center, c.bounds),
    )
    .sort((a, b) => compare(a.id, b.id));
  const width = Math.min(...valid.map((c) => c.bounds[2] - c.bounds[0]));
  const height = Math.min(...valid.map((c) => c.bounds[3] - c.bounds[1]));
  const bins = new Map<string, IncidentCell[]>(),
    large: IncidentCell[] = [];
  for (const c of valid) {
    const [w, s, e, n] = c.bounds;
    const x0 = Math.floor(w / width),
      x1 = Math.floor(e / width);
    const y0 = Math.floor(s / height),
      y1 = Math.floor(n / height);
    if (
      ![x0, x1, y0, y1].every(Number.isSafeInteger) ||
      (x1 - x0 + 1) * (y1 - y0 + 1) > 64
    ) {
      large.push(c);
      continue;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const list = bins.get(key);
        if (list) list.push(c);
        else bins.set(key, [c]);
      }
  }
  return (point: LngLat) => {
    const candidates =
      bins.get(
        `${Math.floor(point[0] / width)},${Math.floor(point[1] / height)}`,
      ) ?? [];
    const local = candidates.find((c) => contains(point, c.bounds));
    const broad = large.find((c) => contains(point, c.bounds));
    return !local
      ? broad
      : !broad || compare(local.id, broad.id) < 0
        ? local
        : broad;
  };
}

/** Pure, fixed-area counts. Neither records nor historical routing cells are mutated. */
export function aggregateRecentBubbles(
  records: RecentRecord[],
  cells: IncidentCell[],
  bounds: Bounds,
  category?: string,
): RecentBubble[] {
  if (!validBounds(bounds)) return [];
  const lookup = lookupFor(cells);
  const groups = new Map<
    string,
    { bubble: RecentBubble; categories: Map<string, number> }
  >();
  // Resolve revisions globally before filtering: older locations/categories must not reappear.
  for (const record of latestRecords(records)) {
    const [x, y] = record.point;
    if (
      x < bounds[0] ||
      x > bounds[2] ||
      y < bounds[1] ||
      y > bounds[3] ||
      (category !== undefined && record.category !== category)
    )
      continue;
    const cell = lookup(record.point);
    if (!cell) continue;
    let group = groups.get(cell.id);
    if (!group) {
      group = {
        bubble: {
          id: cell.id,
          center: [...cell.center],
          bounds: [...cell.bounds],
          count: 0,
          categories: [],
          firstAt: record.eventAt,
          lastAt: record.eventAt,
          openCalls: 0,
          closedCalls: 0,
        },
        categories: new Map(),
      };
      groups.set(cell.id, group);
    }
    const b = group.bubble;
    b.count++;
    group.categories.set(
      record.category,
      (group.categories.get(record.category) ?? 0) + 1,
    );
    if (civil(record.eventAt)! < civil(b.firstAt)!) b.firstAt = record.eventAt;
    if (civil(record.eventAt)! > civil(b.lastAt)!) b.lastAt = record.eventAt;
    if (
      record.reportedAt &&
      (!b.lastReportedAt ||
        civil(record.reportedAt)! > civil(b.lastReportedAt)!)
    )
      b.lastReportedAt = record.reportedAt;
    if (record.status === 'open') b.openCalls++;
    if (record.status === 'closed') b.closedCalls++;
  }
  return [...groups.values()]
    .map(({ bubble, categories }) => ({
      ...bubble,
      categories: [...categories]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || compare(a.name, b.name)),
    }))
    .sort((a, b) => compare(a.id, b.id));
}

/** Circle area tracks count until the display cap; labels must retain the true count. */
export function bubbleRadius(count: number): number {
  return Number.isSafeInteger(count) && count > 0
    ? Math.min(32, 7 * Math.sqrt(count))
    : 0;
}
