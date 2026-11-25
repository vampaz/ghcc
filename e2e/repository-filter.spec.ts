import { expect, test, type Page } from '@playwright/test';
import { makeSnapshot } from './fixtures/snapshot';

async function mockSnapshot(page: Page): Promise<void> {
  await page.route('**/api/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"e2e-snapshot"' },
      body: JSON.stringify(makeSnapshot()),
    });
  });
}

test('filters the queue with the repository dropdown and restores all repos', async ({ page }) => {
  await mockSnapshot(page);
  await page.goto('/');

  const trigger = page.locator('.repo-picker-trigger');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(3);
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
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(2);
  await expect(page.locator('.kpi-tile').nth(1).locator('.kpi-value')).toHaveText('0');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('repos'))
    .toBe('acme/core-api,acme/docs,acme/worker');

  await page.locator('#toggle-all-repos').check();

  await expect(trigger).toContainText('All repos');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(3);
  await expect.poll(() => new URL(page.url()).searchParams.get('repos')).toBeNull();
});

test('restores the repository filter from the URL and collapses the empty rail in Team view', async ({
  page,
}) => {
  await mockSnapshot(page);
  await page.goto('/?repos=acme/core-api');

  const trigger = page.locator('.repo-picker-trigger');
  await expect(trigger).toContainText('core-api');
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(1);

  await page.getByRole('button', { name: 'Team', exact: true }).click();

  await expect(page.locator('.context-rail')).toHaveCount(0);
  await expect(page.locator('.dashboard-grid')).toHaveClass(/single-column/);

  await page.keyboard.press('Escape');

  await expect(trigger).toContainText('All repos');
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('updates repository counts with the Include drafts filter', async ({ page }) => {
  await mockSnapshot(page);
  await page.goto('/');

  await page.locator('.repo-picker-trigger').click();
  const docsRow = page.locator('.repo-row', { hasText: 'docs' });
  await expect(docsRow.locator('.repo-count')).toContainText('0');
  await expect(docsRow.locator('.repo-count')).toContainText('+1d');

  await page.locator('#include-drafts').check();
  await expect(page.locator('.action-queue .pr-card')).toHaveCount(4);

  await page.locator('.repo-picker-trigger').click();
  await expect(docsRow.locator('.repo-count')).toContainText('1');
  await expect(docsRow.locator('.repo-count')).not.toContainText('+1d');
  await expect(page.locator('#toggle-all-repos')).toBeChecked();
});
