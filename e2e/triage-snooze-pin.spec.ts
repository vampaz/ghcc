import { expect, test } from '@playwright/test';
import type { PrTriageInfo } from '../src/types/pr';
import { makePrDetail, makeSnapshot } from './fixtures/snapshot';

test('pins PRs to the top, snoozes Needs You PRs into Inbox Zero, and unsnoozes them', async ({
  page,
}) => {
  const base = makeSnapshot();
  const triageByKey = new Map<string, PrTriageInfo>();

  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unmocked API route' }),
    });
  });

  await page.route('**/api/pull/*/*/*/triage', async (route) => {
    const { pathname } = new URL(route.request().url());
    const match = /^\/api\/pull\/([^/]+)\/([^/]+)\/(\d+)\/triage$/.exec(pathname);
    const key = `${decodeURIComponent(match![1]!)}/${decodeURIComponent(match![2]!)}#${match![3]}`;
    const body = route.request().postDataJSON() as {
      action: 'pin' | 'unpin' | 'snooze' | 'unsnooze';
      condition?: PrTriageInfo['snoozeCondition'];
    };

    let next: PrTriageInfo = { pinned: false, isSnoozed: false };
    if (body.action === 'pin') {
      next = { pinned: true, pinnedAt: new Date().toISOString(), isSnoozed: false };
    } else if (body.action === 'snooze') {
      next = {
        pinned: false,
        isSnoozed: true,
        snoozedAt: new Date().toISOString(),
        snoozeCondition: body.condition,
      };
    }
    triageByKey.set(key, next);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, key, triage: next }),
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
    const key = `${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}#${match[3]}`;
    const pr = base.pullRequests.find((item) => item.key === key);
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
      headers: { etag: '"e2e-triage"' },
      body: JSON.stringify({
        ...base,
        pullRequests: base.pullRequests.map((pr) => ({
          ...pr,
          triage: triageByKey.get(pr.key) ?? { pinned: false, isSnoozed: false },
        })),
      }),
    });
  });

  await page.goto('/');

  // Pin #202 -> moves to first slot in Action Queue
  await page.getByRole('button', { name: 'Pin — acme/web-app#202' }).click();
  await expect(page.locator('.action-queue .pr-card-trigger').first()).toHaveAttribute(
    'data-pr-key',
    'acme/web-app#202',
  );

  // Snooze #101 (the only Needs You PR) -> drops NEEDS YOU to 0 with +1 snoozed
  await page.getByRole('button', { name: 'Snooze — acme/core-api#101' }).click();
  await page.getByRole('menuitem', { name: /Until next push/i }).click();

  const needsYouTile = page.getByRole('button', { name: /Needs You/i });
  await expect(needsYouTile.locator('.kpi-value')).toHaveText('0');
  await expect(needsYouTile).toContainText('+1 snoozed');

  // Filter to Needs You -> Inbox Zero empty state with Show 1 snoozed button
  await needsYouTile.click();
  await expect(page.locator('.empty-state.inbox-zero')).toBeVisible();
  await page.getByRole('button', { name: 'Show 1 snoozed' }).click();

  const snoozedCard = page.locator('.action-queue .pr-card', { hasText: 'acme/core-api#101' });
  await expect(snoozedCard).toBeVisible();
  await expect(snoozedCard).toContainText('snoozed · next push');

  // Unsnooze #101 -> NEEDS YOU returns to 1
  await page.getByRole('button', { name: 'Manage snooze — acme/core-api#101' }).click();
  await page.getByRole('menuitem', { name: /Unsnooze now/i }).click();
  await expect(needsYouTile.locator('.kpi-value')).toHaveText('1');
});
