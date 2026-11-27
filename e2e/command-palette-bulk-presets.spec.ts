import { expect, test } from '@playwright/test';
import type { SavedFilterPreset } from '../src/types/pr';
import { makePrDetail, makeSnapshot } from './fixtures/snapshot';

test('supports Cmd+K command palette, bulk actions (no merge), and saved filter presets', async ({
  page,
}) => {
  const base = makeSnapshot();
  const snapshot = makeSnapshot({
    pullRequests: base.pullRequests.map((pr) =>
      pr.key === 'acme/core-api#101' || pr.key === 'acme/web-app#202'
        ? { ...pr, merge: { state: 'behind', source: 'fresh' } }
        : pr,
    ),
  });

  const savedPresets: SavedFilterPreset[] = [];
  const syncedKeys: string[] = [];

  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unmocked API route' }),
    });
  });

  await page.route('**/api/presets', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ presets: savedPresets }),
      });
      return;
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON() as {
        name: string;
        filters: SavedFilterPreset['filters'];
      };
      const preset: SavedFilterPreset = {
        id: `preset-${savedPresets.length + 1}`,
        name: body.name,
        filters: body.filters,
        createdAt: new Date().toISOString(),
      };
      savedPresets.push(preset);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ preset, presets: savedPresets }),
      });
      return;
    }
    if (method === 'DELETE') {
      const body = route.request().postDataJSON() as { id: string };
      const idx = savedPresets.findIndex((p) => p.id === body.id);
      if (idx >= 0) {
        savedPresets.splice(idx, 1);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ presets: savedPresets }),
      });
    }
  });

  await page.route('**/api/pull/*/*/*/update-branch', async (route) => {
    const { pathname } = new URL(route.request().url());
    const match = /^\/api\/pull\/([^/]+)\/([^/]+)\/(\d+)\/update-branch$/.exec(pathname);
    syncedKeys.push(`${match![1]}/${match![2]}#${match![3]}`);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Updating pull request branch.' }),
    });
  });

  await page.route('**/api/pull/*/*/*', async (route) => {
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
    const key = `${match[1]}/${match[2]}#${match[3]}`;
    const pr = snapshot.pullRequests.find((item) => item.key === key);
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
      headers: { etag: '"e2e-palette"' },
      body: JSON.stringify(snapshot),
    });
  });

  await page.goto('/');

  // Open Command Palette via header button and apply "Stale > 3d"
  await page.getByRole('button', { name: 'Open command palette' }).click();
  const palette = page.locator('.command-palette-dialog');
  await expect(palette).toBeVisible();
  await palette.locator('.palette-input').fill('Stale');
  await palette.locator('.palette-option', { hasText: 'Stale > 3d' }).click();

  await expect(page.locator('.action-queue .pr-card')).toHaveCount(1);
  await expect(page.locator('.action-queue .pr-card')).toContainText('acme/worker#303');

  // Save current view as preset
  await page.getByRole('button', { name: 'Filter presets' }).click();
  await page.locator('.save-preset-input').fill('Stale Queue');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.preset-picker-popover')).toContainText('Stale Queue');
  await page.keyboard.press('Escape');

  // Clear filters and select 2 behind-base PRs for Bulk Sync
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select acme/core-api#101 for bulk action' }).click();
  await page.getByRole('checkbox', { name: 'Select acme/web-app#202 for bulk action' }).click();

  const bulkBar = page.locator('.bulk-action-bar');
  await expect(bulkBar).toBeVisible();
  await expect(bulkBar).toContainText('2 selected');
  await expect(bulkBar).not.toContainText('Squash');

  await bulkBar.getByRole('button', { name: /Sync behind \(2\)/i }).click();
  await expect.poll(() => syncedKeys.length).toBe(2);
  await expect(bulkBar).toContainText('2 succeeded');
});
