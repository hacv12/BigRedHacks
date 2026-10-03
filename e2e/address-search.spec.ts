import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { parseTripUrl } from '../src/domain/trip-tools';
import type { CityCatalog, CityDataset, LngLat } from '../src/domain/types';
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.abort(),
  );
});

const catalog = JSON.parse(
  readFileSync('public/data/catalog.json', 'utf8'),
) as CityCatalog;
const nyc = JSON.parse(
  readFileSync('public/data/nyc-manhattan.json', 'utf8'),
) as CityDataset;
const point = nyc.landmarks.find((p) => p.id === 'penn')!.point;
const photon = (name: string, location: LngLat = point) => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: location },
      properties: {
        osm_type: 'N',
        osm_id: 123,
        name,
        housenumber: '123',
        street: 'Test Avenue',
        city: 'New York',
      },
    },
  ],
});
async function ready(page: Page) {
  await page.goto('/?area=nyc-manhattan');
  await expect(page.locator('.route-card').first()).toBeVisible();
}
async function chooseAddress(page: Page, query: string, name: string) {
  const input = page.getByRole('combobox', { name: 'From', exact: true });
  await input.fill(query);
  await expect(
    page.getByRole('option', { name: new RegExp(name) }),
  ).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveAttribute('data-confirmed', 'true');
}

test('arbitrary bounded address requires explicit selection and preserves requested coordinates when shared', async ({
  page,
}) => {
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ json: photon('123 Test Avenue') }),
  );
  await ready(page);
  const input = page.getByRole('combobox', { name: 'From', exact: true });
  await input.fill('123 Test Avenue');
  await expect(
    page.getByRole('option', { name: /123 Test Avenue/ }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('address-search.png'),
    fullPage: false,
  });
  await input.press('Enter');
  await expect(input).toHaveAttribute('data-confirmed', 'false');
  await expect(page.locator('.route-card')).toHaveCount(0);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveAttribute('data-confirmed', 'true');
  await page.getByRole('button', { name: 'Compare walking routes' }).click();
  await expect(page.locator('.route-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Share trip', exact: true }).click();
  const trip = parseTripUrl(
    await page.getByLabel('Shareable trip link').inputValue(),
    catalog.areas,
  );
  expect(trip?.request.origin).toEqual(point);
  await expect(
    page.getByRole('combobox', { name: 'To', exact: true }),
  ).toHaveAttribute('data-confirmed', 'true');
});

test('obsolete query and previous-city responses never replace current suggestions', async ({
  page,
}) => {
  let releaseOld!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let oldStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    oldStarted = resolve;
  });
  await page.route('https://photon.komoot.io/**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === '123 Old Query') {
      oldStarted();
      await held;
    }
    await route
      .fulfill({
        json: photon(q === '123 Old Query' ? 'Old address' : 'New address'),
      })
      .catch(() => {});
  });
  await ready(page);
  const input = page.getByRole('combobox', { name: 'From', exact: true });
  await input.fill('123 Old Query');
  await started;
  await input.fill('124 New Query');
  await expect(page.getByRole('option', { name: /New address/ })).toBeVisible();
  releaseOld();
  await expect(page.getByRole('option', { name: /Old address/ })).toHaveCount(
    0,
  );
  await page.getByLabel('City and coverage').selectOption('chicago-loop');
  await expect(
    page.getByRole('combobox', { name: 'From', exact: true }),
  ).toHaveValue('Willis Tower');
  await expect(
    page.getByRole('option', { name: /New address|Old address/ }),
  ).toHaveCount(0);
});

test('failed network search preserves local street matches and outside results are not selectable', async ({
  page,
}) => {
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await ready(page);
  const input = page.getByRole('combobox', { name: 'From', exact: true });
  await input.fill('Broadway');
  await expect(
    page
      .getByRole('listbox', { name: 'From suggestions' })
      .getByRole('option')
      .filter({ hasText: 'Broadway' })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/Address search is unavailable/)).toBeVisible();
  await expect(
    page
      .getByRole('listbox', { name: 'From suggestions' })
      .getByRole('option')
      .filter({ hasText: 'Broadway' })
      .first(),
  ).toBeVisible();
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ json: photon('999 Outside', [0, 0]) }),
  );
  const outsideResponse = page.waitForResponse(
    (response) =>
      response.url().includes('photon.komoot.io') &&
      new URL(response.url()).searchParams.get('q') === '999 Outside',
  );
  await input.fill('999 Outside');
  await (await outsideResponse).finished();
  await expect(page.getByText(/No matches/)).toBeVisible();
  await expect(page.getByRole('option', { name: /999 Outside/ })).toHaveCount(
    0,
  );
  await expect(input).toHaveAttribute('data-confirmed', 'false');
});

test('current location is requested only by explicit action, supports denial and rejects outside coverage', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition(
          success: PositionCallback,
          failure: PositionErrorCallback,
        ) {
          const state = window as unknown as {
            geoCalls: number;
            geoMode: string;
          };
          state.geoCalls = (state.geoCalls ?? 0) + 1;
          if (state.geoMode === 'denied')
            failure({ code: 1 } as GeolocationPositionError);
          else
            success({
              coords: {
                longitude: state.geoMode === 'outside' ? 0 : -73.9934,
                latitude: state.geoMode === 'outside' ? 0 : 40.7505,
              },
            } as GeolocationPosition);
        },
      },
    });
  });
  await ready(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { geoCalls?: number }).geoCalls ?? 0,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    (window as unknown as { geoMode: string }).geoMode = 'denied';
  });
  await page.getByRole('button', { name: 'Use my location for from' }).click();
  await expect(
    page.getByText(/Location permission was declined/),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { geoMode: string }).geoMode = 'outside';
  });
  await page.getByRole('button', { name: 'Use my location for from' }).click();
  await expect(page.getByText(/outside .* walking coverage/)).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'From', exact: true }),
  ).not.toHaveValue('Your location');
  await page.evaluate(() => {
    (window as unknown as { geoMode: string }).geoMode = 'inside';
  });
  await page.getByRole('button', { name: 'Use my location for from' }).click();
  await expect(
    page.getByRole('combobox', { name: 'From', exact: true }),
  ).toHaveValue('Your location');
});

test('late location callback cannot overwrite a newly selected address', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition(success: PositionCallback) {
          (window as unknown as { finishLocation: () => void }).finishLocation =
            () =>
              success({
                coords: { longitude: -73.99, latitude: 40.75 },
              } as GeolocationPosition);
        },
      },
    }),
  );
  await page.route('https://photon.komoot.io/**', (route) =>
    route.fulfill({ json: photon('123 Chosen address') }),
  );
  await ready(page);
  await page.getByRole('button', { name: 'Use my location for from' }).click();
  await chooseAddress(page, '123 Chosen', '123 Chosen address');
  await page.evaluate(() =>
    (window as unknown as { finishLocation: () => void }).finishLocation(),
  );
  await expect(
    page.getByRole('combobox', { name: 'From', exact: true }),
  ).toHaveValue('123 Chosen address');
});

test('a response arriving after a city switch cannot populate the new city search', async ({
  page,
}) => {
  let release!: () => void, started!: () => void, delivered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route('https://photon.komoot.io/**', async (route) => {
    started();
    await held;
    await route
      .fulfill({ json: photon('123 Stale NYC address') })
      .catch(() => {});
    delivered();
  });
  await ready(page);
  await page
    .getByRole('combobox', { name: 'From', exact: true })
    .fill('123 Delayed');
  await began;
  await page.getByLabel('City and coverage').selectOption('chicago-loop');
  await expect(
    page.getByRole('combobox', { name: 'From', exact: true }),
  ).toHaveValue('Willis Tower');
  release();
  await finished;
  await page.getByRole('combobox', { name: 'From', exact: true }).click();
  await expect(page.getByRole('option', { name: /Stale NYC/ })).toHaveCount(0);
  await expect(
    page.getByRole('listbox', { name: 'From suggestions' }),
  ).toContainText('Art Institute');
});
