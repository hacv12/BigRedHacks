import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Do not load public tiles in automated tests. Verify the bundled street fallback.
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.abort(),
  );
});

test('plans and changes routes, enforces zero detour, and exposes its sources', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?area=chicago-loop');
  await expect(
    page.getByRole('button', { name: /Compare walking routes/ }),
  ).toBeVisible();
  await expect(page.locator('.route-card').first()).toBeVisible();
  await expect(page.locator('.route-card.selected')).toHaveCount(1);
  await page.locator('.route-card').first().click();
  await expect(page.locator('.route-card').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByLabel('Room for a detour').fill('0');
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await expect(page.locator('.route-card')).toHaveCount(1);
  await expect(
    page.getByText(/No distinct lower-exposure alternative/),
  ).toBeVisible();

  await page.getByLabel(/Historical time window/).selectOption('3');
  await expect(page.locator('.map-location')).toContainText('6 pm');
  await expect(page.locator('.map-location')).toContainText('midnight');
  await expect(page.locator('.route-card')).toHaveCount(0);
  await page.getByLabel('Room for a detour').fill('10');
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await expect(page.locator('.route-card').first()).toBeVisible();
  await page
    .getByRole('button', { name: 'Toggle reported incident intensity' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Toggle reported incident intensity' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /Behind the routes/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/2025-01-01 through 2025-12-31/)).toBeVisible();
  await expect(dialog).toContainText('America/Chicago');
  const handoff = dialog.getByRole('link', {
    name: /Open destination in Google Maps/,
  });
  const handoffUrl = new URL((await handoff.getAttribute('href'))!);
  expect(handoffUrl.hostname).toBe('www.google.com');
  expect(handoffUrl.searchParams.get('api')).toBe('1');
  expect(handoffUrl.searchParams.has('waypoints')).toBe(false);
  await expect(dialog.getByText(/Google computes its own route/)).toBeVisible();
  await page.keyboard.press('Tab');
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('rejects identical endpoints without leaving an old route on screen', async ({
  page,
}) => {
  await page.goto('/?area=chicago-loop');
  await expect(page.locator('.route-card').first()).toBeVisible();
  const origin = await page.locator('#origin').inputValue();
  await page.locator('#destination').selectOption(origin);
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await expect(page.getByRole('alert')).toContainText('same street node');
  await expect(page.locator('.route-card')).toHaveCount(0);
});

test('shows a recoverable data error when the snapshot cannot load', async ({
  page,
}) => {
  await page.route('**/data/chicago-loop.json', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page.goto('/?area=chicago-loop');
  await expect(page.getByRole('alert')).toContainText('Unable to load');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.unroute('**/data/chicago-loop.json');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.route-card').first()).toBeVisible();
});
