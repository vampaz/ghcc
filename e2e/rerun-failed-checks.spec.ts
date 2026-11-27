import { expect, test } from '@playwright/test';
import { makePrDetail, makeSnapshot } from './fixtures/snapshot';

test('re-runs failed CI from both the PR card and individual failing job in the inspector', async ({
  page,
}) => {
  const headSha = 'a'.repeat(40);
  const base = makeSnapshot();
  const snapshot = makeSnapshot({
    pullRequests: base.pullRequests.map((pr) =>
      pr.key === 'acme/core-api#101' ? { ...pr, headRefOid: headSha } : pr,
    ),
  });

  const rerunBodies: Array<Record<string, unknown>> = [];
  let ciPendingAfterRerun = false;

  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unmocked API route' }),
    });
  });

  await page.route('**/api/pull/acme/core-api/101/rerun-failed', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    rerunBodies.push(body);
    if (!body.jobId) {
      ciPendingAfterRerun = true;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        scope: body.jobId ? 'job' : 'all',
        rerunCount: 1,
        runIds: body.jobId ? [] : [9001],
        ...(body.jobId ? { jobId: body.jobId } : {}),
        message: body.jobId
          ? 'Re-run requested for failed job.'
          : 'Re-run requested for 1 failed workflow run.',
      }),
    });
  });

  await page.route('**/api/pull/acme/core-api/101', async (route) => {
    const pr = snapshot.pullRequests.find((item) => item.key === 'acme/core-api#101')!;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makePrDetail(pr)),
    });
  });

  await page.route('**/api/snapshot', async (route) => {
    const current = ciPendingAfterRerun
      ? makeSnapshot({
          pullRequests: snapshot.pullRequests.map((pr) =>
            pr.key === 'acme/core-api#101'
              ? {
                  ...pr,
                  ci: { state: 'pending', passing: 2, failing: [], pending: 1, hiddenCount: 0 },
                  blockers: ['ci-pending'],
                  blockerSummary: 'CI 1 pending · waiting on @ana',
                }
              : pr,
          ),
        })
      : snapshot;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: ciPendingAfterRerun ? '"e2e-rerun-2"' : '"e2e-rerun-1"' },
      body: JSON.stringify(current),
    });
  });

  await page.goto('/');

  const failingCard = page.locator('.action-queue .pr-card', { hasText: 'acme/core-api#101' });
  const passingCard = page.locator('.action-queue .pr-card', { hasText: 'acme/web-app#202' });

  await expect(failingCard.locator('.rerun-btn')).toBeVisible();
  await expect(failingCard.locator('.rerun-btn')).toContainText('Re-run CI');
  await expect(passingCard.locator('.rerun-btn')).toHaveCount(0);

  // Open inspector and trigger per-job Re-run
  await failingCard.locator('.pr-card-trigger').click();
  const inspector = page.locator('.inspector-dialog');
  await expect(inspector).toHaveClass(/open/);
  await expect(inspector.locator('.checks-rerun-btn')).toContainText('Re-run failed');

  const jobRerunBtn = inspector.locator('.check-rerun-btn').first();
  await expect(jobRerunBtn).toContainText('Re-run');
  await jobRerunBtn.click();

  await expect.poll(() => rerunBodies[0]).toEqual({ jobId: 50001 });
  await expect(inspector.locator('.rerun-status-note')).toContainText(
    'Re-run requested for failed job.',
  );

  // Trigger PR-wide Re-run CI from card -> transitions to Queued then clears once snapshot turns pending
  await failingCard.locator('.rerun-btn').click();
  await expect.poll(() => rerunBodies[1]).toEqual({ expectedHeadSha: headSha });
  await expect(failingCard.locator('.rerun-btn')).toContainText('Queued');
  await expect(failingCard.locator('.rerun-btn')).toHaveCount(0, { timeout: 5000 });
});
