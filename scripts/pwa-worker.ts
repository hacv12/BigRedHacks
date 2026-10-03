export interface PwaAsset {
  path: string;
  sha256: string;
  json?: boolean;
}
export function serviceWorkerSource(
  base: string,
  revision: string,
  core: PwaAsset[],
  cities: PwaAsset[],
): string {
  return `/* Brisa app cache ${revision}. No external, tile, feed or search caching. */
const BASE = ${JSON.stringify(base)};
const REVISION = ${JSON.stringify(revision)};
const PREFIX = 'brisa-app-' + encodeURIComponent(BASE) + '-';
const CACHE = PREFIX + REVISION;
const CORE = ${JSON.stringify(core)};
const CITIES = ${JSON.stringify(cities)};
const ASSETS = new Map([...CORE, ...CITIES].map(asset => [asset.path, asset]));
const canonical = (path) => new URL(path, self.location.origin).href;
async function verified(response, asset) {
  if (!response.ok || response.type === 'opaque') throw new Error('Download failed');
  const bytes = await response.clone().arrayBuffer();
  const payload = asset.json ? new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)))) : bytes;
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)), value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== asset.sha256) throw new Error('App version changed. Update the app before downloading this area.');
  return response;
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try {
    for (const asset of CORE) {
      const response = await verified(await fetch(canonical(asset.path), { cache: 'reload', credentials: 'same-origin' }), asset);
      await cache.put(canonical(asset.path), response);
    }
  } catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const current = await caches.open(CACHE);
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    const previous = await caches.open(name);
    for (const asset of CITIES) {
      const key = canonical(asset.path);
      if (await current.match(key)) continue;
      const response = await previous.match(key);
      if (response) { try { await current.put(key, await verified(response, asset)); } catch { /* Changed packages require a fresh online download. */ } }
    }
    await caches.delete(name);
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  // Navigation uses only the canonical shell key: endpoint coordinates never enter cache keys.
  if (request.mode === 'navigate') {
    if (url.pathname !== BASE && url.pathname !== BASE + 'index.html') return;
    event.respondWith(caches.open(CACHE).then(cache => cache.match(canonical(BASE + 'index.html'))).then(response => response || fetch(request)));
    return;
  }
  if (url.search || !ASSETS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const stored = await cache.match(canonical(url.pathname));
    if (stored) return stored;
    try {
      const response = await verified(await fetch(request), ASSETS.get(url.pathname));
      await cache.put(canonical(url.pathname), response.clone());
      return response;
    } catch (error) { return new Response(String(error.message || error), { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});
self.addEventListener('message', event => {
  const reply = value => event.ports[0]?.postMessage(value);
  if (event.data?.type === 'SKIP_WAITING') { event.waitUntil(self.skipWaiting()); return; }
  if (event.data?.type === 'CACHE_STATUS') {
    event.waitUntil((async () => { const cache = await caches.open(CACHE); const present = []; for (const asset of CITIES) if (await cache.match(canonical(asset.path))) present.push(asset.path); reply({ ok: true, revision: REVISION, cities: present }); })());
    return;
  }
  if (event.data?.type !== 'CACHE_CITY') return;
  event.waitUntil((async () => {
    try {
      const client = event.source?.id ? await self.clients.get(event.source.id) : null;
      if (!client || new URL(client.url).origin !== self.location.origin) throw new Error('Unrecognized app client');
      const asset = CITIES.find(item => item.path === event.data.path);
      if (!asset) throw new Error('Unknown city package');
      const cache = await caches.open(CACHE);
      if (!(await cache.match(canonical(asset.path)))) {
        const response = new Response(JSON.stringify(event.data.data), { headers: { 'Content-Type': 'application/json' } });
        await verified(response, asset);
        await cache.put(canonical(asset.path), response);
      }
      reply({ ok: true });
    } catch (error) { reply({ ok: false, error: String(error.message || error) }); }
  })());
});
`;
}
