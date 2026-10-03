import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { buildPlaceIndex, searchPlaces } from '../src/domain/place-search';
import { haversine, planRoutes } from '../src/domain/routing';
import { compareRoutes } from '../src/domain/route-insights';
import { parseTripUrl } from '../src/domain/trip-tools';
import type { CityCatalog, CityDataset } from '../src/domain/types';
const catalog: CityCatalog = JSON.parse(
  readFileSync('public/data/catalog.json', 'utf8'),
);
const chicago = catalog.areas.find((area) => area.id === 'chicago-loop')!;
const dataset: CityDataset = JSON.parse(
  readFileSync(`public${chicago.datasetUrl}`, 'utf8'),
);
const ready = async (page: Page, area = chicago.id) => {
  await page.goto(`/?area=${area}`);
  await expect(page.locator('.route-card').first()).toBeVisible({
    timeout: 15000,
  });
};
const picker = (page: Page) => page.locator('.guided-picker');
async function findPlace(page: Page, query: string) {
  await picker(page).locator('summary').click();
  await picker(page).getByLabel('Search this coverage area').fill(query);
}
async function confirmAndShare(page: Page) {
  await picker(page)
    .getByRole('button', { name: 'Use map center', exact: true })
    .click();
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await expect(page.locator('.route-card').first()).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Share trip', exact: true }).click();
  return parseTripUrl(
    await page.getByLabel('Shareable trip link').inputValue(),
    catalog.areas,
  )!;
}
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.abort(),
  );
});

test('guided keyboard map choice returns focus and removes stale results while cancel preserves the request', async ({
  page,
}) => {
  await ready(page);
  expect(
    await page
      .locator('#origin')
      .evaluate(
        (origin) =>
          !!(
            origin.compareDocumentPosition(
              document.querySelector('.recent-reports')!,
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
  ).toBe(true);
  const initial = await page.locator('#origin').inputValue();
  const cards = await page.locator('.route-card').allTextContents();
  await page.getByRole('button', { name: 'Choose origin on map' }).click();
  await findPlace(page, 'Willis');
  await picker(page).getByRole('list').getByRole('button').first().click();
  await expect(picker(page).locator('details')).not.toHaveAttribute('open', '');
  await expect(
    picker(page).getByRole('button', { name: 'Use map center', exact: true }),
  ).toBeFocused();
  await picker(page)
    .getByRole('button', { name: 'Cancel map selection' })
    .click();
  await expect(page.locator('#origin')).toHaveValue(initial);
  await expect(page.locator('#origin')).toBeFocused();
  expect(await page.locator('.route-card').allTextContents()).toEqual(cards);
  await page.getByRole('button', { name: 'Choose origin on map' }).click();
  await findPlace(page, 'Willis');
  await picker(page).getByRole('list').getByRole('button').first().click();
  const marker = page.locator('.endpoint-marker').first();
  const before = await marker.boundingBox();
  await picker(page)
    .getByRole('button', { name: 'Move map with keyboard' })
    .click();
  await expect(page.locator('.map-canvas')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await marker.boundingBox())?.x)
    .not.toBe(before?.x);
  await picker(page)
    .getByRole('button', { name: 'Use map center', exact: true })
    .click();
  await expect(page.locator('#origin')).toHaveValue('custom');
  await expect(page.locator('#origin')).toBeFocused();
  await expect(page.locator('#origin option:checked')).not.toHaveText(
    'Custom location',
  );
  await expect(page.locator('.route-card')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Share trip', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Historical time window').selectOption('3');
  await page.getByLabel('Room for a detour').fill('13');
  await page
    .getByRole('button', { name: 'Try example walk', exact: true })
    .click();
  await expect(page.locator('.route-card').first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('#origin')).toHaveValue(chicago.defaultOriginId);
  await expect(page.getByLabel('Historical time window')).toHaveValue('2');
  await expect(page.getByLabel('Room for a detour')).toHaveValue('8');
});

test('São Paulo local street search confirms the actual graph reference in a shared request', async ({
  page,
}) => {
  const area = catalog.areas.find((item) => item.id === 'sao-paulo-centro')!;
  const data: CityDataset = JSON.parse(
    readFileSync(`public${area.datasetUrl}`, 'utf8'),
  );
  const reference = searchPlaces(
    buildPlaceIndex(data),
    'avenida paulista',
  ).find((place) => place.kind === 'street')!;
  expect(reference).toBeDefined();
  expect(
    data.nodes.some(
      (node) =>
        node.point[0] === reference.point[0] &&
        node.point[1] === reference.point[1],
    ),
  ).toBe(true);
  await ready(page, area.id);
  await page.getByRole('button', { name: 'Choose origin on map' }).click();
  await findPlace(page, 'AVENÍDA PAULÍSTA');
  await picker(page)
    .getByRole('button', {
      name: `${reference.name} Street reference point · not an address/entrance`,
      exact: true,
    })
    .click();
  const trip = await confirmAndShare(page);
  // Leaflet can round a resized map center by less than one display pixel.
  expect(haversine(trip.request.origin, reference.point)).toBeLessThan(1);
  await expect(page.locator('#origin option:checked')).toContainText(
    reference.name,
  );
});

test('route takeaway and street differences match selected actual graph paths', async ({
  page,
}) => {
  await ready(page);
  const request = {
    origin: dataset.landmarks.find((l) => l.id === chicago.defaultOriginId)!
      .point,
    destination: dataset.landmarks.find(
      (l) => l.id === chicago.defaultDestinationId,
    )!.point,
    bucket: 2 as const,
    maxExtraMinutes: 8,
  };
  const comparison = planRoutes(dataset, request);
  await page.locator('.route-card').first().click();
  await expect(page.locator('.decision-takeaway')).toHaveText(
    compareRoutes(comparison.routes[0], comparison.routes[0], dataset).takeaway,
  );
  await page.locator('.route-card').last().click();
  const insight = compareRoutes(
    comparison.routes.at(-1)!,
    comparison.routes[0],
    dataset,
  );
  await expect(page.locator('.decision-takeaway')).toHaveText(insight.takeaway);
  await page.locator('.route-differences summary').click();
  await expect(page.locator('.route-differences')).toContainText(
    insight.streetSummary,
  );
  await expect(page.locator('.route-differences')).toContainText(
    'Shared street geometry',
  );
});

test('expanded guided local search has no automated accessibility or horizontal overflow violations', async ({
  page,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'Choose origin on map' }).click();
  await findPlace(page, 'street');
  await expect(
    picker(page).getByRole('list').getByRole('button').first(),
  ).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map((node) => ({
        target: node.target,
        reason: node.failureSummary,
      })),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('a pending worker result cannot recenter a location being chosen on the map', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      holdPlannerResult: boolean;
      heldPlannerResults: number;
      releasePlannerResults: () => void;
    };
    state.holdPlannerResult = false;
    state.heldPlannerResults = 0;
    const pending: (() => void)[] = [];
    const released = new WeakSet<Event>();
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => {
          if (!state.holdPlannerResult || released.has(event)) return;
          event.stopImmediatePropagation();
          state.heldPlannerResults++;
          pending.push(() => {
            const replay = new MessageEvent('message', { data: event.data });
            released.add(replay);
            this.dispatchEvent(replay);
          });
        });
      }
    };
    state.releasePlannerResults = () => {
      state.holdPlannerResult = false;
      for (const deliver of pending.splice(0)) deliver();
    };
  });
  await ready(page);
  await page.evaluate(() => {
    (
      window as typeof window & { holdPlannerResult: boolean }
    ).holdPlannerResult = true;
  });
  await page.getByLabel('Room for a detour').fill('9');
  await page.getByRole('button', { name: /Compare walking routes/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { heldPlannerResults: number })
            .heldPlannerResults,
      ),
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Choose origin on map' }).click();
  await findPlace(page, 'Buckingham Fountain');
  await picker(page).getByRole('list').getByRole('button').first().click();
  await page.evaluate(() =>
    (
      window as typeof window & { releasePlannerResults: () => void }
    ).releasePlannerResults(),
  );
  await expect(page.locator('.route-card').first()).toBeVisible();
  await expect(picker(page)).toBeVisible();
  const trip = await confirmAndShare(page);
  const reference = dataset.landmarks.find(
    (place) => place.name === 'Buckingham Fountain',
  )!;
  expect(haversine(trip.request.origin, reference.point)).toBeLessThan(1);
});
