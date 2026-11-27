import { expect, test } from '@playwright/test';
import { makeSnapshot } from './fixtures/snapshot';

test('surfaces shared CI outage banner, badges affected cards, filters affected PRs, and dismisses cleanly', async ({
  page,
}) => {
  const base = makeSnapshot();
  const snapshot = makeSnapshot({
    pullRequests: base.pullRequests.map((pr) =>
      pr.key === 'acme/core-api#101'
        ? {
            ...pr,
            ci: {
              ...pr.ci,
              state: 'failing',
              failing: [{ name: 'e2e-suite', url: 'https://github.com/acme/core-api/runs/99' }],
            },
          }
        : pr,
    ),
    ciOutages: [
      {
        id: 'acme/core-api::e2e-suite',
        repository: 'acme/core-api',
        checkName: 'e2e-suite',
        affectedCount: 3,
        affectedPrKeys: ['acme/core-api#101', 'acme/core-api#105', 'acme/core-api#109'],
        authors: ['vampaz', 'ana', 'leo'],
        sampleUrl: 'https://github.com/acme/core-api/runs/99',
      },
    ],
  });

  await page.route('**/api/presets', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ presets: [] }),
    });
  });

  await page.route('**/api/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"e2e-outage"' },
      body: JSON.stringify(snapshot),
    });
  });

  await page.goto('/');

  const banner = page.locator('.outage-strip');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Shared CI Outage');
  await expect(banner).toContainText('e2e-suite');
  await expect(page.locator('.action-queue .pr-card').first()).toContainText('shared CI');

  await banner.getByRole('button', { name: /Filter affected/i }).click();
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(1);
  await expect(page.locator('.action-queue .pr-card')).toContainText('acme/core-api#101');

  await banner.getByRole('button', { name: /Dismiss shared CI outage alert/i }).click();
  await expect(banner).toBeHidden();
});
