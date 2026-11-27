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

test('groups cross-repo mission PRs, navigates mission siblings in inspector, and warns before out-of-order merge', async ({
  page,
}) => {
  const base = makeSnapshot();
  const prFe = {
    ...base.pullRequests[0]!,
    key: 'acme/frontend#101',
    repo: 'frontend',
    repository: 'acme/frontend',
    title: 'fix: browser SSO codes [SEC-16]',
    bucket: 'ready' as const,
    mission: {
      id: 'ticket:SEC-16',
      label: 'SEC-16',
      ticketKeys: ['SEC-16'],
      peerCount: 1,
      mergeOrder: 1,
      mergeTotal: 2,
    },
  };
  const prBe = {
    ...base.pullRequests[1]!,
    key: 'acme/backend#202',
    repo: 'backend',
    repository: 'acme/backend',
    title: 'fix: exchange SSO JWTs [SEC-16]',
    mission: {
      id: 'ticket:SEC-16',
      label: 'SEC-16',
      ticketKeys: ['SEC-16'],
      peerCount: 1,
      blockedByKeys: ['acme/frontend#101'],
      mergeOrder: 2,
      mergeTotal: 2,
    },
  };
  const snapshot = makeSnapshot({
    pullRequests: [prFe, prBe, base.pullRequests[2]!],
    missions: [
      {
        id: 'ticket:SEC-16',
        label: 'SEC-16',
        ticketKeys: ['SEC-16'],
        prKeys: ['acme/frontend#101', 'acme/backend#202'],
        repositories: ['acme/backend', 'acme/frontend'],
        readyCount: 1,
        totalCount: 2,
        hasStack: false,
        hasCrossRepo: true,
        dependencyNotes: ['#202 waits on #101 (Depends on FE)'],
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

  await page.route('**/api/pull/*/*/*', async (route) => {
    const { pathname } = new URL(route.request().url());
    const pr = pathname.includes('202') ? prBe : prFe;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makePrDetail(pr)),
    });
  });

  await page.route('**/api/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"e2e-missions"' },
      body: JSON.stringify(snapshot),
    });
  });

  await page.goto('/');

  await page.getByRole('button', { name: /Missions/i }).click();
  const missionCard = page.locator('.mission-group-card');
  await expect(missionCard).toBeVisible();
  await expect(missionCard).toContainText('SEC-16');
  await expect(missionCard).toContainText('cross-repo');
  await expect(missionCard).toContainText('#202 waits on #101');

  // Inspect #202 and jump to sibling #101 from the Mission panel
  const beCard = missionCard.locator('.pr-card').nth(1);
  await beCard.locator('.pr-card-trigger').click();
  const inspector = page.locator('.inspector-dialog.open');
  await expect(inspector).toContainText('Mission · SEC-16');
  await inspector.locator('.mission-sibling-btn').first().click();
  await expect(inspector).toContainText('acme/frontend#101');

  // Opening merge confirmation on #202 shows dependency order warning
  await beCard.getByRole('button', { name: /Squash — acme\/backend#202/i }).click();
  const mergeDialog = page.locator('.merge-confirm-dialog');
  await expect(mergeDialog).toBeVisible();
  await expect(mergeDialog).toContainText('Dependency order notice');
  await expect(mergeDialog).toContainText('acme/frontend#101');
});

test('surfaces blast-radius file overlaps on cards, inspector, and merge confirmation dialog', async ({
  page,
}) => {
  const base = makeSnapshot();
  const pr1 = {
    ...base.pullRequests[0]!,
    overlaps: [
      {
        prKey: 'acme/web-app#202',
        number: 202,
        title: 'feat: dark theme tokens',
        author: 'vampaz',
        isDraft: false,
        sharedFiles: ['src/auth.ts', 'src/session.ts'],
        sharedCount: 2,
      },
    ],
  };
  const snapshot = makeSnapshot({
    pullRequests: [pr1, ...base.pullRequests.slice(1)],
  });

  await page.route('**/api/presets', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ presets: [] }),
    });
  });

  await page.route('**/api/pull/*/*/*', async (route) => {
    const { pathname } = new URL(route.request().url());
    const pr = pathname.includes('202') ? base.pullRequests[1]! : pr1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makePrDetail(pr)),
    });
  });

  await page.route('**/api/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"e2e-blast"' },
      body: JSON.stringify(snapshot),
    });
  });

  await page.goto('/');

  const firstCard = page.locator('.action-queue .pr-card').first();
  await expect(firstCard).toContainText('1 overlap');

  await firstCard.locator('.pr-card-trigger').click();
  const inspector = page.locator('.inspector-dialog.open');
  await expect(inspector).toContainText('Blast Radius · File Overlaps');
  await expect(inspector).toContainText('src/auth.ts');

  // Clicking overlapping PR jumps directly to inspect it
  await inspector.locator('.overlap-head-btn').first().click();
  await expect(inspector).toContainText('acme/web-app#202');

  // Merge confirmation dialog warns about shared files before merging
  await firstCard.getByRole('button', { name: /Squash — acme\/core-api#101/i }).click();
  const mergeDialog = page.locator('.merge-confirm-dialog');
  await expect(mergeDialog).toBeVisible();
  await expect(mergeDialog).toContainText('Blast radius — shared files with open PRs');
  await expect(mergeDialog).toContainText('src/auth.ts');
});
