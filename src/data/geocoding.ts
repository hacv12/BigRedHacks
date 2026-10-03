import type { CoverageArea, LngLat } from '../domain/types';

export interface GeocodingResult {
  id: string;
  name: string;
  detail: string;
  point: LngLat;
  kind: 'address' | 'place' | 'street';
  provider: 'photon';
}
export const GEOCODER_MIN_QUERY_LENGTH = 3;
const DEFAULT_ENDPOINT = 'https://photon.komoot.io/api/';
/** Configuration is a build-time public URL, never an endpoint supplied by a search result. */
export function resolveGeocoderConfig(
  value: string | undefined,
  development = false,
) {
  const endpoint = new URL(value?.trim() || DEFAULT_ENDPOINT);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== 'https:' &&
      !(development && local && endpoint.protocol === 'http:')) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      'Address provider URL must use HTTPS without credentials, query parameters or fragments. HTTP localhost is allowed only in development.',
    );
  }
  const publicPhoton = endpoint.origin === 'https://photon.komoot.io';
  return {
    endpoint: endpoint.toString(),
    attribution: {
      label: publicPhoton
        ? 'Search by Photon'
        : `Address provider · ${endpoint.host}`,
      url: endpoint.origin,
      dataLabel: '© OpenStreetMap contributors',
      dataUrl: 'https://www.openstreetmap.org/copyright',
      policyUrl: publicPhoton
        ? 'https://github.com/komoot/photon#demo-server'
        : endpoint.origin,
      disclosure: `Typed searches and the coverage boundary are sent to ${publicPhoton ? 'Photon' : endpoint.host}. Results are approximate places, not verified entrances.`,
    },
  };
}
// Invalid deployment configuration disables remote search, never silently sends to a different provider.
const configured = (() => {
  try {
    return {
      ...resolveGeocoderConfig(
        import.meta.env.VITE_GEOCODER_URL,
        import.meta.env.DEV,
      ),
      error: '',
    };
  } catch {
    return {
      endpoint: '',
      error:
        'Address provider configuration is invalid. Use a saved place or the map.',
      attribution: {
        label: 'Address provider unavailable',
        url: 'https://github.com/komoot/photon',
        dataLabel: '© OpenStreetMap contributors',
        dataUrl: 'https://www.openstreetmap.org/copyright',
        policyUrl: 'https://github.com/komoot/photon',
        disclosure:
          'Remote address search is unavailable. Saved places and the map remain available.',
      },
    };
  }
})();
export const GEOCODER_ATTRIBUTION = configured.attribution;
// Photon permits reasonable demo usage, including search-as-you-type, with no SLA.
// https://github.com/komoot/photon/blob/master/docs/api-v1.md
// UI debounces 500ms; additional shared 750ms pacing is not a provider quota.
const ENDPOINT = configured.endpoint;
const caches = new WeakMap<
  typeof fetch,
  Map<string, { expires: number; results: GeocodingResult[] }>
>();
const nextRequests = new WeakMap<typeof fetch, number>();
const clone = (results: GeocodingResult[]) =>
  results.map((result) => ({ ...result, point: [...result.point] as LngLat }));
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 200) : '';
const abortError = () =>
  new DOMException('Address search cancelled', 'AbortError');

export async function searchAddresses(
  query: string,
  area: Pick<CoverageArea, 'id' | 'bounds'>,
  signal: AbortSignal,
  options: { fetcher?: typeof fetch; now?: () => number } = {},
): Promise<GeocodingResult[]> {
  if (signal.aborted) throw abortError();
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < GEOCODER_MIN_QUERY_LENGTH) return [];
  if (configured.error) throw new Error(configured.error);
  if (q.length > 160) throw new Error('Search is too long.');
  const [west, south, east, north] = area.bounds;
  if (
    area.bounds.length !== 4 ||
    !area.bounds.every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north ||
    east - west > 1 ||
    north - south > 1
  )
    throw new Error('Invalid search coverage.');
  const now = options.now ?? Date.now,
    fetcher = options.fetcher ?? fetch;
  const key = JSON.stringify([area.id, area.bounds, q.toLocaleLowerCase('en')]);
  const cache = caches.get(fetcher) ?? new Map();
  caches.set(fetcher, cache);
  const cached = cache.get(key);
  if (cached && cached.expires > now()) return clone(cached.results);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, 12_000);
  let abortListener: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abortListener = () =>
      reject(
        timedOut
          ? new Error(
              'Address search timed out. Try a saved place or use the map.',
            )
          : abortError(),
      );
    controller.signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    const run = async () => {
      const wait = Math.max(0, (nextRequests.get(fetcher) ?? 0) - now());
      nextRequests.set(fetcher, now() + wait + 750);
      if (wait)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait);
          controller.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      if (controller.signal.aborted) throw abortError();
      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({
        q,
        bbox: area.bounds.join(','),
        limit: '6',
      }).toString();
      const response = await fetcher(url.toString(), {
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? 'Address search is busy. Try again shortly or use the map.'
            : 'Address search is unavailable. Try a saved place or use the map.',
        );
      const body = await response.json();
      if (controller.signal.aborted) throw abortError();
      if (
        !body ||
        body.type !== 'FeatureCollection' ||
        !Array.isArray(body.features) ||
        body.features.length > 50
      )
        throw new Error('Address search returned an invalid response.');
      const results: GeocodingResult[] = [],
        seen = new Set<string>();
      for (const feature of body.features) {
        const point = feature?.geometry?.coordinates;
        if (
          feature?.type !== 'Feature' ||
          feature?.geometry?.type !== 'Point' ||
          !Array.isArray(point) ||
          point.length !== 2 ||
          !point.every(
            (v: unknown) => typeof v === 'number' && Number.isFinite(v),
          ) ||
          point[0] < west ||
          point[0] > east ||
          point[1] < south ||
          point[1] > north
        )
          continue;
        const p = feature.properties;
        if (!p || typeof p !== 'object') continue;
        const address = [text(p.housenumber), text(p.street)]
          .filter(Boolean)
          .join(' ');
        const name = text(p.name) || address;
        if (!name) continue;
        const detail = [
          ...new Set(
            [address, text(p.district), text(p.city), text(p.state)].filter(
              (value) => value && value !== name,
            ),
          ),
        ].join(', ');
        const id = `photon:${String(p.osm_type ?? '')}:${String(p.osm_id ?? '')}:${point.join(',')}:${name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        results.push({
          id,
          name,
          detail,
          point: [...point] as LngLat,
          kind: text(p.housenumber)
            ? 'address'
            : p.type === 'street' || p.osm_key === 'highway'
              ? 'street'
              : 'place',
          provider: 'photon',
        });
        if (results.length === 6) break;
      }
      cache.set(key, { expires: now() + 5 * 60_000, results: clone(results) });
      while (cache.size > 40) cache.delete(cache.keys().next().value!);
      return results;
    };
    return await Promise.race([run(), cancelled]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    if (abortListener)
      controller.signal.removeEventListener('abort', abortListener);
  }
}
