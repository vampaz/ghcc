import { expect, test, type Page } from '@playwright/test';
import type { SnapshotResponse } from '../src/types/pr';
import { makePrDetail, makePrView, makeSnapshot } from './fixtures/snapshot';

async function mockApi(page: Page, snapshot: SnapshotResponse = makeSnapshot()): Promise<void> {
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unmocked API route' }),
    });
  });

  await page.route('**/api/pull/**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const { pathname } = new URL(route.request().url());
    const match = /^\/api\/pull\/([^/]+)\/([^/]+)\/(\d+)$/.exec(pathname);
    if (!match) {
      await route.fallback();
      return;
    }
    const owner = decodeURIComponent(match[1]!);
    const repo = decodeURIComponent(match[2]!);
    const number = Number(match[3]);
    const pr = snapshot.pullRequests.find(
      (item) => item.owner === owner && item.repo === repo && item.number === number,
    );
    if (!pr) {
      await route.fallback();
      return;
    }
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
      headers: { etag: '"e2e-snapshot"' },
      body: JSON.stringify(snapshot),
    });
  });
}

test('filters the queue with the repository dropdown and restores all repos', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  const trigger = page.locator('.repo-picker-trigger');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(4);
  await expect(trigger).toContainText('All repos');

  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Filter repositories' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.repo-row')).toHaveCount(4);
  await expect(page.locator('#toggle-all-repos')).toBeChecked();

  await dialog
    .locator('.repo-row', { hasText: 'web-app' })
    .locator('input[type="checkbox"]')
    .uncheck();

  await expect(trigger).toContainText('3 repos');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: /Ready to Merge/i }).locator('.kpi-value'),
  ).toHaveText('0');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('repos'))
    .toBe('acme/core-api,acme/docs,acme/worker');
  await expect(page.locator('#toggle-all-repos')).toHaveJSProperty('indeterminate', true);

  await page.locator('#toggle-all-repos').check();

  await expect(trigger).toContainText('All repos');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(4);
  await expect.poll(() => new URL(page.url()).searchParams.get('repos')).toBeNull();

  await page.locator('#toggle-all-repos').uncheck();

  await expect(trigger).toContainText('No repos');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('repos')).toBe('none');
  const repoCheckboxes = dialog.locator('.repo-row input[type="checkbox"]');
  await expect(repoCheckboxes).toHaveCount(4);
  for (const checkbox of await repoCheckboxes.all()) {
    await expect(checkbox).not.toBeChecked();
  }

  await page.locator('#toggle-all-repos').check();

  await expect(trigger).toContainText('All repos');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(4);
  await expect.poll(() => new URL(page.url()).searchParams.get('repos')).toBeNull();
});

test('restores the repository filter from the URL, collapses the rail in Team view, and scopes Escape', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/?repos=acme/core-api');

  const trigger = page.locator('.repo-picker-trigger');
  const teamButton = page.getByRole('button', { name: 'Team', exact: true });
  const reviewButton = page.getByRole('button', { name: 'To Review', exact: true });
  const allButton = page.getByRole('button', { name: 'All', exact: true });

  await expect(page.locator('.context-rail')).toHaveCount(1);
  await expect(trigger).toContainText('core-api');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(1);

  await teamButton.click();

  await expect(page.locator('.context-rail')).toHaveCount(0);
  await expect(page.locator('.dashboard-grid')).toHaveClass(/single-column/);
  await expect(trigger).toContainText('core-api');
  await expect(trigger).not.toContainText('All repos');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(0);

  await reviewButton.click();
  await expect(trigger).toContainText('core-api');
  await expect(trigger).not.toContainText('All repos');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('No open repositories.')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(reviewButton).toHaveAttribute('aria-pressed', 'true');
  await expect(trigger).toContainText('core-api');

  await page.keyboard.press('Escape');

  await expect(trigger).toContainText('All repos');
  await expect(allButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.context-rail')).toHaveCount(1);
});

test('updates repository counts with the Include drafts filter', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');

  await expect(page.locator('.action-queue .pr-card')).toHaveCount(4);

  await page.locator('.repo-picker-trigger').click();
  const docsRow = page.locator('.repo-row', { hasText: 'docs' });
  await expect(docsRow.locator('.repo-count')).toContainText('0');
  await expect(docsRow.locator('.repo-count')).toContainText('+1d');

  await page.locator('#include-drafts').check();
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(5);

  await page.locator('.repo-picker-trigger').click();
  await expect(docsRow.locator('.repo-count')).toContainText('1');
  await expect(docsRow.locator('.repo-count')).not.toContainText('+1d');
  await expect(page.locator('#toggle-all-repos')).toBeChecked();
});

test('renders cleanly on mobile without overflow, duplicate banner landmarks, or off-screen inline inspector', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/');

  await expect(page.locator('.action-queue .pr-card')).toHaveCount(4);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await expect(page.getByRole('banner')).toHaveCount(1);

  await page.locator('.action-queue .pr-card-trigger').first().click();

  const inlineInspector = page.locator('.inspector-inline');
  await expect(inlineInspector).toBeVisible();
  await expect(page.locator('#inspector-inline-title')).toBeFocused();
  await expect
    .poll(async () => {
      const box = await inlineInspector.boundingBox();
      return box ? box.y >= 0 && box.y < 844 : false;
    })
    .toBe(true);
});

test('shows Sync on behind-base draft PRs in the queue and inspector, but not up-to-date drafts', async ({
  page,
}) => {
  const base = makeSnapshot();
  const behindDraft = makePrView({
    key: 'acme/docs#404',
    repo: 'docs',
    repository: 'acme/docs',
    number: 404,
    title: 'wip: architecture diagram',
    url: 'https://github.com/acme/docs/pull/404',
    isDraft: true,
    bucket: 'draft',
    myAction: 'none',
    blockers: ['draft', 'behind-base'],
    ci: { state: 'none', passing: 0, failing: [], pending: 0, hiddenCount: 0 },
    merge: { state: 'behind', source: 'fresh', checkedAt: '2026-11-24T12:00:00.000Z' },
    blockerSummary: 'Draft · No CI checks · behind base · no review requested',
  });
  const upToDateDraft = makePrView({
    key: 'acme/docs#405',
    repo: 'docs',
    repository: 'acme/docs',
    number: 405,
    title: 'wip: deployment checklist',
    url: 'https://github.com/acme/docs/pull/405',
    isDraft: true,
    bucket: 'draft',
    myAction: 'none',
    blockers: ['draft'],
    ci: { state: 'none', passing: 0, failing: [], pending: 0, hiddenCount: 0 },
    merge: { state: 'draft', source: 'fresh', checkedAt: '2026-11-24T12:00:00.000Z' },
    blockerSummary: 'Draft · No CI checks · no review requested',
  });

  await mockApi(
    page,
    makeSnapshot({
      counts: { ...base.counts, draft: 2 },
      pullRequests: [
        ...base.pullRequests.filter((pr) => pr.key !== 'acme/docs#404'),
        behindDraft,
        upToDateDraft,
      ],
    }),
  );
  await page.goto('/');

  await page.locator('#include-drafts').check();

  const behindCard = page.locator('.action-queue .pr-card', { hasText: 'acme/docs#404' });
  const upToDateCard = page.locator('.action-queue .pr-card', { hasText: 'acme/docs#405' });

  await expect(behindCard.locator('.sync-btn')).toBeVisible();
  await expect(behindCard.locator('.sync-btn')).toContainText('Sync');
  await expect(upToDateCard.locator('.sync-btn')).toHaveCount(0);

  await behindCard.locator('.pr-card-trigger').click();
  const inspector = page.locator('.inspector-dialog');
  await expect(inspector).toHaveClass(/open/);
  await expect(inspector.locator('.sync-action-btn')).toBeVisible();
  await expect(inspector.locator('.sync-action-btn')).toContainText('Sync with main');
  await expect(inspector.getByText('Merge pull request')).toHaveCount(0);

  await upToDateCard.locator('.pr-card-trigger').click();
  await expect(inspector.locator('.sync-action-btn')).toHaveCount(0);

  let synced = false;
  let receivedExpectedSha: string | undefined;
  await page.route('**/api/pull/acme/docs/404/update-branch', async (route) => {
    const body = route.request().postDataJSON() as { expectedHeadSha?: string };
    receivedExpectedSha = body.expectedHeadSha;
    synced = true;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Updating pull request branch.' }),
    });
  });
  await page.route('**/api/snapshot', async (route) => {
    const updatedDraft = synced
      ? {
          ...behindDraft,
          headRefOid: 'oid-404-synced',
          blockers: ['draft'] as typeof behindDraft.blockers,
          merge: {
            state: 'draft' as const,
            source: 'fresh' as const,
            checkedAt: '2026-11-24T12:05:00.000Z',
          },
          blockerSummary: 'Draft · No CI checks · no review requested',
        }
      : behindDraft;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: synced ? '"e2e-snapshot-synced"' : '"e2e-snapshot"' },
      body: JSON.stringify(
        makeSnapshot({
          counts: { ...base.counts, draft: 2 },
          pullRequests: [
            ...base.pullRequests.filter((pr) => pr.key !== 'acme/docs#404'),
            updatedDraft,
            upToDateDraft,
          ],
        }),
      ),
    });
  });

  await behindCard.locator('.sync-btn').click();
  await expect.poll(() => receivedExpectedSha).toBe('oid-101');
  await expect(behindCard.locator('.sync-btn')).toContainText('Synced');
  await expect(behindCard.locator('.sync-btn')).toHaveAttribute('aria-disabled', 'true');
  await expect(behindCard.locator('.sync-btn')).toHaveCount(0, { timeout: 5000 });
});
