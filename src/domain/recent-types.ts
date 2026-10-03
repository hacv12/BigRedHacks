import type { Bounds, LngLat } from './types';

/** Source civil timestamps have no offset; always display their source timezone. */
export interface RecentRecord {
  id: string;
  point: LngLat;
  category: string;
  eventAt: string;
  reportedAt?: string;
  updatedAt?: string;
  status?: 'open' | 'closed';
}

export interface RecentSource {
  id: string;
  cityId: string;
  name: string;
  kind: 'reports' | 'calls';
  sourceUrl: string;
  cadence: string;
  delayNote: string;
  scopeNote: string;
  locationNote: string;
  eventLabel: 'Occurred' | 'Call received';
  refreshIntervalMs: number;
}

export interface RecentFeed {
  areaId: string;
  sourceId: string;
  /** UTC time when this complete fetch succeeded, distinct from source dates. */
  checkedAt: string;
  publisherUpdatedAt?: string;
  /** Source civil time; latest dataset event, not a coverage guarantee. */
  latestAvailableAt?: string;
  windowStart: string;
  windowEnd: string;
  records: RecentRecord[];
  excludedRows: number;
  /** True means a bounded response was cut off; counts are incomplete. */
  limited: boolean;
}

export interface RecentBubble {
  id: string;
  center: LngLat;
  bounds: Bounds;
  count: number;
  categories: { name: string; count: number }[];
  firstAt: string;
  lastAt: string;
  lastReportedAt?: string;
  openCalls: number;
  closedCalls: number;
}
