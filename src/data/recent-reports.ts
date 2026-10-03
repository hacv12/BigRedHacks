import type { CoverageArea, LngLat } from '../domain/types';
import type {
  RecentFeed,
  RecentRecord,
  RecentSource,
} from '../domain/recent-types';

const CAP = 5000;
const CALLS: Record<string, string> = {
  '211': 'Robbery',
  '212': 'Strongarm robbery',
  '216': 'Shots fired',
  '217': 'Shooting',
  '219': 'Stabbing',
  '240': 'Assault / battery',
  '245': 'Aggravated assault',
  '418': 'Fight without weapon',
};
const NYC: Record<string, string> = {
  '105': 'Robbery',
  '106': 'Felony assault',
  '344': 'Assault',
  '109': 'Grand larceny from person',
};
const CHICAGO = ['ROBBERY', 'THEFT', 'ASSAULT', 'BATTERY'];
const PLACES = [
  'STREET',
  'SIDEWALK',
  'PARK PROPERTY',
  'LAKEFRONT / WATERFRONT / RIVERBANK',
  'BRIDGE',
  'CTA BUS STOP',
];
const SUBTYPES = ['404', '406', '408', '414', '415', '417', '419'];
const configs = {
  nyc: {
    host: 'data.cityofnewyork.us',
    dataset: '5uac-w243',
    timezone: 'America/New_York',
    date: 'cmplnt_fr_dt',
    fields:
      'cmplnt_num,cmplnt_fr_dt,cmplnt_fr_tm,rpt_dt,ky_cd,pd_cd,prem_typ_desc,latitude,longitude',
    filter:
      "prem_typ_desc in ('STREET','PARK/PLAYGROUND') AND (ky_cd in ('105','106','344') OR (ky_cd='109' AND pd_cd in ('404','406','408','414','415','417','419')))",
  },
  chicago: {
    host: 'data.cityofchicago.org',
    dataset: 'ijzp-q8t2',
    timezone: 'America/Chicago',
    date: 'date',
    fields:
      'id,date,primary_type,location_description,domestic,latitude,longitude,updated_on',
    filter:
      "domestic=false AND primary_type in ('ROBBERY','THEFT','ASSAULT','BATTERY') AND location_description in ('STREET','SIDEWALK','PARK PROPERTY','LAKEFRONT / WATERFRONT / RIVERBANK','BRIDGE','CTA BUS STOP')",
  },
  sf: {
    host: 'data.sf.gov',
    dataset: 'gnap-fj3t',
    timezone: 'America/Los_Angeles',
    date: 'received_datetime',
    fields:
      'cad_number,received_datetime,call_type_final,agency,sensitive_call,intersection_point,close_datetime,call_last_updated_at',
    filter:
      "agency='Police' AND sensitive_call=false AND call_type_final in ('211','212','216','217','219','240','245','418')",
  },
} as const;
const sources: Record<string, RecentSource> = Object.fromEntries(
  Object.entries(configs).map(([cityId, c]) => [
    cityId,
    {
      id: c.dataset,
      cityId,
      name:
        cityId === 'sf'
          ? 'Selected police dispatch calls'
          : cityId === 'nyc'
            ? 'NYPD published complaints'
            : 'Chicago published crime reports',
      kind: cityId === 'sf' ? 'calls' : 'reports',
      sourceUrl: `https://${c.host}/d/${c.dataset}`,
      cadence:
        cityId === 'sf'
          ? 'Every 10 minutes'
          : cityId === 'nyc'
            ? 'Quarterly'
            : 'Daily',
      delayNote:
        cityId === 'sf'
          ? 'Additional 10-minute delay; calls are unverified and may change.'
          : cityId === 'nyc'
            ? 'Quarterly releases can be months behind today.'
            : 'Excludes the latest seven days; publication may lag further.',
      scopeNote:
        cityId === 'sf'
          ? 'Selected violence and robbery dispatch types; not confirmed crimes or necessarily outdoor events.'
          : 'Selected reported offenses at street and park premises; not all crime. NYC timestamps indicate complaint occurrence start, which may begin a broader interval.',
      locationNote:
        cityId === 'sf'
          ? 'Locations anonymized to nearby intersections.'
          : 'Approximate block locations, not exact incident sites.',
      eventLabel: cityId === 'sf' ? 'Call received' : 'Occurred',
      // Poll frequency detects published updates; it cannot remove publisher lag.
      refreshIntervalMs:
        cityId === 'sf'
          ? 60_000
          : cityId === 'chicago'
            ? 3_600_000
            : 21_600_000,
    },
  ]),
);
export function getRecentSource(cityId: string): RecentSource | undefined {
  return sources[cityId];
}

function civil(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
  )
    return;
  const normalized = value.slice(0, 19);
  const parsed = new Date(`${normalized}Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== normalized
  )
    return;
  return normalized;
}
function localNow(now: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
type Row = Record<string, unknown>;
export async function loadRecentFeed(
  area: CoverageArea,
  signal: AbortSignal,
  options: { now?: Date; fetcher?: typeof fetch } = {},
): Promise<RecentFeed> {
  const config = configs[area.cityId as keyof typeof configs];
  if (!config) throw new Error('No verified recent feed for this city.');
  const [west, south, east, north] = area.bounds;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north ||
    east - west > 1 ||
    north - south > 1
  )
    throw new Error('Invalid coverage bounds.');
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid current time.');
  const endNow = localNow(now, config.timezone);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 25_000);
  const fetcher = options.fetcher ?? fetch;
  let publisherUpdatedAt: string | undefined;
  async function query(params: Record<string, string>): Promise<Row[]> {
    if (controller.signal.aborted)
      throw new DOMException('Request aborted', 'AbortError');
    const url = new URL(
      `https://${config.host}/resource/${config.dataset}.json`,
    );
    url.search = new URLSearchParams(params).toString();
    const response = await fetcher(url.toString(), {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok)
      throw new Error(`Official source request failed (${response.status}).`);
    const modified = response.headers.get('Last-Modified');
    if (
      modified &&
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
        modified,
      )
    ) {
      const date = new Date(modified);
      if (Number.isFinite(date.getTime()) && date.getTime() <= now.getTime())
        publisherUpdatedAt = date.toISOString();
    }
    const body: unknown = await response.json();
    if (controller.signal.aborted)
      throw new DOMException('Request aborted', 'AbortError');
    if (
      !Array.isArray(body) ||
      body.length > CAP ||
      body.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
    )
      throw new Error('Invalid official source response.');
    return body as Row[];
  }
  try {
    let latestAvailableAt: string | undefined;
    let windowEnd = endNow;
    let windowStart = localNow(
      new Date(now.getTime() - 48 * 3600_000),
      config.timezone,
    );
    {
      const latest = await query({
        $select: `max(${config.date}) as latest`,
        $where: `${config.date} <= '${endNow}'`,
      });
      const rawLatest = latest[0]?.latest;
      if (latest.length > 1 || (rawLatest != null && !civil(rawLatest)))
        throw new Error('Invalid source latest date.');
      latestAvailableAt = civil(rawLatest);
      if (latestAvailableAt && latestAvailableAt > endNow)
        throw new Error('Source returned a future latest date.');
      if (
        area.cityId !== 'sf' &&
        (!latestAvailableAt || latestAvailableAt > endNow)
      )
        throw new Error('Source latest occurrence date is unavailable.');
      if (area.cityId !== 'sf' && latestAvailableAt) {
        windowEnd = `${latestAvailableAt.slice(0, 10)}T23:59:59`;
        if (windowEnd > endNow) windowEnd = endNow;
        windowStart = new Date(
          Date.parse(`${latestAvailableAt.slice(0, 10)}T00:00:00Z`) -
            29 * 86400_000,
        )
          .toISOString()
          .slice(0, 19);
      }
    }
    const geography =
      area.cityId === 'sf'
        ? `within_box(intersection_point,${north},${west},${south},${east})`
        : `latitude between ${south} and ${north} AND longitude between ${west} and ${east}`;
    const rows = await query({
      $select: config.fields,
      $where: `${config.filter} AND ${geography} AND ${config.date} >= '${windowStart}' AND ${config.date} <= '${windowEnd}'`,
      $limit: String(CAP),
      $order:
        area.cityId === 'sf'
          ? 'cad_number'
          : area.cityId === 'nyc'
            ? 'cmplnt_num'
            : 'id',
    });
    if (rows.length === CAP)
      throw new Error(
        'Source response reached the record limit; counts would be incomplete.',
      );
    const records = new Map<string, RecentRecord>();
    let excludedRows = 0;
    const seen = new Map<string, string>();
    for (const row of rows) {
      const rawId =
        row[
          area.cityId === 'sf'
            ? 'cad_number'
            : area.cityId === 'nyc'
              ? 'cmplnt_num'
              : 'id'
        ];
      if (typeof rawId === 'string') {
        const fingerprint = JSON.stringify(
          config.fields.split(',').map((field) => row[field] ?? null),
        );
        if (seen.has(rawId)) {
          if (seen.get(rawId) !== fingerprint)
            throw new Error(
              'Conflicting duplicate source records; counts are ambiguous.',
            );
          excludedRows++;
          continue;
        }
        seen.set(rawId, fingerprint);
      }
      const optionalDates = [
        row.rpt_dt,
        row.updated_on,
        row.call_last_updated_at,
        row.close_datetime,
      ];
      if (
        optionalDates.some(
          (value) => value != null && (!civil(value) || civil(value)! > endNow),
        )
      ) {
        excludedRows++;
        continue;
      }
      let category: string | undefined;
      let id: unknown;
      let eventAt: string | undefined;
      let point: LngLat;
      if (area.cityId === 'sf') {
        category = CALLS[String(row.call_type_final)];
        if (row.agency !== 'Police' || row.sensitive_call !== false)
          category = undefined;
        id = row.cad_number;
        eventAt = civil(row.received_datetime);
        const geometry = row.intersection_point as
          { type?: unknown; coordinates?: unknown } | undefined;
        const coords =
          geometry?.type === 'Point' && Array.isArray(geometry.coordinates)
            ? geometry.coordinates
            : [];
        point = [coords[0], coords[1]] as LngLat;
      } else {
        point = [Number(row.longitude), Number(row.latitude)];
        if (area.cityId === 'nyc') {
          category = NYC[String(row.ky_cd)];
          if (
            !['STREET', 'PARK/PLAYGROUND'].includes(
              String(row.prem_typ_desc),
            ) ||
            (String(row.ky_cd) === '109' &&
              !SUBTYPES.includes(String(row.pd_cd)))
          )
            category = undefined;
          id = row.cmplnt_num;
          eventAt =
            civil(row.cmplnt_fr_dt) &&
            typeof row.cmplnt_fr_dt === 'string' &&
            typeof row.cmplnt_fr_tm === 'string'
              ? civil(`${row.cmplnt_fr_dt.slice(0, 10)}T${row.cmplnt_fr_tm}`)
              : undefined;
        } else {
          category =
            CHICAGO.includes(String(row.primary_type)) &&
            PLACES.includes(String(row.location_description)) &&
            row.domestic === false
              ? String(row.primary_type)
              : undefined;
          id = row.id;
          eventAt = civil(row.date);
        }
      }
      if (
        typeof id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        !category ||
        !eventAt ||
        eventAt < windowStart ||
        eventAt > windowEnd ||
        eventAt > endNow ||
        !point.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
        point[0] < west ||
        point[0] > east ||
        point[1] < south ||
        point[1] > north ||
        records.has(id)
      ) {
        excludedRows++;
        continue;
      }
      records.set(id, {
        id,
        point,
        category,
        eventAt,
        reportedAt: civil(row.rpt_dt),
        updatedAt: civil(row.updated_on ?? row.call_last_updated_at),
        ...(area.cityId === 'sf'
          ? {
              status: row.close_datetime
                ? ('closed' as const)
                : ('open' as const),
            }
          : {}),
      });
    }
    return {
      areaId: area.id,
      sourceId: config.dataset,
      checkedAt: (options.now ?? new Date()).toISOString(),
      publisherUpdatedAt,
      latestAvailableAt,
      windowStart,
      windowEnd,
      records: [...records.values()],
      excludedRows,
      limited: false,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
