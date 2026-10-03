import { test as base, expect } from '@playwright/test';

// Browser regressions never consume public API capacity. Individual feed/search
// tests override these deterministic empty responses with their own fixtures.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://tile.openstreetmap.org/**', (route) =>
      route.abort(),
    );
    await page.route(
      /^https:\/\/(data\.cityofnewyork\.us|data\.cityofchicago\.org|data\.sf\.gov)\/resource\//,
      async (route) => {
        const maximum = new URL(route.request().url()).searchParams
          .get('$select')
          ?.startsWith('max(');
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(
            maximum ? [{ latest: '2026-06-30T00:00:00' }] : [],
          ),
        });
      },
    );
    await page.route('https://photon.komoot.io/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ type: 'FeatureCollection', features: [] }),
      }),
    );
    await use(page);
  },
});
export { expect };
