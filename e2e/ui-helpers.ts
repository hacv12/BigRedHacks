import type { Page } from '@playwright/test';
export async function openAdvanced(page: Page) {
  const details = page.locator('details.advanced-options');
  if ((await details.count()) && (await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
}
export async function openWalkDetails(page: Page) {
  const details = page.locator('details.walk-more');
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
}
export async function selectEndpoint(
  page: Page,
  id: 'origin' | 'destination',
  name: string,
) {
  await page.locator(`#${id}`).fill(name);
  await page
    .locator(`#${id}-suggestions`)
    .getByRole('option')
    .filter({ has: page.locator('strong', { hasText: name }) })
    .first()
    .click();
}
