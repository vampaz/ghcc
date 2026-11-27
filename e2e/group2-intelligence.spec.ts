import { expect, test } from '@playwright/test';
import { makePrDetail, makeSnapshot } from './fixtures/snapshot';

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

test('badges known flaky CI checks on PR cards and inside the inspector', async ({ page }) => {
  const base = makeSnapshot();
  const snapshot = makeSnapshot({
    pullRequests: base.pullRequests.map((pr) =>
      pr.key === 'acme/core-api#101'
        ? {
            ...pr,
            ci: {
              ...pr.ci,
              state: 'failing',
              failing: [
                { name: 'integration-tests', url: 'https://github.com/acme/core-api/runs/11' },
              ],
              flakyChecks: ['integration-tests'],
            },
          }
        : pr,
    ),
    flakyChecks: [
      {
        repository: 'acme/core-api',
        checkName: 'integration-tests',
        flakeCount: 4,
        lastFlakedAt: '2026-11-27T11:00:00Z',
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

  await page.route('**/api/pull/acme/core-api/101', async (route) => {
    const detail = makePrDetail(snapshot.pullRequests[0]!);
    detail.checks = [
      {
        name: 'integration-tests',
        kind: 'CheckRun',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        bucket: 'failing',
        url: 'https://github.com/acme/core-api/runs/11',
        description: null,
        startedAt: null,
        completedAt: null,
        checkRunId: 11,
        workflowRunId: 9,
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail),
    });
  });

  await page.route('**/api/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"e2e-flake"' },
      body: JSON.stringify(snapshot),
    });
  });

  await page.goto('/');

  const firstCard = page.locator('.action-queue .pr-card').first();
  await expect(firstCard).toContainText('flaky CI');

  await firstCard.locator('.pr-card-trigger').click();
  const inspector = page.locator('.inspector-dialog.open');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('flaky · 4×');
});
