import { openWalkDetails } from './ui-helpers';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

test('planner, trip details and methodology pass automated WCAG checks without viewport overflow', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.abort(),
  );
  await page.goto('/?area=chicago-loop');
  await expect(page.locator('.route-card').first()).toBeVisible({
    timeout: 15000,
  });
  await page.evaluate(() => document.fonts.ready);

  async function audit(state: string) {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    await testInfo.attach(`accessibility-${state}`, {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
    expect
      .soft(
        results.violations.length,
        `${state}: ${JSON.stringify(
          results.violations.map(({ id, nodes }) => ({
            id,
            nodes: nodes.map(({ target, failureSummary }) => ({
              target,
              failureSummary,
            })),
          })),
          null,
          2,
        )}`,
      )
      .toBe(0);
  }

  async function checkOverflow(state: string) {
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    }));
    expect
      .soft(dimensions.documentWidth, `${state}: horizontal document overflow`)
      .toBeLessThanOrEqual(dimensions.viewportWidth);
    if (testInfo.project.name === 'desktop') {
      expect
        .soft(
          dimensions.documentHeight,
          `${state}: desktop document overflow; sidebar should own its scroll`,
        )
        .toBeLessThanOrEqual(dimensions.viewportHeight);
    }
  }

  await audit('loaded-planner');
  await checkOverflow('loaded-planner');
  await openWalkDetails(page);
  await page.locator('details.street-sequence > summary').click();
  await page.getByRole('button', { name: 'Share trip', exact: true }).click();
  await expect(page.getByLabel('Shareable trip link')).toBeVisible();
  await audit('expanded-streets-and-share');
  await checkOverflow('expanded-streets-and-share');
  await page
    .getByRole('button', { name: 'Behind the routes', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await audit('methodology-dialog');
  await checkOverflow('methodology-dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Behind the routes', exact: true }),
  ).toBeFocused();
});
