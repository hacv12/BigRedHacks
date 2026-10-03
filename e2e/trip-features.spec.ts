import { openAdvanced, openWalkDetails } from './ui-helpers';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { planRoutes } from '../src/domain/routing';
import { parseTripUrl, routePreference } from '../src/domain/trip-tools';
import type {
  CityCatalog,
  CityDataset,
  PlanRequest,
} from '../src/domain/types';

const catalog: CityCatalog = JSON.parse(
  readFileSync('public/data/catalog.json', 'utf8'),
);
const area = catalog.areas.find((item) => item.id === 'chicago-loop')!;
const dataset: CityDataset = JSON.parse(
  readFileSync(`public${area.datasetUrl}`, 'utf8'),
);
const initialRequest: PlanRequest = {
  origin: dataset.landmarks.find((item) => item.id === area.defaultOriginId)!
    .point,
  destination: dataset.landmarks.find(
    (item) => item.id === area.defaultDestinationId,
  )!.point,
  bucket: 2,
  maxExtraMinutes: 8,
};
const ready = async (page: Page) => {
  await expect(page.locator('.route-card').first()).toBeVisible({
    timeout: 15000,
  });
  await openAdvanced(page);
};
async function downloadText(page: Page, label: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  return {
    name: download.suggestedFilename(),
    text: readFileSync((await download.path())!, 'utf8'),
  };
}

test.beforeEach(async ({ page }) => {
  for (const pattern of [
    'https://tile.openstreetmap.org/**',
    'https://fonts.googleapis.com/**',
    'https://fonts.gstatic.com/**',
  ]) {
    await page.route(pattern, (route) => route.abort());
  }
});

test('exports the selected path as valid GPX and a historical street summary', async ({
  page,
}) => {
  await page.goto(`/?area=${area.id}`);
  await ready(page);
  const expected = planRoutes(dataset, initialRequest).routes.at(-1)!;
  await page.locator('.route-card').last().click();
  const gpx = await downloadText(page, 'Download GPX');
  expect(gpx.name).toMatch(/\.gpx$/);
  const parsed = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    return {
      error: doc.querySelector('parsererror')?.textContent,
      namespace: doc.documentElement.namespaceURI,
      label: doc.querySelector('trk > name')?.textContent,
      coordinates: [...doc.querySelectorAll('trkpt')].map((node) => [
        Number(node.getAttribute('lon')),
        Number(node.getAttribute('lat')),
      ]),
      description: doc.querySelector('metadata > desc')?.textContent,
    };
  }, gpx.text);
  expect(parsed.error).toBeUndefined();
  expect(parsed.namespace).toBe('http://www.topografix.com/GPX/1/1');
  expect(parsed.label).toBe(expected.label);
  expect(parsed.coordinates).toEqual(expected.coordinates);
  expect(parsed.description).toContain(dataset.manifest.datasetId);
  expect(parsed.description).toContain(dataset.manifest.modelVersion);
  expect(parsed.description).toContain(dataset.manifest.timezone);
  const summary = await downloadText(page, 'Download summary');
  expect(summary.text).toContain(expected.label);
  expect(summary.text).toContain(expected.segments[0].name);
  expect(summary.text).toContain('not a safety prediction');
  expect(summary.text).toContain('not turn-by-turn navigation');
});

test('explicit sharing restores request and semantic selection while keeping coordinates out of the address bar', async ({
  page,
}) => {
  await page.goto(`/?area=${area.id}`);
  await ready(page);
  await expect(page.getByLabel('Shareable trip link')).toHaveCount(0);
  await page.getByLabel('Historical time window').selectOption('3');
  await page.getByLabel('Room for a detour').fill('13');
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await ready(page);
  await page.locator('.route-card').last().click();
  const request = {
    ...initialRequest,
    bucket: 3 as const,
    maxExtraMinutes: 13,
  };
  const expected = planRoutes(dataset, request).routes.at(-1)!;
  await page.getByRole('button', { name: 'Share trip', exact: true }).click();
  const input = page.getByLabel('Shareable trip link');
  await expect(input).toHaveAttribute('readonly', '');
  const sharedUrl = await input.inputValue();
  expect(parseTripUrl(sharedUrl, catalog.areas)).toEqual({
    areaId: area.id,
    cityId: area.cityId,
    request,
    preference: routePreference(expected),
  });
  expect(new URL(page.url()).searchParams.has('origin')).toBe(false);
  await page.goto(sharedUrl);
  await ready(page);
  await expect(
    page.getByText('Shared trip loaded', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('#origin')).toHaveValue(
    dataset.landmarks.find((l) => l.id === area.defaultOriginId)!.name,
  );
  await expect(page.locator('#destination')).toHaveValue(
    dataset.landmarks.find((l) => l.id === area.defaultDestinationId)!.name,
  );
  await expect(page.getByLabel('Historical time window')).toHaveValue('3');
  await expect(page.getByLabel('Room for a detour')).toHaveValue('13');
  await expect(page.locator('.route-card').last()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect([...new URL(page.url()).searchParams.keys()]).toEqual(['area']);
});

test('dirty controls remove stale export and share actions until recalculation', async ({
  page,
}) => {
  await page.goto(`/?area=${area.id}`);
  await ready(page);
  await page.getByRole('button', { name: 'Share trip', exact: true }).click();
  await expect(page.getByLabel('Shareable trip link')).toBeVisible();
  await page.getByLabel('Room for a detour').fill('4');
  await expect(page.locator('.route-card')).toHaveCount(0);
  for (const label of ['Share trip', 'Download GPX', 'Download summary']) {
    await expect(
      page.getByRole('button', { name: label, exact: true }),
    ).toHaveCount(0);
  }
  await expect(page.getByLabel('Shareable trip link')).toHaveCount(0);
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Download GPX' }),
  ).toBeEnabled();
});

test('invalid shared parameters show a recoverable notice and never become route inputs', async ({
  page,
}) => {
  await page.goto(
    '/?area=chicago-loop&trip=1&city=chicago&origin=NaN,42&destination=-87.63,41.88&bucket=9&detour=99',
  );
  await ready(page);
  await expect(
    page.getByText('Shared trip could not be loaded', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Historical time window')).toHaveValue('2');
  await expect(page.getByLabel('Room for a detour')).toHaveValue('8');
  expect(new URL(page.url()).searchParams.has('origin')).toBe(false);
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Download GPX' }),
  ).toBeEnabled();
});

test('shows the selected street sequence and four-window profile with separate coverage controls', async ({
  page,
}) => {
  await page.goto(`/?area=${area.id}`);
  await ready(page);
  await page.locator('.route-card').last().click();
  const expected = planRoutes(dataset, initialRequest).routes.at(-1)!;
  await openWalkDetails(page);
  const details = page.locator('details.street-sequence');
  await details.locator('summary').click();
  for (const segment of expected.segments)
    await expect(details).toContainText(segment.name);
  await expect(
    page.getByRole('heading', { name: 'Same walk, different windows' }),
  ).toBeVisible();
  const profileRows = page.locator('table.time-profile tbody tr');
  await expect(profileRows).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(profileRows.nth(i)).toContainText(
      dataset.manifest.timeBuckets[i],
    );
    await expect(profileRows.nth(i)).toContainText(
      expected.exposureByBucket[i].toFixed(2),
    );
  }
  await expect(
    page.getByRole('button', { name: 'Show coverage', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Show coverage', exact: true })
    .click();
  await expect(page.locator('.route-card').last()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page
    .getByRole('button', { name: 'Fit routes to map', exact: true })
    .click();
  await expect(page.locator('.route-card').last()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('map picking explains unsupported points beside the map and accepts a point inside coverage', async ({
  page,
}) => {
  await page.goto(`/?area=${area.id}`);
  await ready(page);
  await page.getByRole('button', { name: 'Choose origin on map' }).click();
  const canvas = page.locator('.map-canvas');
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: 5, y: bounds!.height / 2 } });
  await expect(page.locator('.pick-banner').getByRole('alert')).toBeVisible();
  await expect(page.locator('.pick-banner')).toContainText('inside');
  await expect(page.locator('#origin')).toHaveValue(
    dataset.landmarks.find((l) => l.id === area.defaultOriginId)!.name,
  );
  await canvas.click({
    position: { x: bounds!.width / 2, y: bounds!.height / 2 },
  });
  await expect(page.locator('#origin')).toHaveValue(/^-?\d+\.\d+, -?\d+\.\d+$/);
  await expect(page.locator('.pick-banner')).toHaveCount(0);
  await expect(page.locator('.route-card')).toHaveCount(0);
});
