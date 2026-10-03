/** Production-only smoke. Build first: npx vite build --outDir /private/tmp/brisa-pwa-build --emptyOutDir --base /pwa-test/ */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const base = process.env.PWA_TEST_URL || 'http://127.0.0.1:4175/pwa-test/';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.route(/^https:\/\//, (route) => route.abort());
  let cityDownloads = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/data/nyc-manhattan.json')) cityDownloads++;
  });
  await page.goto(base + '?area=nyc-manhattan');
  await page.locator('.route-card').first().waitFor({ timeout: 60000 });
  await page.waitForFunction(
    async () => {
      const names = await caches.keys();
      for (const name of names)
        if (
          (await (await caches.open(name)).keys()).some((r) =>
            r.url.endsWith('/data/nyc-manhattan.json'),
          )
        )
          return true;
      return false;
    },
    null,
    { timeout: 60000 },
  );
  assert.equal(
    cityDownloads,
    1,
    'First city is saved from memory without downloading twice',
  );
  const keys = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map((r) => r.url),
        ),
      )
    ).flat(),
  );
  assert.equal(
    keys.filter((k) => /\/data\/(?!catalog)[^/]+\.json$/.test(k)).length,
    1,
    'Only visited city cached',
  );
  assert(
    keys.every((k) => !new URL(k).search && k.startsWith(base)),
    'No private query URLs or cross-origin resources cached',
  );
  const manifest = await page.evaluate(async () =>
    (await fetch(document.querySelector('link[rel=manifest]').href)).json(),
  );
  assert.equal(manifest.scope, new URL(base).pathname);
  await context.setOffline(true);
  await page.goto(base + '?area=nyc-manhattan&private-test=coordinates');
  await page.locator('.route-card').first().waitFor({ timeout: 60000 });
  const cachedQuery = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).some(
            (r) => new URL(r.url).search,
          ),
        ),
      )
    ).some(Boolean),
  );
  assert.equal(cachedQuery, false);
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await page.locator('.route-card').first().waitFor();
  console.log(
    'PASS: production scope, one-download first-visit city cache, offline query navigation and routing worker, no private/external cache keys.',
  );
  await context.close();
} finally {
  await browser.close();
}
