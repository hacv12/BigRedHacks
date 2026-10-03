import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { serviceWorkerSource } from '../../scripts/pwa-worker';
const origin = 'https://brisa.example';
const base = '/demo/';
const html = '<html>Brisa</html>';
const data = { manifest: { datasetId: 'city' }, nodes: [], edges: [] };
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function harness() {
  const handlers = new Map<string, (event: any) => void>();
  const stored = new Map<string, Map<string, Response>>();
  const requests: string[] = [];
  let body = JSON.stringify(data);
  const caches = {
    async open(name: string) {
      if (!stored.has(name)) stored.set(name, new Map());
      const map = stored.get(name)!;
      return {
        match: async (key: string) => map.get(key)?.clone(),
        put: async (key: string, value: Response) => {
          map.set(key, value.clone());
        },
      };
    },
    keys: async () => [...stored.keys()],
    delete: async (key: string) => stored.delete(key),
  };
  const self = {
    location: { origin },
    addEventListener: (type: string, fn: (event: any) => void) =>
      handlers.set(type, fn),
    clients: {
      claim: async () => {},
      get: async () => ({ url: `${origin}${base}` }),
    },
    skipWaiting: async () => {},
  };
  runInNewContext(
    serviceWorkerSource(
      base,
      'test-revision',
      [{ path: `${base}index.html`, sha256: digest(html) }],
      [
        {
          path: `${base}data/city.json`,
          sha256: digest(JSON.stringify(data)),
          json: true,
        },
      ],
    ),
    {
      self,
      caches,
      URL,
      Response,
      TextEncoder,
      TextDecoder,
      crypto: webcrypto,
      fetch: async (request: string | Request) => {
        const url = typeof request === 'string' ? request : request.url;
        requests.push(url);
        return new Response(url.endsWith('index.html') ? html : body);
      },
    },
  );
  async function lifecycle(type: string) {
    let pending!: Promise<unknown>;
    handlers.get(type)!({
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;
  }
  async function fetch(url: string, mode = 'cors') {
    let response: Promise<Response> | undefined;
    handlers.get('fetch')!({
      request: { url, mode, method: 'GET' },
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });
    return response && (await response);
  }
  async function message(payload: unknown) {
    let pending!: Promise<unknown>;
    let result: any;
    handlers.get('message')!({
      data: payload,
      source: { id: 'page' },
      ports: [
        {
          postMessage: (value: unknown) => {
            result = value;
          },
        },
      ],
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;
    return result;
  }
  return {
    stored,
    requests,
    lifecycle,
    fetch,
    message,
    setBody: (value: string) => {
      body = value;
    },
  };
}
describe('versioned offline service worker', () => {
  it('precaches only core and never predownloads all city packages', async () => {
    const app = harness();
    await app.lifecycle('install');
    expect(app.requests).toEqual([`${origin}${base}index.html`]);
  });
  it('uses a canonical shell for private coordinate navigation and never stores that URL', async () => {
    const app = harness();
    await app.lifecycle('install');
    expect(
      await (await app.fetch(
        `${origin}${base}?origin=-74,40&destination=-73,41`,
        'navigate',
      ))!.text(),
    ).toBe(html);
    expect(
      [...app.stored.values()].flatMap((cache) => [...cache.keys()]),
    ).toEqual([`${origin}${base}index.html`]);
  });
  it('does not intercept tile, feed, geocoder, arbitrary or query-bearing resource requests', async () => {
    const app = harness();
    for (const url of [
      'https://tile.openstreetmap.org/0/0/0.png',
      'https://data.sf.gov/resource/calls.json',
      'https://photon.komoot.io/api/?q=home',
      `${origin}${base}data/city.json?origin=secret`,
      `${origin}/other/`,
    ])
      expect(await app.fetch(url)).toBeUndefined();
  });
  it('caches a complete verified visited city response, retaining it after network data changes', async () => {
    const app = harness();
    await app.lifecycle('install');
    const url = `${origin}${base}data/city.json`;
    expect(await (await app.fetch(url))!.json()).toEqual(data);
    app.setBody('corrupted');
    expect(await (await app.fetch(url))!.json()).toEqual(data);
    expect(app.requests.filter((path) => path === url)).toHaveLength(1);
  });
  it('rejects a city from a different build without caching a partial or mixed package', async () => {
    const app = harness();
    await app.lifecycle('install');
    app.setBody(JSON.stringify({ ...data, nodes: [1] }));
    expect((await app.fetch(`${origin}${base}data/city.json`))!.status).toBe(
      503,
    );
    expect((await app.message({ type: 'CACHE_STATUS' })).cities).toEqual([]);
  });
  it('saves the already loaded first-visit dataset without another network request', async () => {
    const app = harness();
    await app.lifecycle('install');
    expect(
      await app.message({
        type: 'CACHE_CITY',
        path: `${base}data/city.json`,
        data,
      }),
    ).toEqual({ ok: true });
    expect(app.requests).toHaveLength(1);
    expect((await app.message({ type: 'CACHE_STATUS' })).cities).toEqual([
      `${base}data/city.json`,
    ]);
  });
  it('does not accept arbitrary paths or modified dataset messages', async () => {
    const app = harness();
    await app.lifecycle('install');
    expect(
      (
        await app.message({
          type: 'CACHE_CITY',
          path: `${base}?origin=secret`,
          data,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await app.message({
          type: 'CACHE_CITY',
          path: `${base}data/city.json`,
          data: { bad: true },
        })
      ).ok,
    ).toBe(false);
    expect((await app.message({ type: 'CACHE_STATUS' })).cities).toEqual([]);
  });
  it('preserves unchanged city packages across activation', async () => {
    const app = harness();
    app.stored.set(
      'brisa-app-%2Fdemo%2F-old',
      new Map([
        [origin + base + 'data/city.json', new Response(JSON.stringify(data))],
      ]),
    );
    await app.lifecycle('install');
    await app.lifecycle('activate');
    expect((await app.message({ type: 'CACHE_STATUS' })).cities).toEqual([
      base + 'data/city.json',
    ]);
  });
  it('rejects obsolete city revisions during migration', async () => {
    const app = harness();
    app.stored.set(
      'brisa-app-%2Fdemo%2F-old',
      new Map([
        [
          origin + base + 'data/city.json',
          new Response(JSON.stringify({ old: true })),
        ],
      ]),
    );
    await app.lifecycle('install');
    await app.lifecycle('activate');
    expect((await app.message({ type: 'CACHE_STATUS' })).cities).toEqual([]);
  });
  it('only removes obsolete caches for this app scope on activation', async () => {
    const app = harness();
    app.stored.set('brisa-app-%2Fother%2F-old', new Map());
    app.stored.set('brisa-app-%2Fdemo%2F-old', new Map());
    await app.lifecycle('install');
    await app.lifecycle('activate');
    expect([...app.stored.keys()]).toEqual([
      'brisa-app-%2Fother%2F-old',
      'brisa-app-%2Fdemo%2F-test-revision',
    ]);
  });
});
