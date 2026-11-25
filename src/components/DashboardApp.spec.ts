import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardApp from '@/components/DashboardApp.vue';
import { IDLE_PR_SYNC_STATE, transitionPrSyncState } from '@/composables/use-dashboard-state';
import { mountWithDeps } from '@/test/mount-with-deps';
import type { PrDetailResponse, PrView, SnapshotResponse } from '@/types/pr';

function makePrView(overrides: Partial<PrView> = {}): PrView {
  return {
    key: 'acme/core-api#101',
    owner: 'acme',
    repo: 'core-api',
    repository: 'acme/core-api',
    number: 101,
    title: 'fix: stabilize retry loop',
    url: 'https://github.com/acme/core-api/pull/101',
    author: 'vampaz',
    baseRefName: 'main',
    headRefName: 'fix/retry-loop',
    headRefOid: 'oid-101',
    isDraft: false,
    sources: ['authored'],
    bucket: 'needs-me',
    myAction: 'fix-ci',
    blockers: ['ci-failing'],
    ci: {
      state: 'failing',
      passing: 2,
      failing: [{ name: 'unit-tests', url: 'https://github.com/acme/core-api/actions/1' }],
      pending: 0,
      hiddenCount: 0,
    },
    review: {
      decision: 'required',
      approvals: [],
      changesRequested: [],
      pending: ['ana'],
    },
    merge: {
      state: 'clean',
      source: 'fresh',
      checkedAt: '2026-11-24T12:00:00.000Z',
    },
    autoMerge: false,
    autoMergeMethod: null,
    mergeQueue: null,
    size: { additions: 120, deletions: 40, files: 4 },
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-24T11:00:00.000Z',
    lastCommittedAt: '2026-11-24T10:00:00.000Z',
    ageDays: 4,
    idleDays: 0,
    blockerSummary: 'CI 1 failing · waiting on @ana',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<SnapshotResponse> = {}): SnapshotResponse {
  const prs = [
    makePrView(),
    makePrView({
      key: 'acme/web-app#202',
      owner: 'acme',
      repo: 'web-app',
      repository: 'acme/web-app',
      number: 202,
      title: 'feat: dark theme tokens',
      url: 'https://github.com/acme/web-app/pull/202',
      bucket: 'ready',
      myAction: 'merge',
      blockers: [],
      ci: { state: 'passing', passing: 3, failing: [], pending: 0, hiddenCount: 0 },
      review: { decision: 'approved', approvals: ['ana'], changesRequested: [], pending: [] },
      blockerSummary: 'CI passing ✓ · mergeable · Approved ✓',
    }),
    makePrView({
      key: 'acme/worker#303',
      owner: 'acme',
      repo: 'worker',
      repository: 'acme/worker',
      number: 303,
      title: 'chore: queue worker tuneup',
      url: 'https://github.com/acme/worker/pull/303',
      bucket: 'waiting',
      myAction: 'ping',
      blockers: ['review-required'],
      ci: { state: 'passing', passing: 1, failing: [], pending: 0, hiddenCount: 0 },
      idleDays: 5,
      blockerSummary: 'CI passing ✓ · waiting on @leo · 5d since update',
    }),
    makePrView({
      key: 'acme/docs#404',
      owner: 'acme',
      repo: 'docs',
      repository: 'acme/docs',
      number: 404,
      title: 'wip: architecture diagram',
      url: 'https://github.com/acme/docs/pull/404',
      isDraft: true,
      bucket: 'draft',
      myAction: 'none',
      blockers: ['draft'],
      ci: { state: 'none', passing: 0, failing: [], pending: 0, hiddenCount: 0 },
      blockerSummary: 'Draft · No CI checks · no review requested',
    }),
  ];

  return {
    fetchedAt: new Date().toISOString(),
    viewer: { login: 'vampaz' },
    state: 'ready',
    counts: { needsMe: 1, ready: 1, waiting: 1, draft: 1 },
    pullRequests: prs,
    rateLimit: {
      graphql: { remaining: 4950, limit: 5000, resetAt: '2026-11-24T13:00:00.000Z' },
      core: null,
    },
    warnings: [],
    ...overrides,
  };
}

function makeDetail(): PrDetailResponse {
  return {
    key: 'acme/core-api#101',
    owner: 'acme',
    repo: 'core-api',
    number: 101,
    title: 'fix: stabilize retry loop',
    url: 'https://github.com/acme/core-api/pull/101',
    baseRefName: 'main',
    headRefName: 'fix/retry-loop',
    isDraft: false,
    bodyExcerpt: 'Stabilizes backoff jitter on transient 502 responses.',
    checksTotalCount: 1,
    checks: [
      {
        name: 'unit-tests',
        kind: 'CheckRun',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        bucket: 'failing',
        url: 'https://github.com/acme/core-api/actions/1',
        description: null,
        startedAt: null,
        completedAt: null,
      },
    ],
    reviewers: [
      { login: 'ana', kind: 'user', state: 'PENDING', submittedAt: null, asCodeOwner: true },
    ],
    timeline: [
      {
        id: 'tl-1',
        kind: 'commit',
        actor: 'vampaz',
        createdAt: '2026-11-24T10:00:00.000Z',
        summary: 'abc1234: fix jitter clamp',
      },
    ],
    fetchedAt: '2026-11-24T12:00:00.000Z',
  };
}

describe('DashboardApp', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn<typeof window.matchMedia>().mockImplementation((query: string) => ({
        matches: query.includes('min-width: 768px'),
        media: query,
        onchange: null,
        addListener: vi.fn<() => void>(),
        removeListener: vi.fn<() => void>(),
        addEventListener: vi.fn<() => void>(),
        removeEventListener: vi.fn<() => void>(),
        dispatchEvent: vi.fn<() => boolean>(() => false),
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders KPI counts, keeps drafts collapsed by default, and filters via KPI tiles + repo breakdown', async () => {
    const snap = makeSnapshot();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(snap), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"snap-1"' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountWithDeps(DashboardApp);
    await flushPromises();

    // Drafts excluded by default; single Include drafts checkbox (no right-rail Drafts panel)
    expect(wrapper.find('#drafts-list').exists()).toBe(false);
    expect(wrapper.find('#include-drafts').exists()).toBe(true);
    expect((wrapper.find('#include-drafts').element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.find('#repo-filter').exists()).toBe(false);
    // Primary action queue shows needs-me + ready (2 cards)
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);
    expect(wrapper.text()).toContain('vampaz');
    expect(wrapper.text()).toContain('GQL 4950/5000');

    // Click READY KPI tile -> filters action queue to ready PR with human-readable chip
    const kpiTiles = wrapper.findAll('.kpi-tile');
    await kpiTiles[1]!.trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('.action-queue').text()).toContain('acme/web-app#202');
    expect(wrapper.find('.bucket-chip').text()).toContain('Ready to Merge');
    expect(window.location.search).toContain('bucket=ready');

    // Clear bucket filter via chip
    await wrapper.find('.bucket-chip').trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);

    // Click WAITING KPI tile -> hides right-rail WaitingPanel to avoid duplication
    await kpiTiles[2]!.trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('#waiting-heading').exists()).toBe(false);
    await wrapper.find('.bucket-chip').trigger('click');
    expect(wrapper.find('#waiting-heading').exists()).toBe(true);

    // Filter by repository via By Repository -> updates KPI tiles and shows repo chip
    const repoRows = wrapper.findAll('.repo-row');
    await repoRows[0]!.trigger('click');
    expect(window.location.search).toContain('repo=');
    expect(wrapper.find('.repo-chip').exists()).toBe(true);
    // Scoped KPI: Ready to Merge updates from 1 to 0 when filtering to acme/core-api
    expect(wrapper.findAll('.kpi-tile')[1]!.find('.kpi-value').text()).toBe('0');
    await wrapper.find('.repo-chip').trigger('click');

    // Toggle Include drafts checkbox -> includes draft PR in Action Queue & updates URL
    await wrapper.find('#include-drafts').setValue(true);
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(3);
    expect(wrapper.find('.action-queue').text()).toContain('acme/docs#404');
    expect(window.location.search).toContain('drafts=1');

    // Clear resets Include drafts back to unchecked
    await wrapper.find('.clear-btn').trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);
    expect((wrapper.find('#include-drafts').element as HTMLInputElement).checked).toBe(false);

    wrapper.unmount();
  });

  it('renders rate-limited warning strip while retaining cached PRs and opens inspector detail', async () => {
    const snap = makeSnapshot({
      state: 'rate-limited',
      warnings: [{ code: 'rate-limited', message: 'GitHub rate limit reached.' }],
    });
    const detail = makeDetail();

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/pull/')) {
        return new Response(JSON.stringify(detail), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(snap), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"snap-rl"' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Stub dialog showModal/close for happy-dom
    HTMLDialogElement.prototype.showModal = vi.fn<() => void>(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn<() => void>(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });

    const wrapper = mountWithDeps(DashboardApp);
    await flushPromises();

    expect(wrapper.find('.warning-strip').text()).toContain('Rate Limited');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);

    // Click first PR card to open inspector
    await wrapper.find('.pr-card-trigger').trigger('click');
    await flushPromises();

    expect(wrapper.find('.inspector-dialog').text()).toContain('Stabilizes backoff jitter');
    expect(wrapper.find('.inspector-dialog').text()).toContain('abc1234: fix jitter clamp');

    wrapper.unmount();
  });

  it('supports keyboard j/k/o navigation and renders inline inspector on narrow viewports', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn<typeof window.matchMedia>().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn<() => void>(),
        removeListener: vi.fn<() => void>(),
        addEventListener: vi.fn<() => void>(),
        removeEventListener: vi.fn<() => void>(),
        dispatchEvent: vi.fn<() => boolean>(() => false),
      })),
    });

    const snap = makeSnapshot();
    const detail = makeDetail();
    const openSpy = vi.fn<typeof window.open>();
    vi.stubGlobal('open', openSpy);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/pull/')) {
          return new Response(JSON.stringify(detail), { status: 200 });
        }
        return new Response(JSON.stringify(snap), { status: 200 });
      }),
    );

    const wrapper = mountWithDeps(DashboardApp, { attachTo: document.body });
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    await flushPromises();
    expect(document.activeElement?.getAttribute('data-pr-key')).toBe('acme/core-api#101');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    await flushPromises();
    expect(document.activeElement?.getAttribute('data-pr-key')).toBe('acme/web-app#202');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/acme/web-app/pull/202',
      '_blank',
      'noopener,noreferrer',
    );

    // Narrow viewport renders inline inspector inside card
    await wrapper.find('.pr-card-trigger').trigger('click');
    await flushPromises();
    expect(wrapper.find('.inspector-inline').exists()).toBe(true);
    expect(wrapper.find('.inspector-dialog').exists()).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('.inspector-inline').exists()).toBe(false);

    wrapper.unmount();
  });

  it('focuses search on / without mutating input value and handles Escape clear/blur', async () => {
    const snap = makeSnapshot();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(snap), { status: 200 })),
    );

    const wrapper = mountWithDeps(DashboardApp, { attachTo: document.body });
    await flushPromises();

    const search = wrapper.find<HTMLInputElement>('#pr-search');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    await flushPromises();
    expect(document.activeElement).toBe(search.element);
    expect(search.element.value).toBe('');

    // Synthetic '/' arrival immediately after focus is suppressed
    search.element.value = '/';
    search.element.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    expect(search.element.value).toBe('');

    // Normal typing (including '/') works afterward
    await search.setValue('dark');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);

    // First Escape inside #pr-search clears text
    search.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(search.element.value).toBe('');
    expect(document.activeElement).toBe(search.element);

    // Second Escape when empty blurs #pr-search
    search.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(document.activeElement).not.toBe(search.element);

    wrapper.unmount();
  });

  it('displays sub-day oldest waiting age in KPI tile instead of 0d', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const snap = makeSnapshot({
      pullRequests: [
        makePrView({
          key: 'acme/worker#305',
          owner: 'acme',
          repo: 'worker',
          repository: 'acme/worker',
          number: 305,
          bucket: 'waiting',
          idleDays: 0,
          lastCommittedAt: twoHoursAgo,
        }),
      ],
      counts: { needsMe: 0, ready: 0, waiting: 1, draft: 0 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(snap), { status: 200 })),
    );

    const wrapper = mountWithDeps(DashboardApp);
    await flushPromises();

    const waitingTile = wrapper.findAll('.kpi-tile')[2]!;
    expect(waitingTile.text()).toContain('oldest 2h');
    expect(waitingTile.text()).not.toContain('oldest 0d');

    wrapper.unmount();
  });

  it('shows Sync buttons only for behind-base PRs, sends update-branch, and handles success and error states', async () => {
    vi.useFakeTimers();
    try {
      const behindSha = 'b'.repeat(40);
      const updatedSha = 'c'.repeat(40);

      // Verify explicit FSM transitions directly
      const syncing = transitionPrSyncState(IDLE_PR_SYNC_STATE, {
        type: 'SYNC_REQUEST',
        headRefOid: behindSha,
      });
      expect(syncing).toEqual({ status: 'syncing', headRefOid: behindSha });
      const failed = transitionPrSyncState(syncing, {
        type: 'SYNC_FAILED',
        headRefOid: behindSha,
        error: 'Merge conflict',
      });
      expect(failed).toEqual({ status: 'error', headRefOid: behindSha, error: 'Merge conflict' });
      const retrying = transitionPrSyncState(failed, {
        type: 'SYNC_REQUEST',
        headRefOid: behindSha,
      });
      expect(retrying).toEqual({ status: 'syncing', headRefOid: behindSha });
      const accepted = transitionPrSyncState(retrying, {
        type: 'SYNC_ACCEPTED',
        headRefOid: behindSha,
        message: 'Updating pull request branch.',
      });
      expect(accepted).toEqual({
        status: 'synced',
        headRefOid: behindSha,
        message: 'Updating pull request branch.',
      });

      const behindActionPr = makePrView({
        key: 'acme/core-api#101',
        headRefOid: behindSha,
        baseRefName: 'master',
        merge: { state: 'behind', source: 'fresh', checkedAt: '2026-11-24T12:00:00.000Z' },
        blockers: ['ci-failing', 'behind-base'],
        blockerSummary: 'CI 1 failing · behind base',
      });
      const behindWaitingPr = makePrView({
        key: 'acme/worker#303',
        owner: 'acme',
        repo: 'worker',
        repository: 'acme/worker',
        number: 303,
        headRefOid: 'd'.repeat(40),
        baseRefName: 'main',
        bucket: 'waiting',
        myAction: 'rebase',
        blockers: ['behind-base'],
        ci: { state: 'passing', passing: 1, failing: [], pending: 0, hiddenCount: 0 },
        review: { decision: 'approved', approvals: ['ana'], changesRequested: [], pending: [] },
        merge: { state: 'behind', source: 'fresh', checkedAt: '2026-11-24T12:00:00.000Z' },
        blockerSummary: 'CI passing ✓ · behind base · Approved ✓',
      });
      const cleanPr = makePrView({
        key: 'acme/web-app#202',
        owner: 'acme',
        repo: 'web-app',
        repository: 'acme/web-app',
        number: 202,
        bucket: 'ready',
        myAction: 'merge',
        blockers: [],
        ci: { state: 'passing', passing: 3, failing: [], pending: 0, hiddenCount: 0 },
        review: { decision: 'approved', approvals: ['ana'], changesRequested: [], pending: [] },
        merge: { state: 'clean', source: 'fresh', checkedAt: '2026-11-24T12:00:00.000Z' },
      });

      let syncedCard = false;
      const updateCalls: Array<{ url: string; body: string }> = [];

      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/pull/acme/core-api/101/update-branch') {
          updateCalls.push({ url, body: String(init?.body ?? '') });
          syncedCard = true;
          return new Response(
            JSON.stringify({ ok: true, message: 'Updating pull request branch.' }),
            { status: 202, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url === '/api/pull/acme/worker/303/update-branch') {
          updateCalls.push({ url, body: String(init?.body ?? '') });
          return new Response(JSON.stringify({ error: 'Merge conflict with main' }), {
            status: 422,
            headers: { 'content-type': 'application/json' },
          });
        }
        const currentActionPr = syncedCard
          ? {
              ...behindActionPr,
              headRefOid: updatedSha,
              merge: { state: 'clean' as const, source: 'fresh' as const },
              blockers: ['ci-failing' as const],
            }
          : behindActionPr;
        return new Response(
          JSON.stringify(
            makeSnapshot({
              pullRequests: [currentActionPr, cleanPr, behindWaitingPr],
              counts: { needsMe: 1, ready: 1, waiting: 1, draft: 0 },
            }),
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json', etag: syncedCard ? '"s2"' : '"s1"' },
          },
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      const wrapper = mountWithDeps(DashboardApp);
      await flushPromises();

      // Action queue has 1 sync button (behind PR), not on clean PR
      expect(wrapper.findAll('.action-queue .sync-btn')).toHaveLength(1);
      // Waiting panel shows 'behind' reason and 1 sync button
      expect(wrapper.find('.waiting-who').text()).toBe('behind');
      expect(wrapper.findAll('.waiting-sync-btn')).toHaveLength(1);

      // Click Sync on action queue card
      const cardSyncBtn = wrapper.find('.action-queue .sync-btn');
      expect(cardSyncBtn.attributes('aria-label')).toBe('Sync acme/core-api#101 with master');
      await cardSyncBtn.trigger('click');
      await flushPromises();

      expect(updateCalls[0]).toEqual({
        url: '/api/pull/acme/core-api/101/update-branch',
        body: JSON.stringify({ expectedHeadSha: behindSha }),
      });
      expect(cardSyncBtn.text()).toContain('Synced');
      expect(cardSyncBtn.attributes('aria-disabled')).toBe('true');

      // Duplicate click while synced does not fire another request
      await cardSyncBtn.trigger('click');
      await flushPromises();
      expect(updateCalls).toHaveLength(1);

      // Advance timer -> follow-up snapshot refresh removes Sync button once no longer behind
      await vi.advanceTimersByTimeAsync(2_100);
      await flushPromises();
      expect(wrapper.findAll('.action-queue .sync-btn')).toHaveLength(0);

      // Click Sync on waiting panel PR -> surfaces 422 error alert inline
      const waitingSyncBtn = wrapper.find('.waiting-sync-btn');
      await waitingSyncBtn.trigger('click');
      await flushPromises();
      expect(wrapper.find('.waiting-sync-error').text()).toContain('Merge conflict with main');
      expect(waitingSyncBtn.attributes('aria-disabled')).toBeUndefined();

      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('excludes drafts from CI Health counts and ci-failing filter, and shows active-only counts in By Repository', async () => {
    const draftFailing = makePrView({
      key: 'acme/core-api#199',
      number: 199,
      isDraft: true,
      bucket: 'draft',
      myAction: 'none',
      blockers: ['draft', 'ci-failing'],
      ci: {
        state: 'failing',
        passing: 0,
        failing: [{ name: 'wip-lint', url: 'https://github.com/acme/core-api/actions/9' }],
        pending: 0,
        hiddenCount: 0,
      },
    });
    const baseSnap = makeSnapshot();
    const snap = makeSnapshot({
      pullRequests: [...baseSnap.pullRequests, draftFailing],
      counts: { ...baseSnap.counts, draft: 2 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(snap), { status: 200 })),
    );

    const wrapper = mountWithDeps(DashboardApp);
    await flushPromises();

    // CI Health excludes draftFailing -> only 1 failing active PR (#101)
    const ciTile = wrapper.findAll('.kpi-tile')[3]!;
    expect(ciTile.text()).toContain('1 fail');

    await ciTile.trigger('click');
    expect(wrapper.find('.bucket-chip').text()).toContain('Failing CI');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('.action-queue').text()).toContain('acme/core-api#101');
    expect(wrapper.find('.action-queue').text()).not.toContain('acme/core-api#199');

    // By Repository shows active count (1) + draft note (+1d) for acme/core-api when drafts excluded
    const coreRepoRow = wrapper.findAll('.repo-row').find((row) => row.text().includes('core-api'));
    expect(coreRepoRow?.text()).toContain('1');
    expect(coreRepoRow?.text()).toContain('+1d');

    // Checking Include drafts includes draftFailing in CI Health, ci-failing queue, and repo counts
    await wrapper.find('#include-drafts').setValue(true);
    expect(ciTile.text()).toContain('2 fail');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);
    expect(wrapper.find('.action-queue').text()).toContain('acme/core-api#199');
    expect(coreRepoRow?.text()).toContain('2');
    expect(coreRepoRow?.text()).not.toContain('+1d');

    wrapper.unmount();
  });

  it('shows teammates repo PRs in All and Team tabs (with author badge) and finds them via search without duplicating Waiting on Others', async () => {
    const myColorPr = makePrView({
      key: 'acme/docs#79',
      owner: 'acme',
      repo: 'docs',
      repository: 'acme/docs',
      number: 79,
      title: 'docs: align audit status colours',
      author: 'vampaz',
      sources: ['authored', 'repo'],
      bucket: 'ready',
      myAction: 'merge',
      blockers: [],
      ci: { state: 'passing', passing: 2, failing: [], pending: 0, hiddenCount: 0 },
    });
    const teamColorPr = makePrView({
      key: 'acme/frontend#5579',
      owner: 'acme',
      repo: 'frontend',
      repository: 'acme/frontend',
      number: 5579,
      title: 'feat: unify status colours across numbers',
      author: 'sh1ndz',
      sources: ['repo'],
      bucket: 'waiting',
      myAction: 'none',
      blockers: ['ci-pending'],
      ci: { state: 'pending', passing: 4, failing: [], pending: 2, hiddenCount: 0 },
      review: { decision: 'approved', approvals: ['vampaz'], changesRequested: [], pending: [] },
      blockerSummary: 'CI 2 pending · Approved ✓',
    });
    const myWaitingPr = makePrView({
      key: 'acme/frontend#5657',
      owner: 'acme',
      repo: 'frontend',
      repository: 'acme/frontend',
      number: 5657,
      title: 'chore: queue worker tuneup',
      author: 'vampaz',
      sources: ['authored', 'repo'],
      bucket: 'waiting',
      myAction: 'ping',
      blockers: ['review-required'],
      ci: { state: 'passing', passing: 1, failing: [], pending: 0, hiddenCount: 0 },
    });

    const snap = makeSnapshot({
      pullRequests: [myColorPr, myWaitingPr, teamColorPr],
      counts: { needsMe: 0, ready: 1, waiting: 2, draft: 0 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(snap), { status: 200 })),
    );

    const wrapper = mountWithDeps(DashboardApp);
    await flushPromises();

    // Under All: main queue shows myColorPr + teamColorPr (with @sh1ndz tag), NOT myWaitingPr
    const allCards = wrapper.findAll('.action-queue .pr-card');
    expect(allCards).toHaveLength(2);
    expect(wrapper.find('.action-queue').text()).toContain('acme/docs#79');
    expect(wrapper.find('.action-queue').text()).toContain('acme/frontend#5579');
    expect(wrapper.find('.action-queue').text()).toContain('@sh1ndz');
    // Right rail Waiting on Others shows only myWaitingPr (no duplicate #5579)
    expect(wrapper.findAll('.waiting-item')).toHaveLength(1);
    expect(wrapper.find('.waiting-list').text()).toContain('#5657');
    expect(wrapper.find('.waiting-list').text()).not.toContain('#5579');

    // Searching 'colo' finds both #79 and #5579 in the main queue
    await wrapper.find('#pr-search').setValue('colo');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);
    await wrapper.find('#pr-search').setValue('');

    // Clicking Team tab shows only teammates' PRs and hides right-rail Waiting on Others
    const teamBtn = wrapper.findAll('.seg-btn').find((b) => b.text() === 'Team');
    expect(teamBtn).toBeTruthy();
    await teamBtn!.trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('.action-queue').text()).toContain('acme/frontend#5579');
    expect(wrapper.find('#waiting-heading').exists()).toBe(false);

    // Clicking Mine tab excludes teamColorPr
    const mineBtn = wrapper.findAll('.seg-btn').find((b) => b.text() === 'Mine');
    await mineBtn!.trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('.action-queue').text()).toContain('acme/docs#79');
    expect(wrapper.find('#waiting-heading').exists()).toBe(true);

    wrapper.unmount();
  });
});
