import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const now = new Date('2026-10-03T14:15:00Z');
const sf = '**/resource/gnap-fj3t.json?**';
const nyc = '**/resource/5uac-w243.json?**';
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Latest published activity', exact: true });
async function openDetails(page: Page) {
  const disclosure = page.locator('details.activity-details');
  if (await disclosure.count())
    await disclosure.evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
}
async function visibility(page: Page, value: 'visible' | 'hidden') {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => value,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.abort(),
  );
});

test('activity starts on and OFF remains respected across city changes', async ({
  page,
}) => {
  let sfRequests = 0;
  await page.route(sf, async (route) => {
    sfRequests++;
    await route.fulfill({ json: [] });
  });
  await page.route(nyc, (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams
        .get('$select')
        ?.startsWith('max(')
        ? [{ latest: '2026-06-30T00:00:00' }]
        : [],
    }),
  );
  await page.goto('/?area=nyc-manhattan');
  await expect(page.locator('.route-card').first()).toBeVisible();
  await openDetails(page);
  await expect(
    panel(page).getByRole('button', {
      name: 'Hide latest activity',
      exact: true,
    }),
  ).toBeVisible();
  await panel(page)
    .getByRole('button', { name: 'Hide latest activity', exact: true })
    .click();
  await page.getByLabel('City and coverage').selectOption('sf-downtown');
  await expect(page.locator('.route-card').first()).toBeVisible();
  await openDetails(page);
  await expect(
    panel(page).getByRole('button', {
      name: 'Show latest activity',
      exact: true,
    }),
  ).toBeVisible();
  expect(sfRequests).toBe(0);
  await panel(page)
    .getByRole('button', { name: 'Show latest activity', exact: true })
    .click();
  await expect.poll(() => sfRequests).toBe(2);
});

test('SF polls while visible, pauses hidden, catches up, and retains a good feed after failure', async ({
  page,
}) => {
  let requests = 0,
    fail = false;
  await page.route(sf, async (route) => {
    requests++;
    if (fail) return route.abort();
    const max = new URL(route.request().url()).searchParams
      .get('$select')
      ?.startsWith('max(');
    await route.fulfill({
      json: max ? [{ latest: '2026-10-03T07:10:00' }] : [],
    });
  });
  await page.goto('/?area=sf-downtown');
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('.route-card').first()).toBeVisible();
  await openDetails(page);
  await expect(panel(page)).toContainText('0 qualifying');
  await page.clock.fastForward(90_000);
  await expect.poll(() => requests).toBe(4);
  await visibility(page, 'hidden');
  await page.clock.fastForward(180_000);
  expect(requests).toBe(4);
  await visibility(page, 'visible');
  await expect.poll(() => requests).toBe(6);
  fail = true;
  await page.clock.fastForward(90_000);
  await expect(panel(page).getByRole('alert')).toContainText(
    'last successful check',
  );
  await expect(panel(page)).toContainText('0 qualifying');
  fail = false;
  await page.clock.fastForward(90_000);
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
});

test('NYC does not repeatedly request quarterly reports on SF polling cadence', async ({
  page,
}) => {
  let requests = 0;
  await page.route(nyc, async (route) => {
    requests++;
    await route.fulfill({
      json: new URL(route.request().url()).searchParams
        .get('$select')
        ?.startsWith('max(')
        ? [{ latest: '2026-06-30T00:00:00' }]
        : [],
    });
  });
  await page.goto('/?area=nyc-manhattan');
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('.route-card').first()).toBeVisible();
  await page.clock.fastForward(3_600_000);
  expect(requests).toBe(2);
  await visibility(page, 'hidden');
  await page.clock.fastForward(18_000_000);
  expect(requests).toBe(2);
  await visibility(page, 'visible');
  await expect.poll(() => requests).toBe(4);
});

test('hidden initial load is cancelled and resumes once visible without a late response replacing it', async ({
  page,
}) => {
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(sf, async (route) => {
    requests++;
    if (requests === 1) {
      await held;
      await route
        .fulfill({ json: [{ latest: '2026-10-03T07:00:00' }] })
        .catch(() => {});
      return;
    }
    const max = new URL(route.request().url()).searchParams
      .get('$select')
      ?.startsWith('max(');
    await route.fulfill({
      json: max ? [{ latest: '2026-10-03T07:10:00' }] : [],
    });
  });
  await page.goto('/?area=sf-downtown');
  await expect.poll(() => requests).toBe(1);
  await visibility(page, 'hidden');
  await page.clock.fastForward(31_000);
  expect(requests).toBe(1);
  await visibility(page, 'visible');
  await expect.poll(() => requests).toBe(3);
  release();
  await expect(page.locator('.route-card').first()).toBeVisible();
  await openDetails(page);
  await expect(panel(page)).toContainText('0 qualifying');
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
});

test('a newly published SF call appears automatically without changing the selected historical route', async ({
  page,
}) => {
  const call = {
    cad_number: 'initial-call',
    received_datetime: '2026-10-03T06:00:00',
    call_type_final: '211',
    agency: 'Police',
    sensitive_call: false,
    intersection_point: { type: 'Point', coordinates: [-122.4, 37.79] },
  };
  let rows = [call];
  await page.route(sf, async (route) => {
    const maximum = new URL(route.request().url()).searchParams
      .get('$select')
      ?.startsWith('max(');
    await route.fulfill({
      json: maximum ? [{ latest: '2026-10-03T07:10:00' }] : rows,
    });
  });
  await page.goto('/?area=sf-downtown');
  await expect(page.locator('.route-card').first()).toBeVisible();
  await openDetails(page);
  await expect(panel(page)).toContainText('1 shown in 1 approximate cells');
  await expect(page.locator('.activity-count')).toHaveCount(1);
  const selected = await page.locator('.route-card.selected').textContent();
  const comparisons = await page.locator('.route-card').allTextContents();
  rows = [
    call,
    {
      ...call,
      cad_number: 'newly-published-call',
      received_datetime: '2026-10-03T07:05:00',
    },
  ];
  // A source batch adds a second distinct call in the same fixed cell.
  // Advance the foreground polling clock; never press the refresh button.
  await page.clock.fastForward(90_000);
  await expect(panel(page)).toContainText('2 shown in 1 approximate cells');
  await expect(page.locator('.activity-count')).toHaveCount(1);
  const cell = panel(page)
    .getByRole('list', { name: 'Approximate activity cells' })
    .getByRole('button');
  await cell.click();
  await expect(
    panel(page).getByRole('region', { name: 'Selected activity cell' }),
  ).toContainText('Robbery: 2');
  expect(await page.locator('.route-card.selected').textContent()).toEqual(
    selected,
  );
  expect(await page.locator('.route-card').allTextContents()).toEqual(
    comparisons,
  );
});
