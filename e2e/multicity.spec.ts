import { openAdvanced } from './ui-helpers';
import { readFileSync } from 'node:fs';
import { test, expect as baseExpect } from './fixtures';
import type { Page } from '@playwright/test';
import type {
  CityCatalog,
  CityDataset,
  CoverageArea,
} from '../src/domain/types';

const expect = baseExpect.configure({ timeout: 10_000 });

let catalog: CityCatalog;
let nyc: CoverageArea;
let chicago: CoverageArea;
let nycData: CityDataset;
let nycBody: string;
const citySelect = (page: Page) => page.getByLabel('City and coverage');
const routesReady = (page: Page) =>
  expect(page.locator('.route-card').first()).toBeVisible({ timeout: 15_000 });

async function expectCity(page: Page, area: CoverageArea) {
  await openAdvanced(page);
  const data: CityDataset = JSON.parse(
    readFileSync(`public${area.datasetUrl}`, 'utf8'),
  );
  await expect(citySelect(page)).toHaveValue(area.id);
  await expect(page.locator('.map-location strong')).toHaveText(
    `${area.region}, ${area.city}`,
  );
  await expect(page.locator('.coverage-description')).toHaveText(
    area.description,
  );
  await expect(page.locator('#origin')).toHaveValue(
    data.landmarks.find((l) => l.id === area.defaultOriginId)!.name,
  );
  await expect(page.locator('#destination')).toHaveValue(
    data.landmarks.find((l) => l.id === area.defaultDestinationId)!.name,
  );
  await expect(page.getByLabel('Historical time window')).toHaveValue('2');
  await expect(
    page.locator('.field-label').filter({ hasText: 'Historical time window' }),
  ).toContainText(area.timezone);
  await expect(page).toHaveURL(new RegExp(`area=${area.id}`));
}

test.beforeAll(() => {
  catalog = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
  nyc = catalog.areas.find((area) => area.id === 'nyc-manhattan')!;
  chicago = catalog.areas.find((area) => area.id === 'chicago-loop')!;
  nycBody = readFileSync(`public${nyc.datasetUrl}`, 'utf8');
  nycData = JSON.parse(nycBody);
});

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.abort(),
  );
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
});

test('defaults to NYC with real worker routes and accessible coverage controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await routesReady(page);
  await expectCity(page, nyc);
  await expect(page.locator('.coverage-source')).toContainText(
    nycData.manifest.sourceName,
  );
  await expect(page.locator('.map-location')).toContainText(
    nycData.manifest.timeBuckets[2],
  );
  const pickerBox = await citySelect(page).boundingBox();
  expect(pickerBox!.height).toBeGreaterThanOrEqual(44);
  await citySelect(page).focus();
  await expect(citySelect(page)).toBeFocused();
  await page.getByRole('button', { name: 'Behind the routes' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(nycData.manifest.sourceName);
  await expect(dialog).toContainText(nycData.manifest.timezone);
  await expect(dialog).toContainText(
    `${nycData.manifest.periodStart} through ${nycData.manifest.periodEnd}`,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('reselecting the current city preserves an in-flight load and completed routes', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/data/nyc-manhattan.json', async (route) => {
    requests++;
    await held;
    await route.fulfill({ contentType: 'application/json', body: nycBody });
  });
  await page.goto('/?area=nyc-manhattan');
  await expect(citySelect(page)).toHaveValue(nyc.id);
  await expect.poll(() => requests).toBe(1);
  await citySelect(page).selectOption(nyc.id);
  release();
  await routesReady(page);
  const routes = await page.locator('.route-card').allTextContents();
  await citySelect(page).selectOption(nyc.id);
  await routesReady(page);
  expect(await page.locator('.route-card').allTextContents()).toEqual(routes);
  expect(requests).toBe(1);
});

test('switches both ways and resets custom endpoints and route settings', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await routesReady(page);
  await page.getByRole('button', { name: 'Choose origin on map' }).click();
  const mapBox = await page.locator('.map-canvas').boundingBox();
  await page
    .locator('.map-canvas')
    .click({ position: { x: mapBox!.width / 2, y: mapBox!.height / 2 } });
  await expect(page.locator('#origin')).toHaveValue(/^-?\d+\.\d+, -?\d+\.\d+$/);
  await openAdvanced(page);
  await page.getByLabel('Historical time window').selectOption('3');
  await page.getByLabel('Room for a detour').fill('13');
  await page
    .getByRole('button', { name: 'Toggle reported incident intensity' })
    .click();
  await citySelect(page).selectOption(chicago.id);
  await routesReady(page);
  await expectCity(page, chicago);
  await expect(page.locator('#origin')).not.toHaveValue(
    /^-?\d+\.\d+, -?\d+\.\d+$/,
  );
  await expect(page.getByLabel('Room for a detour')).toHaveValue('8');
  await expect(
    page.getByRole('button', { name: 'Toggle reported incident intensity' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
  await citySelect(page).selectOption(nyc.id);
  await routesReady(page);
  await expectCity(page, nyc);
  await expect(page.locator('#origin')).not.toHaveValue(
    /^-?\d+\.\d+, -?\d+\.\d+$/,
  );
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a delayed NYC response cannot overwrite a newer Chicago selection', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let completed!: () => void;
  const finished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route(`**${nyc.datasetUrl}`, async (route) => {
    requested();
    await gate;
    try {
      await route.fulfill({ contentType: 'application/json', body: nycBody });
    } catch {
      /* Switching areas aborts this request in the browser. */
    } finally {
      completed();
    }
  });
  await page.goto('/');
  await started;
  await expect(page.locator('.route-card')).toHaveCount(0);
  await citySelect(page).selectOption(chicago.id);
  await routesReady(page);
  await expectCity(page, chicago);
  release();
  await finished;
  await expectCity(page, chicago);
  await expect(page.locator('.coverage-source')).not.toContainText(
    nycData.manifest.sourceName,
  );
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
});

test('failed NYC loads keep the selector usable and recover by switching or retrying', async ({
  page,
}) => {
  await page.route(`**${nyc.datasetUrl}`, (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Unable to load');
  await expect(citySelect(page)).toBeEnabled();
  await expect(page.locator('.route-card')).toHaveCount(0);
  await expect(page.locator('.leaflet-container')).toHaveCount(0);
  await citySelect(page).selectOption(chicago.id);
  await routesReady(page);
  await expectCity(page, chicago);
  await citySelect(page).selectOption(nyc.id);
  await expect(page.getByRole('alert')).toContainText('Unable to load');
  await expect(page.locator('.route-card')).toHaveCount(0);
  await expect(page.locator('.leaflet-container')).toHaveCount(0);
  await page.unroute(`**${nyc.datasetUrl}`);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await routesReady(page);
  await expectCity(page, nyc);
});

for (const failure of ['unavailable', 'malformed'] as const) {
  test(`a ${failure} catalog has a separate recoverable error`, async ({
    page,
  }) => {
    await page.route('**/data/catalog.json', (route) =>
      route.fulfill(
        failure === 'unavailable'
          ? { status: 503, body: 'Unavailable' }
          : {
              contentType: 'application/json',
              body: JSON.stringify({ version: 1, areas: [] }),
            },
      ),
    );
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('catalog');
    await expect(page.locator('.route-card')).toHaveCount(0);
    await page.unroute('**/data/catalog.json');
    await page.getByRole('button', { name: 'Retry city list' }).click();
    await routesReady(page);
    await expectCity(page, nyc);
  });
}

test('unknown coverage links fall back with an honest notice', async ({
  page,
}) => {
  await page.goto('/?area=unsupported-city');
  await routesReady(page);
  await expectCity(page, nyc);
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'That coverage area is unavailable' }),
  ).toBeVisible();
  await citySelect(page).selectOption(chicago.id);
  await routesReady(page);
  await expect(
    page.getByText('That coverage area is unavailable.', { exact: false }),
  ).toHaveCount(0);
});
