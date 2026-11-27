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

test('expands inline CI failure summary with annotations and log excerpt without horizontal overflow', async ({
  page,
}) => {
  const snapshot = makeSnapshot();

  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unmocked API route' }),
    });
  });

  await page.route('**/api/pull/acme/core-api/101/checks/50001/summary*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        checkRunId: 50001,
        name: 'unit-tests',
        title: 'Unit test failure',
        summary: '1 of 42 tests failed',
        annotations: [
          {
            path: 'src/retry.spec.ts',
            startLine: 27,
            endLine: 27,
            level: 'failure',
            title: 'AssertionError',
            message: 'Expected backoff delay to be <= 500ms',
          },
        ],
        failedStep: 'Run npm run test',
        logExcerpt:
          'FAIL src/retry.spec.ts > retries transient 502\n' +
          'AssertionError: expected 1200 to be less than or equal to 500\n' +
          '##[error]Process completed with exit code 1.',
        logTruncated: true,
        logUnavailableReason: null,
        detailsUrl: 'https://github.com/acme/core-api/actions/1',
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { etag: '"e2e-summary-1"' },
      body: JSON.stringify(snapshot),
    });
  });

  await page.goto('/');
  await page
    .locator('.action-queue .pr-card', { hasText: 'acme/core-api#101' })
    .locator('.pr-card-trigger')
    .click();

  const inspector = page.locator('.inspector-dialog');
  await expect(inspector).toHaveClass(/open/);
  const logsBtn = inspector.locator('.check-logs-btn').first();
  await expect(logsBtn).toContainText('Logs');
  await logsBtn.click();

  await expect(inspector.locator('.check-failed-step')).toContainText('Run npm run test');
  await expect(inspector.locator('.check-annotation-path')).toContainText('src/retry.spec.ts:27');
  await expect(inspector.locator('.check-log-pre')).toContainText('AssertionError');

  // Verify no horizontal overflow at 390px mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });
  const inlineInspector = page.locator('.inspector-inline');
  await expect(inlineInspector).toBeVisible();
  await inlineInspector.locator('.check-logs-btn').first().click();
  await expect(inlineInspector.locator('.check-log-pre')).toContainText('AssertionError');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
