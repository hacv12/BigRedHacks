import { test, expect } from './fixtures';

// No public tile traffic in regressions. Exercise the actual browser request
// headers: a missing Referer can produce a valid denial PNG, not a tileerror.
const tile = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
  'base64',
);

test('map tiles identify the site without disclosing the trip URL', async ({
  page,
}) => {
  const referrers: string[] = [];
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    referrers.push((await route.request().headerValue('referer')) ?? '');
    await route.fulfill({ contentType: 'image/png', body: tile });
  });
  await page.goto('/?area=nyc-manhattan');
  await expect(page.locator('.route-card').first()).toBeVisible();
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
  expect(referrers.length).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin + '/';
  expect(new Set(referrers)).toEqual(new Set([origin]));

  // App normally consumes shared trip coordinates immediately. Preserve private
  // values here to prove the tile request itself cannot leak paths/query/hash.
  await page.evaluate(() => {
    history.replaceState(
      null,
      '',
      '?origin=-73.99,40.75&destination=-73.97,40.76#private-trip',
    );
  });
  referrers.length = 0;
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => referrers.length).toBeGreaterThan(0);
  expect(new Set(referrers)).toEqual(new Set([origin]));
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    'content',
    'no-referrer',
  );
  await expect(page.locator('.tile-status')).toHaveCount(0);
});
