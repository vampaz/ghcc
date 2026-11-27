import { expect, test } from '@playwright/test';
import { makePrDetail, makePrView, makeSnapshot } from './fixtures/snapshot';

test('supports inline review thread reply/resolve and two-step quick approval', async ({
  page,
}) => {
  const teammatePr = makePrView({
    key: 'acme/web-app#505',
    repo: 'web-app',
    repository: 'acme/web-app',
    number: 505,
    title: 'feat: teammate SSO review',
    author: 'ana',
    sources: ['review-requested'],
    bucket: 'needs-me',
    myAction: 'review',
    unresolvedThreadCount: 1,
    ci: { state: 'passing', passing: 2, failing: [], pending: 0, hiddenCount: 0 },
    blockerSummary: 'Your review requested · CI passing ✓',
  });

  const base = makeSnapshot();
  const snapshot = makeSnapshot({
    pullRequests: [teammatePr, ...base.pullRequests],
  });

  let approved = false;
  let resolved = false;
  const replies: string[] = [];

  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unmocked API route' }),
    });
  });

  await page.route('**/api/pull/acme/web-app/505/review', async (route) => {
    const body = route.request().postDataJSON() as { event: string };
    if (body.event === 'APPROVE') {
      approved = true;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, event: body.event, state: 'APPROVED' }),
    });
  });

  await page.route('**/api/pull/acme/web-app/505/threads/PRRT_505/reply', async (route) => {
    const body = route.request().postDataJSON() as { body: string };
    replies.push(body.body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        threadId: 'PRRT_505',
        comment: {
          id: 'PRRC_reply',
          author: 'vampaz',
          bodyExcerpt: body.body,
          bodyHtml: `<p>${body.body}</p>`,
          createdAt: new Date().toISOString(),
          url: null,
        },
      }),
    });
  });

  await page.route('**/api/pull/acme/web-app/505/threads/PRRT_505/resolve', async (route) => {
    const body = route.request().postDataJSON() as { resolved: boolean };
    resolved = body.resolved;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, threadId: 'PRRT_505', isResolved: resolved }),
    });
  });

  await page.route('**/api/pull/acme/web-app/505', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...makePrDetail(teammatePr),
        reviewThreads: [
          {
            id: 'PRRT_505',
            isResolved: resolved,
            isOutdated: false,
            path: 'src/sso.ts',
            line: 88,
            originalLine: 88,
            comments: [
              {
                id: 'PRRC_orig',
                author: 'leo',
                bodyExcerpt: 'Check token audience here.',
                bodyHtml: '<p>Check token audience here.</p>',
                createdAt: '2026-11-24T10:00:00.000Z',
                url: 'https://github.com/acme/web-app/pull/505#discussion_r1',
              },
              ...replies.map((text, i) => ({
                id: `PRRC_r_${i}`,
                author: 'vampaz',
                bodyExcerpt: text,
                bodyHtml: `<p>${text}</p>`,
                createdAt: new Date().toISOString(),
                url: null,
              })),
            ],
          },
        ],
      }),
    });
  });

  await page.route('**/api/snapshot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: resolved ? '"e2e-rev-2"' : '"e2e-rev-1"' },
      body: JSON.stringify({
        ...snapshot,
        pullRequests: snapshot.pullRequests.map((pr) =>
          pr.key === 'acme/web-app#505' ? { ...pr, unresolvedThreadCount: resolved ? 0 : 1 } : pr,
        ),
      }),
    });
  });

  await page.goto('/');

  const card = page.locator('.action-queue .pr-card', { hasText: 'acme/web-app#505' });
  await expect(card).toContainText('1 unresolved');
  await card.locator('.pr-card-trigger').click();

  const inspector = page.locator('.inspector-dialog');
  await expect(inspector).toHaveClass(/open/);
  await expect(inspector.locator('.thread-path')).toContainText('src/sso.ts:88');

  // Reply to thread
  await inspector.getByRole('button', { name: 'Reply' }).click();
  await inspector.locator('#reply-PRRT_505').fill('Verified aud claim check.');
  await inspector.getByRole('button', { name: 'Send reply' }).click();
  await expect(inspector).toContainText('Verified aud claim check.');

  // Resolve thread -> card badge disappears
  await inspector.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(inspector).toContainText('All review threads are resolved.');
  await expect(card).not.toContainText('1 unresolved');

  // Two-step inline Approve
  await inspector.getByRole('button', { name: 'Approve', exact: true }).click();
  expect(approved).toBe(false);
  await inspector.getByRole('button', { name: 'Confirm approval' }).click();
  await expect.poll(() => approved).toBe(true);
  await expect(inspector.locator('.rerun-status-note')).toContainText('Approved pull request.');
});
