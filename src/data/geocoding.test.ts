import { describe, expect, it, vi } from 'vitest';
import {
  searchAddresses,
  GEOCODER_ATTRIBUTION,
  resolveGeocoderConfig,
} from './geocoding';
const area = {
  id: 'nyc',
  bounds: [-74.02, 40.7, -73.965, 40.78] as [number, number, number, number],
};
const feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-73.9857, 40.7484] },
  properties: {
    osm_type: 'W',
    osm_id: 1,
    name: 'Empire State Building',
    housenumber: '350',
    street: '5th Avenue',
    city: 'New York',
    state: 'New York',
  },
};
const response = (features: unknown[] = [feature]) =>
  new Response(JSON.stringify({ type: 'FeatureCollection', features }));
const signal = () => new AbortController().signal;
describe('bounded Photon address search', () => {
  it('requests fixed keyless provider, coverage and minimal results; maps actual feature schema', async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    const result = await searchAddresses(
      '  350   Fifth Avenue ',
      area,
      signal(),
      { fetcher },
    );
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.origin).toBe('https://photon.komoot.io');
    expect(url.searchParams.get('bbox')).toBe(area.bounds.join(','));
    expect(url.searchParams.get('q')).toBe('350 Fifth Avenue');
    expect(url.searchParams.get('limit')).toBe('6');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(result[0]).toMatchObject({
      name: 'Empire State Building',
      detail: '350 5th Avenue, New York',
      kind: 'address',
      provider: 'photon',
    });
    expect(GEOCODER_ATTRIBUTION.dataUrl).toContain(
      'openstreetmap.org/copyright',
    );
  });
  it('rejects out-of-bounds, malformed, duplicate and unnamed results', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response([
        feature,
        feature,
        { ...feature, geometry: { type: 'Point', coordinates: [0, 0] } },
        {
          ...feature,
          geometry: { type: 'Point', coordinates: ['-73.98', 40.74] },
        },
        { ...feature, properties: {} },
        null,
      ]),
    );
    expect(
      await searchAddresses('Empire', area, signal(), { fetcher }),
    ).toHaveLength(1);
  });
  it('does not request short queries, invalid coverage or pre-aborted searches', async () => {
    const fetcher = vi.fn();
    expect(await searchAddresses('ab', area, signal(), { fetcher })).toEqual(
      [],
    );
    await expect(
      searchAddresses(
        'Empire',
        { ...area, bounds: [-200, 0, 0, 1] },
        signal(),
        { fetcher },
      ),
    ).rejects.toThrow('coverage');
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchAddresses('Empire', area, controller.signal, { fetcher }),
    ).rejects.toThrow('cancelled');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('caches normalized query and bounds, protecting results from caller mutation', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response());
    let clock = 10000;
    const options = { fetcher, now: () => clock };
    const first = await searchAddresses('Empire', area, signal(), options);
    first[0].point[0] = 0;
    const cached = await searchAddresses(' empire ', area, signal(), options);
    expect(cached[0].point[0]).toBe(-73.9857);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 300001;
    await searchAddresses('Empire', area, signal(), options);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('fails explicitly on HTTP429, invalid JSON and malformed schema', async () => {
    await expect(
      searchAddresses('Empire', area, signal(), {
        fetcher: vi.fn().mockResolvedValue(new Response('', { status: 429 })),
      }),
    ).rejects.toThrow('busy');
    await expect(
      searchAddresses('Empire', area, signal(), {
        fetcher: vi.fn().mockResolvedValue(new Response('invalid')),
      }),
    ).rejects.toThrow();
    await expect(
      searchAddresses('Empire', area, signal(), {
        fetcher: vi.fn().mockResolvedValue(new Response('{}')),
      }),
    ).rejects.toThrow('invalid response');
  });
  it('aborts in-flight work and times out even if a fetch implementation never settles', async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = searchAddresses('Empire', area, controller.signal, {
      fetcher,
    });
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    vi.useFakeTimers();
    try {
      const timed = searchAddresses('Empire', area, signal(), {
        fetcher: vi.fn().mockImplementation(() => new Promise(() => {})),
      });
      const check = expect(timed).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(12000);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });
  it('spaces uncached requests and cancellation prevents a queued request', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn().mockImplementation(async () => response());
      await searchAddresses('Empire', area, signal(), { fetcher });
      const controller = new AbortController();
      const pending = searchAddresses('Times Square', area, controller.signal, {
        fetcher,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      controller.abort();
      await expect(pending).rejects.toThrow('cancelled');
      await vi.advanceTimersByTimeAsync(1500);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('geocoder deployment configuration', () => {
  it('defaults to Photon while naming a configured provider honestly', () => {
    expect(resolveGeocoderConfig(undefined).endpoint).toBe(
      'https://photon.komoot.io/api/',
    );
    const configured = resolveGeocoderConfig(
      'https://search.example.com/photon/api/',
    );
    expect(configured.endpoint).toBe('https://search.example.com/photon/api/');
    expect(configured.attribution.disclosure).toContain(
      'sent to search.example.com',
    );
    expect(configured.attribution.disclosure).not.toContain('sent to Photon');
    expect(configured.attribution.label).toContain('search.example.com');
  });
  it.each([
    'http://example.com/api/',
    'javascript:alert(1)',
    'https://user:pass@example.com/api/',
    'https://example.com/api/?key=secret',
    'https://example.com/api/#hash',
    'not a url',
  ])('rejects unsafe or ambiguous endpoint %s', (url) => {
    expect(() => resolveGeocoderConfig(url, true)).toThrow();
  });
  it('allows HTTP loopback only during development', () => {
    expect(
      resolveGeocoderConfig('http://localhost:2322/api/', true).endpoint,
    ).toBe('http://localhost:2322/api/');
    expect(
      resolveGeocoderConfig('http://127.0.0.1:2322/api/', true).endpoint,
    ).toContain('127.0.0.1');
    expect(() =>
      resolveGeocoderConfig('http://localhost:2322/api/', false),
    ).toThrow();
  });
});
