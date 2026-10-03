import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
const NYC = '**/resource/5uac-w243.json?**';
const SF = '**/resource/gnap-fj3t.json?**';
const now = new Date('2026-10-03T14:15:00Z');
const nycRows = [
  {
    cmplnt_num: '123',
    cmplnt_fr_dt: '2026-06-15T00:00:00',
    cmplnt_fr_tm: '12:30:00',
    ky_cd: '105',
    pd_cd: '1',
    prem_typ_desc: 'STREET',
    longitude: '-74.012',
    latitude: '40.745',
  },
  {
    cmplnt_num: '124',
    cmplnt_fr_dt: '2026-06-16T00:00:00',
    cmplnt_fr_tm: '14:30:00',
    ky_cd: '105',
    pd_cd: '1',
    prem_typ_desc: 'STREET',
    longitude: '-74.012',
    latitude: '40.745',
  },
  {
    cmplnt_num: '125',
    cmplnt_fr_dt: '2026-06-17T00:00:00',
    cmplnt_fr_tm: '15:30:00',
    ky_cd: '344',
    pd_cd: '1',
    prem_typ_desc: 'PARK/PLAYGROUND',
    longitude: '-73.99',
    latitude: '40.76',
  },
];
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Latest published activity', exact: true });
const cells = (page: Page) =>
  panel(page)
    .getByRole('list', { name: 'Approximate activity cells' })
    .getByRole('button');
async function fulfill(
  route: Route,
  rows: unknown = nycRows,
  latest = '2026-06-30T00:00:00',
) {
  const isMax = new URL(route.request().url()).searchParams
    .get('$select')
    ?.startsWith('max(');
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(isMax ? [{ latest }] : rows),
  });
}
async function ready(page: Page, area = 'nyc-manhattan') {
  await page.goto(`/?area=${area}`);
  await expect(page.locator('.route-card').first()).toBeVisible({
    timeout: 15000,
  });
}
async function enable(page: Page) {
  await panel(page)
    .getByRole('button', { name: 'Show latest activity', exact: true })
    .click();
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.abort(),
  );
});

test('NYC report bubbles filter and select accessibly without changing the historical routes', async ({
  page,
}) => {
  await page.route(NYC, (route) => fulfill(route));
  await ready(page);
  const routes = await page.locator('.route-card').allTextContents();
  const selection = await page.locator('.route-card.selected').textContent();
  await enable(page);
  await expect(cells(page)).toHaveCount(2);
  await expect(panel(page)).toContainText('3 qualifying reports in response');
  await expect(panel(page)).toContainText('Quarterly');
  await expect(panel(page)).toContainText('2026-06-01 – 2026-06-30');
  await expect(panel(page)).not.toContainText(/live crime/i);
  await expect(page.locator('.activity-count')).toHaveCount(2);
  await panel(page).getByLabel('Activity category').selectOption('Robbery');
  await expect(cells(page)).toHaveCount(1);
  await expect(panel(page)).toContainText('2 shown in 1 approximate cells');
  await cells(page).first().click();
  const selected = panel(page).getByRole('region', {
    name: 'Selected activity cell',
  });
  await expect(selected).toContainText('Robbery: 2');
  await expect(selected).toContainText('approximately 250 m cell');
  await panel(page).locator('summary').click();
  await expect(panel(page)).toContainText('Unavailable from this source');
  await expect(panel(page)).toContainText('2026-10-03 14:15:');
  expect(await page.locator('.route-card').allTextContents()).toEqual(routes);
  expect(await page.locator('.route-card.selected').textContent()).toBe(
    selection,
  );
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map((node) => ({
        target: node.target,
        reason: node.failureSummary,
      })),
    })),
  ).toEqual([]);
});

test('SF labels dispatch calls, rolling window and publication delay without calling them confirmed crimes', async ({
  page,
}) => {
  const call = {
    cad_number: '55',
    received_datetime: '2026-10-03T06:00:00',
    call_type_final: '211',
    agency: 'Police',
    sensitive_call: false,
    intersection_point: { type: 'Point', coordinates: [-122.4, 37.79] },
  };
  await page.route(SF, (route) =>
    fulfill(route, [call], '2026-10-03T06:00:00'),
  );
  await ready(page, 'sf-downtown');
  await enable(page);
  await expect(cells(page)).toHaveCount(1);
  await expect(panel(page)).toContainText('Selected dispatch calls');
  await expect(panel(page)).toContainText('Additional 10-minute delay');
  await expect(panel(page)).toContainText(
    'Dispatch calls are not confirmed crimes',
  );
  await expect(panel(page)).toContainText('2026-10-01 – 2026-10-03');
  await cells(page).first().click();
  await expect(panel(page)).toContainText('1 open · 0 closed');
});

test('São Paulo explains unsupported recent coverage without issuing an official feed request', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/resource/*.json?**', async (route) => {
    requests++;
    await route.abort();
  });
  await ready(page, 'sao-paulo-centro');
  await enable(page);
  await expect(panel(page)).toContainText(
    'No verified recent feed is available for São Paulo',
  );
  await expect(page.locator('.activity-count')).toHaveCount(0);
  expect(requests).toBe(0);
});

test('failed refresh retains the previous successful data and never reports an empty successful result', async ({
  page,
}) => {
  let fail = false;
  await page.route(NYC, (route) =>
    fail ? route.fulfill({ status: 503, body: 'Unavailable' }) : fulfill(route),
  );
  await ready(page);
  await enable(page);
  await expect(cells(page)).toHaveCount(2);
  fail = true;
  await page.clock.fastForward(31000);
  await panel(page)
    .getByRole('button', { name: 'Refresh latest activity' })
    .click();
  await expect(panel(page).getByRole('alert')).toContainText(
    'Showing the last successful check',
  );
  await expect(cells(page)).toHaveCount(2);
  await expect(panel(page)).not.toContainText('No qualifying reports');
});

test('malformed responses are unavailable rather than zero reports', async ({
  page,
}) => {
  await page.route(NYC, (route) => fulfill(route, { unexpected: 'object' }));
  await ready(page);
  await enable(page);
  await expect(panel(page).getByRole('alert')).toContainText(
    'Invalid official source response',
  );
  await expect(panel(page)).not.toContainText('No qualifying reports');
  await expect(page.locator('.activity-count')).toHaveCount(0);
});

test('turning off aborts pending work; enabling again loads a fresh request and city switching discards pending results', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(NYC, async (route) => {
    if (first) {
      first = false;
      started();
      await gate;
    }
    try {
      await fulfill(route);
    } catch {
      /* An aborted route can close before fulfillment. */
    }
  });
  await ready(page);
  await enable(page);
  await requested;
  await panel(page)
    .getByRole('button', { name: 'Hide latest activity' })
    .click();
  await expect(panel(page).getByRole('heading')).toHaveCount(0);
  await enable(page);
  await page.clock.fastForward(31000);
  await expect(cells(page)).toHaveCount(2);
  release();
  await page.clock.fastForward(31000);
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  let secondStarted!: () => void;
  const secondRequested = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  await page.route(NYC, async (route) => {
    secondStarted();
    await secondGate;
    try {
      await fulfill(route);
    } catch {
      /* City switch aborted this request. */
    }
  });
  await panel(page)
    .getByRole('button', { name: 'Refresh latest activity' })
    .click();
  await secondRequested;
  await page.getByLabel('City and coverage').selectOption('chicago-loop');
  await expect(page.locator('.route-card').first()).toBeVisible({
    timeout: 15000,
  });
  releaseSecond();
  await expect(
    panel(page).getByRole('button', { name: 'Show latest activity' }),
  ).toBeVisible();
  await expect(page.locator('.activity-count')).toHaveCount(0);
  await expect(panel(page)).not.toContainText('NYPD');
});

async function clickFirstBubble(page: Page) {
  const marker = page.locator('.activity-count').first();
  await marker.scrollIntoViewIfNeeded();
  const box = await marker.boundingBox();
  expect(box).not.toBeNull();
  // Counts intentionally ignore pointer events: use a real click through the label
  // to exercise Leaflet's canvas hit testing, not a synthetic marker event.
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 500),
    center,
  );
  expect(hit, 'Bubble coordinate must reach the map canvas').toContain(
    '<canvas',
  );
  await page.mouse.click(center.x, center.y);
}

test('a real canvas bubble click opens its persistent cell details', async ({
  page,
}) => {
  await page.route(NYC, (route) => fulfill(route));
  await ready(page);
  await enable(page);
  await expect(cells(page)).toHaveCount(2);
  await panel(page).getByLabel('Activity category').selectOption('Robbery');
  await expect(cells(page)).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Show coverage', exact: true })
    .click();
  await clickFirstBubble(page);
  await expect(
    panel(page).getByRole('region', { name: 'Selected activity cell' }),
  ).toBeVisible();
  await expect(cells(page).filter({ hasText: 'Cell 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('endpoint picking takes precedence over the canvas bubble at the same position', async ({
  page,
}) => {
  await page.route(NYC, (route) => fulfill(route));
  await ready(page);
  await enable(page);
  await expect(cells(page)).toHaveCount(2);
  await panel(page).getByLabel('Activity category').selectOption('Robbery');
  await expect(cells(page)).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Show coverage', exact: true })
    .click();
  await page.getByRole('button', { name: 'Choose origin on map' }).click();
  await clickFirstBubble(page);
  await expect(page.locator('#origin')).toHaveValue('custom');
  await expect(
    panel(page).getByRole('region', { name: 'Selected activity cell' }),
  ).toHaveCount(0);
});

test('a refreshed feed that loses the selected category resets to all available categories', async ({
  page,
}) => {
  let rows = nycRows;
  await page.route(NYC, (route) => fulfill(route, rows));
  await ready(page);
  await enable(page);
  await expect(cells(page)).toHaveCount(2);
  await panel(page).getByLabel('Activity category').selectOption('Robbery');
  await expect(cells(page)).toHaveCount(1);
  rows = [nycRows[2]];
  await page.clock.fastForward(31000);
  await panel(page)
    .getByRole('button', { name: 'Refresh latest activity' })
    .click();
  await expect(panel(page).getByLabel('Activity category')).toHaveValue('all');
  await expect(cells(page)).toHaveCount(1);
  await expect(cells(page).first()).toContainText('Assault');
  await expect(panel(page)).not.toContainText('No qualifying reports');
});

test('a cooldown retry paused in a hidden tab resumes immediately when visible', async ({
  page,
}) => {
  let requestCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(NYC, async (route) => {
    requestCount++;
    if (requestCount === 1) {
      started();
      await gate;
    }
    try {
      await fulfill(route);
    } catch {
      /* The first request was cancelled. */
    }
  });
  await ready(page);
  await enable(page);
  await requested;
  await panel(page)
    .getByRole('button', { name: 'Hide latest activity' })
    .click();
  await enable(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(31000);
  expect(requestCount).toBe(1);
  await expect(cells(page)).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(cells(page)).toHaveCount(2);
  expect(requestCount).toBe(3); // Cancelled maximum query, fresh maximum, then records.
  await panel(page).locator('summary').click();
  await expect(panel(page)).toContainText('2026-10-03 14:15:');
  release();
});
