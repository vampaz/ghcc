import { expect, test, type Page } from '@playwright/test';
import type { SnapshotResponse } from '../src/types/pr';
import { makePrDetail, makeSnapshot } from './fixtures/snapshot';

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
