import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardApp from '@/components/DashboardApp.vue';
import {
  IDLE_PR_DRAFT_STATE,
  IDLE_PR_LABELS_STATE,
  IDLE_PR_MERGE_STATE,
  IDLE_PR_SYNC_STATE,
  transitionPrDraftState,
  transitionPrLabelsState,
  transitionPrMergeState,
  transitionPrSyncState,
} from '@/composables/use-dashboard-state';
import {
  ALL_REPOS_SELECTION,
  NO_REPOS_SELECTION,
  parseFiltersFromSearch,
  serializeFiltersToSearch,
  toggleAllReposSelection,
  toggleRepoInSelection,
} from '@/composables/use-url-state';
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
    labels: [],
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
    // Primary action queue shows all active PRs (needs-me + ready + waiting = 3 cards)
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(3);
    expect(wrapper.find('svg.carbon-icon use[href="/icons.svg#carbon-terminal"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('svg.carbon-icon use[href="/icons.svg#carbon-launch"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('svg.carbon-icon use[href="/icons.svg#carbon-warning-filled"]').exists(),
    ).toBe(true);
    expect(wrapper.text()).toContain('vampaz');
    expect(wrapper.text()).toContain('GQL 4950/5000');

    // Click READY KPI tile -> filters action queue to ready PR with human-readable chip and hides WaitingPanel
    const kpiTiles = wrapper.findAll('.kpi-tile');
    await kpiTiles[1]!.trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('.action-queue').text()).toContain('acme/web-app#202');
    expect(wrapper.find('.bucket-chip').text()).toContain('Ready to Merge');
    expect(wrapper.find('#waiting-heading').exists()).toBe(false);
    expect(window.location.search).toContain('bucket=ready');

    // Clear bucket filter via chip -> restores WaitingPanel
    await wrapper.find('.bucket-chip').trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(3);
    expect(wrapper.find('#waiting-heading').exists()).toBe(true);

    // Click WAITING KPI tile -> hides right-rail WaitingPanel to avoid duplication
    await kpiTiles[2]!.trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('.action-queue .tag[data-tone="stale"]').text()).toBe('stale');
    expect(wrapper.find('#waiting-heading').exists()).toBe(false);
    await wrapper.find('.bucket-chip').trigger('click');
    expect(wrapper.find('#waiting-heading').exists()).toBe(true);
    expect(wrapper.findAll('.action-queue .tag[data-tone="stale"]')).toHaveLength(1);

    // Filter repositories via checkboxes: all start checked, unchecking one filters it out and updates KPIs
    const toggleAll = wrapper.find<HTMLInputElement>('#toggle-all-repos');
    expect(toggleAll.element.checked).toBe(true);
    expect(toggleAll.element.indeterminate).toBe(false);

    const webAppCheckbox = wrapper
      .findAll('.repo-row')
      .find((row) => row.text().includes('web-app'))!
      .find<HTMLInputElement>('input[type="checkbox"]');
    await webAppCheckbox.setValue(false);
    expect(window.location.search).toContain('repos=');
    expect(wrapper.find('.repo-chip').exists()).toBe(true);
    expect(toggleAll.element.checked).toBe(false);
    expect(toggleAll.element.indeterminate).toBe(true);
    // Scoped KPI: Ready to Merge updates from 1 to 0 when acme/web-app is unchecked
    expect(wrapper.findAll('.kpi-tile')[1]!.find('.kpi-value').text()).toBe('0');
    await wrapper.find('.repo-chip').trigger('click');
    expect(toggleAll.element.checked).toBe(true);
    expect(toggleAll.element.indeterminate).toBe(false);

    // Toggle Include drafts checkbox -> includes draft PR in Action Queue & updates URL
    await wrapper.find('#include-drafts').setValue(true);
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(4);
    expect(wrapper.find('.action-queue').text()).toContain('acme/docs#404');
    expect(window.location.search).toContain('drafts=1');

    // Clear resets Include drafts back to unchecked
    await wrapper.find('.clear-btn').trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(3);
    expect((wrapper.find('#include-drafts').element as HTMLInputElement).checked).toBe(false);

    wrapper.unmount();
  });

  it('renders rate-limited warning strip while retaining cached PRs and opens inspector detail', async () => {
    const snap = makeSnapshot({
      state: 'rate-limited',
      warnings: [{ code: 'rate-limited', message: 'GitHub rate limit reached.' }],
    });
    const detail = makeDetail();

    const detail2: PrDetailResponse = {
      ...detail,
      key: 'acme/web-app#202',
      repo: 'web-app',
      number: 202,
      title: 'feat: dark theme tokens',
      bodyExcerpt: 'Adds light-dark CSS custom properties.',
    };

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/web-app/202')) {
        return new Response(JSON.stringify(detail2), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
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

    const wrapper = mountWithDeps(DashboardApp, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('.warning-strip').text()).toContain('Rate Limited');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(3);

    // Click first PR card to open non-modal inspector drawer
    const triggers = wrapper.findAll('.pr-card-trigger');
    await triggers[0]!.trigger('click');
    await flushPromises();

    expect(wrapper.find('.inspector-dialog').classes()).toContain('open');
    expect(wrapper.find('.inspector-dialog').text()).toContain('Stabilizes backoff jitter');
    expect(wrapper.find('.inspector-dialog').text()).toContain('abc1234: fix jitter clamp');

    // Switch directly to second PR while drawer is open -> updates drawer in place
    await triggers[1]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.inspector-dialog').classes()).toContain('open');
    expect(wrapper.find('.inspector-dialog').text()).toContain('feat: dark theme tokens');
    expect(wrapper.find('.inspector-dialog').text()).toContain(
      'Adds light-dark CSS custom properties.',
    );

    // Clicking inside the open inspector keeps it open
    await wrapper.find('.inspector-dialog .summary-callout').trigger('click');
    expect(wrapper.find('.inspector-dialog').classes()).toContain('open');

    // Clicking a Waiting on Others PR item keeps the inspector open and switches to it
    await wrapper.find('.waiting-btn').trigger('click');
    await flushPromises();
    expect(wrapper.find('.inspector-dialog').classes()).toContain('open');

    // Clicking outside both the inspector and PR cards (e.g. header / KPI area) closes the drawer
    await wrapper.find('.app-footer').trigger('click');
    expect(wrapper.find('.inspector-dialog').classes()).not.toContain('open');

    // Re-open and verify Escape closes the desktop right sidebar
    await triggers[0]!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.inspector-dialog').classes()).toContain('open');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('.inspector-dialog').classes()).not.toContain('open');

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

      // Action queue has 2 sync buttons (behindActionPr + behindWaitingPr), not on clean PR
      expect(wrapper.findAll('.action-queue .sync-btn')).toHaveLength(2);
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

      // Advance timer -> follow-up snapshot refresh removes Sync button on #101 once no longer behind
      await vi.advanceTimersByTimeAsync(2_100);
      await flushPromises();
      expect(wrapper.findAll('.action-queue .sync-btn')).toHaveLength(1);

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

    // Under All: main queue shows all 3 active PRs (myColorPr, myWaitingPr, and teamColorPr with @sh1ndz tag)
    const allCards = wrapper.findAll('.action-queue .pr-card');
    expect(allCards).toHaveLength(3);
    expect(wrapper.find('.action-queue').text()).toContain('acme/docs#79');
    expect(wrapper.find('.action-queue').text()).toContain('acme/frontend#5657');
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

    // Clicking Mine tab shows authored PRs (including authored waiting PR #5657) and excludes teamColorPr
    const mineBtn = wrapper.findAll('.seg-btn').find((b) => b.text() === 'Mine');
    await mineBtn!.trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);
    expect(wrapper.find('.action-queue').text()).toContain('acme/docs#79');
    expect(wrapper.find('.action-queue').text()).toContain('acme/frontend#5657');
    expect(wrapper.find('#waiting-heading').exists()).toBe(true);

    wrapper.unmount();
  });

  it('supports multi-repository checkbox filtering, header toggle-all, and URL serialization', async () => {
    const allRepos = ['acme/core-api', 'acme/web-app', 'acme/worker', 'acme/docs'];

    // Pure selection FSM & URL helpers
    const withoutCore = toggleRepoInSelection(ALL_REPOS_SELECTION, 'acme/core-api', allRepos);
    expect(withoutCore).toEqual({
      mode: 'subset',
      repos: ['acme/docs', 'acme/web-app', 'acme/worker'],
    });
    expect(toggleAllReposSelection(withoutCore, allRepos)).toEqual(ALL_REPOS_SELECTION);
    expect(toggleAllReposSelection(ALL_REPOS_SELECTION, allRepos)).toEqual(NO_REPOS_SELECTION);
    expect(toggleRepoInSelection(NO_REPOS_SELECTION, 'acme/web-app', allRepos)).toEqual({
      mode: 'subset',
      repos: ['acme/web-app'],
    });
    expect(parseFiltersFromSearch('?repos=none').repoSelection).toEqual(NO_REPOS_SELECTION);
    expect(parseFiltersFromSearch('?repo=acme/web-app').repoSelection).toEqual({
      mode: 'subset',
      repos: ['acme/web-app'],
    });
    expect(
      serializeFiltersToSearch({
        view: 'all',
        bucket: '',
        q: '',
        repoSelection: { mode: 'subset', repos: ['acme/web-app', 'acme/core-api'] },
        drafts: false,
      }),
    ).toBe('?repos=acme%2Fcore-api%2Cacme%2Fweb-app');

    const snap = makeSnapshot();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(snap), { status: 200 })),
    );

    const wrapper = mountWithDeps(DashboardApp);
    await flushPromises();

    const toggleAll = wrapper.find<HTMLInputElement>('#toggle-all-repos');
    expect(toggleAll.element.checked).toBe(true);

    // Uncheck all via header toggle -> 0 PRs shown, 'No repos' chip, ?repos=none
    await toggleAll.setValue(false);
    expect(toggleAll.element.checked).toBe(false);
    expect(toggleAll.element.indeterminate).toBe(false);
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(0);
    expect(wrapper.find('.repo-chip').text()).toContain('No repos');
    expect(window.location.search).toContain('repos=none');

    // Check only core-api and web-app -> shows both PRs and '2 repos' chip
    const coreCheck = wrapper
      .findAll('.repo-row')
      .find((r) => r.text().includes('core-api'))!
      .find<HTMLInputElement>('input[type="checkbox"]');
    const webCheck = wrapper
      .findAll('.repo-row')
      .find((r) => r.text().includes('web-app'))!
      .find<HTMLInputElement>('input[type="checkbox"]');

    await coreCheck.setValue(true);
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('.repo-chip').text()).toContain('core-api');
    expect(toggleAll.element.indeterminate).toBe(true);

    await webCheck.setValue(true);
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);
    expect(wrapper.find('.repo-chip').text()).toContain('2 repos');

    // Clicking header toggle while indeterminate restores all repos
    await toggleAll.setValue(true);
    expect(toggleAll.element.checked).toBe(true);
    expect(toggleAll.element.indeterminate).toBe(false);
    expect(wrapper.find('.repo-chip').exists()).toBe(false);
    expect(window.location.search).toBe('');

    wrapper.unmount();
  });

  it('renders Ready/Draft toggle on every PR, updates via API, suppresses no-op clicks, and surfaces errors', async () => {
    // Verify explicit draft FSM transitions
    const updating = transitionPrDraftState(IDLE_PR_DRAFT_STATE, {
      type: 'TOGGLE_REQUEST',
      targetDraft: true,
    });
    expect(updating).toEqual({ status: 'updating', targetDraft: true });
    const failed = transitionPrDraftState(updating, {
      type: 'TOGGLE_FAILED',
      targetDraft: true,
      error: 'Forbidden',
    });
    expect(failed).toEqual({ status: 'error', targetDraft: true, error: 'Forbidden' });
    const retrying = transitionPrDraftState(failed, {
      type: 'TOGGLE_REQUEST',
      targetDraft: true,
    });
    expect(retrying).toEqual({ status: 'updating', targetDraft: true });
    expect(transitionPrDraftState(retrying, { type: 'TOGGLE_SUCCEEDED' })).toEqual(
      IDLE_PR_DRAFT_STATE,
    );

    let coreIsDraft = false;
    let docsIsDraft = true;
    const draftCalls: Array<{ url: string; body: string }> = [];

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/pull/acme/core-api/101/draft') {
        const body = String(init?.body ?? '');
        draftCalls.push({ url, body });
        const parsed = JSON.parse(body) as { draft: boolean };
        coreIsDraft = parsed.draft;
        return new Response(JSON.stringify({ ok: true, isDraft: coreIsDraft }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/pull/acme/docs/404/draft') {
        const body = String(init?.body ?? '');
        draftCalls.push({ url, body });
        const parsed = JSON.parse(body) as { draft: boolean };
        docsIsDraft = parsed.draft;
        return new Response(JSON.stringify({ ok: true, isDraft: docsIsDraft }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/pull/acme/worker/303/draft') {
        draftCalls.push({ url, body: String(init?.body ?? '') });
        return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('/api/pull/')) {
        return new Response(JSON.stringify({ ...makeDetail(), isDraft: coreIsDraft }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      const base = makeSnapshot();
      const prs = base.pullRequests.map((p) => {
        if (p.key === 'acme/core-api#101') {
          return {
            ...p,
            isDraft: coreIsDraft,
            bucket: coreIsDraft ? ('draft' as const) : ('needs-me' as const),
          };
        }
        if (p.key === 'acme/docs#404') {
          return {
            ...p,
            isDraft: docsIsDraft,
            bucket: docsIsDraft ? ('draft' as const) : ('ready' as const),
          };
        }
        return p;
      });
      return new Response(
        JSON.stringify({
          ...base,
          pullRequests: prs,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: `"s-${coreIsDraft}-${docsIsDraft}"`,
          },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountWithDeps(DashboardApp);
    await flushPromises();

    // Include drafts so both ready and draft PRs are visible in Action Queue
    await wrapper.find('#include-drafts').setValue(true);
    expect(wrapper.findAll('.action-queue .draft-toggle')).toHaveLength(4);
    expect(wrapper.findAll('.waiting-item .draft-toggle')).toHaveLength(1);

    // Clicking Ready on an already-ready PR (#101) is a no-op
    const readyBtn101 = wrapper.find('button[aria-label="Ready — acme/core-api#101"]');
    expect(readyBtn101.attributes('aria-pressed')).toBe('true');
    await readyBtn101.trigger('click');
    await flushPromises();
    expect(draftCalls).toHaveLength(0);

    // Open inspector for #101 -> inspector also shows Ready/Draft toggle
    await wrapper.find('[data-pr-key="acme/core-api#101"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('.inspector-dialog .draft-toggle').exists()).toBe(true);

    // Click Draft on #101 card -> posts { draft: true } and updates state
    const draftBtn101 = wrapper.find(
      '.action-queue button[aria-label="Draft — acme/core-api#101"]',
    );
    await draftBtn101.trigger('click');
    await flushPromises();
    expect(draftCalls[0]).toEqual({
      url: '/api/pull/acme/core-api/101/draft',
      body: JSON.stringify({ draft: true }),
    });
    expect(
      wrapper
        .find('.action-queue button[aria-label="Draft — acme/core-api#101"]')
        .attributes('aria-pressed'),
    ).toBe('true');

    // Click Ready on draft PR #404 -> posts { draft: false } and marks it ready
    const readyBtn404 = wrapper.find('.action-queue button[aria-label="Ready — acme/docs#404"]');
    expect(readyBtn404.attributes('aria-pressed')).toBe('false');
    await readyBtn404.trigger('click');
    await flushPromises();
    expect(draftCalls[1]).toEqual({
      url: '/api/pull/acme/docs/404/draft',
      body: JSON.stringify({ draft: false }),
    });
    expect(
      wrapper
        .find('.action-queue button[aria-label="Ready — acme/docs#404"]')
        .attributes('aria-pressed'),
    ).toBe('true');

    // Error on WaitingPanel PR #303 surfaces inline alert without changing state
    const waitingDraftBtn = wrapper.find(
      '.waiting-item button[aria-label="Draft — acme/worker#303"]',
    );
    await waitingDraftBtn.trigger('click');
    await flushPromises();
    expect(wrapper.find('.waiting-sync-error').text()).toContain('Insufficient permissions');
    expect(
      wrapper
        .find('.waiting-item button[aria-label="Ready — acme/worker#303"]')
        .attributes('aria-pressed'),
    ).toBe('true');

    wrapper.unmount();
  });

  it('supports GitHub-style Squash/Merge split button, confirmation dialog with bypass warning, and error handling', async () => {
    // Verify explicit merge FSM transitions
    const merging = transitionPrMergeState(IDLE_PR_MERGE_STATE, {
      type: 'MERGE_REQUEST',
      mergeMethod: 'squash',
    });
    expect(merging).toEqual({ status: 'merging', mergeMethod: 'squash' });
    const failed = transitionPrMergeState(merging, {
      type: 'MERGE_FAILED',
      mergeMethod: 'squash',
      error: 'Head branch was modified',
    });
    expect(failed).toEqual({
      status: 'error',
      mergeMethod: 'squash',
      error: 'Head branch was modified',
    });
    const retrying = transitionPrMergeState(failed, {
      type: 'MERGE_REQUEST',
      mergeMethod: 'merge',
    });
    expect(
      transitionPrMergeState(retrying, {
        type: 'MERGE_SUCCEEDED',
        mergeMethod: 'merge',
        sha: 'a'.repeat(40),
        message: 'Pull Request successfully merged',
      }),
    ).toEqual({
      status: 'merged',
      mergeMethod: 'merge',
      sha: 'a'.repeat(40),
      message: 'Pull Request successfully merged',
    });

    const headSha101 = 'a'.repeat(40);
    const headSha202 = 'b'.repeat(40);
    let merged101 = false;
    const mergeCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/pull/acme/core-api/101/merge') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        mergeCalls.push({ url, body });
        merged101 = true;
        return new Response(
          JSON.stringify({
            ok: true,
            merged: true,
            sha: '9'.repeat(40),
            message: 'Pull Request successfully merged',
            mergeMethod: body.mergeMethod ?? 'squash',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === '/api/pull/acme/web-app/202/merge') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        mergeCalls.push({ url, body });
        return new Response(JSON.stringify({ error: 'Protected branch hook declined' }), {
          status: 405,
          headers: { 'content-type': 'application/json' },
        });
      }

      const base = makeSnapshot();
      const prs = base.pullRequests
        .map((p) => {
          if (p.key === 'acme/core-api#101') {
            return { ...p, headRefOid: headSha101 };
          }
          if (p.key === 'acme/web-app#202') {
            return { ...p, headRefOid: headSha202 };
          }
          return p;
        })
        .filter((p) => !(merged101 && p.key === 'acme/core-api#101'));

      return new Response(JSON.stringify({ ...base, pullRequests: prs }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: merged101 ? '"m2"' : '"m1"' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountWithDeps(DashboardApp, { attachTo: document.body });
    await flushPromises();

    // Non-draft PRs (including failing CI #101) show Squash split button; drafts do not
    await wrapper.find('#include-drafts').setValue(true);
    expect(wrapper.findAll('.action-queue .merge-split')).toHaveLength(3);
    expect(wrapper.find('button[aria-label="Squash — acme/docs#404"]').exists()).toBe(false);

    // Click Squash on failing-CI PR #101 -> opens confirmation dialog with bypass notice
    await wrapper.find('button[aria-label="Squash — acme/core-api#101"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.find('.merge-confirm-dialog');
    expect(dialog.attributes('open')).toBeDefined();
    expect(dialog.text()).toContain('Bypass notice');
    expect(dialog.text()).toContain('CI checks are failing');
    expect(dialog.find('.merge-submit-btn').text()).toBe('Confirm squash and merge');

    // Confirm squash and merge -> sends POST with squash + expectedHeadSha and removes PR
    await dialog.find('.merge-submit-btn').trigger('click');
    await flushPromises();
    expect(mergeCalls[0]).toEqual({
      url: '/api/pull/acme/core-api/101/merge',
      body: { mergeMethod: 'squash', expectedHeadSha: headSha101 },
    });
    expect(wrapper.find('[data-pr-key="acme/core-api#101"]').exists()).toBe(false);

    // Switch #202 split button dropdown to "Create a merge commit" -> label updates to Merge
    await wrapper
      .find('button[aria-label="Select merge method for acme/web-app#202"]')
      .trigger('click');
    await flushPromises();
    const regularMergeItem = wrapper
      .findAll('[role="menuitemradio"]')
      .find((item) => item.text().includes('Create a merge commit'));
    expect(regularMergeItem).toBeTruthy();
    await regularMergeItem!.trigger('click');
    await flushPromises();

    const mergeBtn202 = wrapper.find('button[aria-label="Merge — acme/web-app#202"]');
    expect(mergeBtn202.text()).toContain('Merge');
    await mergeBtn202.trigger('click');
    await flushPromises();
    expect(dialog.find('.merge-submit-btn').text()).toBe('Confirm merge');

    // Confirming #202 hits mocked 405 error -> surfaces error inline inside dialog
    await dialog.find('.merge-submit-btn').trigger('click');
    await flushPromises();
    expect(mergeCalls[1]).toEqual({
      url: '/api/pull/acme/web-app/202/merge',
      body: { mergeMethod: 'merge', expectedHeadSha: headSha202 },
    });
    expect(dialog.find('.merge-dialog-error').text()).toContain('Protected branch hook declined');

    wrapper.unmount();
  });

  it('opens GitHub-style label picker on each PR card, filters repo labels, toggles labels via API, and renders colored pills', async () => {
    // Verify explicit PR labels FSM transitions
    const saving = transitionPrLabelsState(IDLE_PR_LABELS_STATE, {
      type: 'SAVE_REQUEST',
      pendingLabels: ['backend'],
    });
    expect(saving).toEqual({ status: 'saving', pendingLabels: ['backend'] });
    const failed = transitionPrLabelsState(saving, {
      type: 'SAVE_FAILED',
      error: 'Forbidden',
    });
    expect(failed).toEqual({ status: 'error', error: 'Forbidden' });
    const retrying = transitionPrLabelsState(failed, {
      type: 'SAVE_REQUEST',
      pendingLabels: ['backend'],
    });
    expect(transitionPrLabelsState(retrying, { type: 'SAVE_SUCCEEDED' })).toEqual(
      IDLE_PR_LABELS_STATE,
    );

    let labels101 = [{ name: 'bug', color: 'd73a4a', description: 'Something is broken' }];
    const repoLabels = [
      { name: 'backend', color: '0e8a16', description: 'Backend services' },
      { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
      { name: 'frontend', color: '1d76db', description: 'Frontend UI' },
    ];
    const postCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/repo/acme/core-api/labels') {
        return new Response(JSON.stringify({ repository: 'acme/core-api', labels: repoLabels }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/pull/acme/core-api/101/labels') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { labels: string[] };
        postCalls.push({ url, body });
        labels101 = repoLabels.filter((l) => body.labels.includes(l.name));
        return new Response(JSON.stringify({ ok: true, labels: labels101 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const base = makeSnapshot();
      const prs = base.pullRequests.map((p) => {
        if (p.key === 'acme/core-api#101') {
          return { ...p, labels: labels101 };
        }
        if (p.key === 'acme/worker#303') {
          return {
            ...p,
            labels: [{ name: 'deploy:staging', color: '5319e7', description: 'Staging deploy' }],
          };
        }
        return p;
      });
      return new Response(JSON.stringify({ ...base, pullRequests: prs }), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: `"lbl-${labels101.length}"` },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountWithDeps(DashboardApp, { attachTo: document.body });
    await flushPromises();

    // Existing labels render on both Action Queue card #101 and WaitingPanel row #303
    expect(wrapper.find('.action-queue .pr-labels-row .pr-label-pill').text()).toBe('bug');
    expect(wrapper.find('.waiting-item .waiting-labels .pr-label-pill').text()).toBe(
      'deploy:staging',
    );

    // Open label picker on #101 -> loads repo labels, shows Active labels strip, and lists all 3
    await wrapper.find('button[aria-label="Labels — acme/core-api#101"]').trigger('click');
    await flushPromises();
    const firstCard = wrapper.findAll('.action-queue .pr-card')[0]!;
    expect(firstCard.findAll('[role="menuitemcheckbox"]')).toHaveLength(3);
    expect(firstCard.findAll('.picker-active-pill').map((p) => p.text())).toEqual(['bug']);

    // Filter labels by typing "back" -> narrows menu to backend while keeping Active labels visible
    const filterInput = firstCard.find<HTMLInputElement>('.picker-search');
    await filterInput.setValue('back');
    const filteredItems = firstCard.findAll('[role="menuitemcheckbox"]');
    expect(filteredItems).toHaveLength(1);
    expect(filteredItems[0]!.text()).toContain('backend');
    expect(firstCard.findAll('.picker-active-pill').map((p) => p.text())).toEqual(['bug']);

    // Click backend -> posts ['bug', 'backend'] and updates both card pills and Active labels strip
    await filteredItems[0]!.trigger('click');
    await flushPromises();
    expect(postCalls[0]).toEqual({
      url: '/api/pull/acme/core-api/101/labels',
      body: { labels: ['bug', 'backend'] },
    });
    expect(firstCard.findAll('.pr-labels-row .pr-label-pill').map((p) => p.text())).toEqual([
      'backend',
      'bug',
    ]);
    expect(firstCard.findAll('.picker-active-pill').map((p) => p.text())).toEqual([
      'backend',
      'bug',
    ]);

    // Click Active label pill for "bug" -> removes it via POST
    await firstCard.find('button[aria-label="Remove label bug"]').trigger('click');
    await flushPromises();
    expect(postCalls[1]).toEqual({
      url: '/api/pull/acme/core-api/101/labels',
      body: { labels: ['backend'] },
    });
    expect(firstCard.findAll('.pr-labels-row .pr-label-pill').map((p) => p.text())).toEqual([
      'backend',
    ]);
    expect(firstCard.findAll('.picker-active-pill').map((p) => p.text())).toEqual(['backend']);

    // Searching by label name in main dashboard search matches #101
    await wrapper.find('#pr-search').setValue('backend');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);

    wrapper.unmount();
  });

  it('groups PR inspector checks into expandable suite sections with status counts and Expand/Collapse all', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/pull/acme/core-api/101') {
        return new Response(
          JSON.stringify({
            key: 'acme/core-api#101',
            bodyExcerpt: null,
            checksTotalCount: 6,
            checks: [
              {
                name: 'Vercel – preview',
                kind: 'StatusContext',
                status: 'SUCCESS',
                conclusion: 'SUCCESS',
                bucket: 'passing',
                url: 'https://vercel.test/preview',
                description: null,
                startedAt: null,
                completedAt: null,
              },
              {
                name: 'Vercel – staging',
                kind: 'StatusContext',
                status: 'SUCCESS',
                conclusion: 'SUCCESS',
                bucket: 'passing',
                url: 'https://vercel.test/staging',
                description: null,
                startedAt: null,
                completedAt: null,
              },
              {
                name: 'coverage (2)',
                kind: 'CheckRun',
                status: 'COMPLETED',
                conclusion: 'FAILURE',
                bucket: 'failing',
                url: 'https://ci.test/cov-2',
                description: null,
                startedAt: null,
                completedAt: null,
              },
              {
                name: 'coverage (1)',
                kind: 'CheckRun',
                status: 'IN_PROGRESS',
                conclusion: null,
                bucket: 'pending',
                url: 'https://ci.test/cov-1',
                description: null,
                startedAt: null,
                completedAt: null,
              },
              {
                name: 'owned-elements',
                kind: 'CheckRun',
                status: 'IN_PROGRESS',
                conclusion: null,
                bucket: 'pending',
                url: 'https://ci.test/owned',
                description: null,
                startedAt: null,
                completedAt: null,
              },
              {
                name: 'cancel-previous',
                kind: 'CheckRun',
                status: 'COMPLETED',
                conclusion: 'SUCCESS',
                bucket: 'passing',
                url: 'https://ci.test/cancel',
                description: null,
                startedAt: null,
                completedAt: null,
              },
            ],
            reviewers: [],
            timeline: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(makeSnapshot()), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"chk-1"' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mountWithDeps(DashboardApp, { attachTo: document.body });
    await flushPromises();

    // Open inspector for #101
    await wrapper.find('[data-pr-key="acme/core-api#101"]').trigger('click');
    await flushPromises();

    const groups = wrapper.findAll('.check-group');
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.find('.check-group-label').text())).toEqual([
      'coverage',
      'Other',
      'Vercel',
    ]);

    // coverage (failing) and Other (pending) are expanded; Vercel (all passing) is collapsed
    expect(groups[0]!.attributes('open')).toBeDefined();
    expect(groups[1]!.attributes('open')).toBeDefined();
    expect(groups[2]!.attributes('open')).toBeUndefined();

    // Status counts render on summaries
    expect(groups[0]!.find('.check-group-counts').text()).toContain('1 fail');
    expect(groups[0]!.find('.check-group-counts').text()).toContain('1 pend');
    expect(groups[2]!.find('.check-group-counts').text()).toContain('2 pass');

    // Expand all opens every group, then Collapse all closes every group
    const toggleAllBtn = wrapper.find('.checks-toggle-all-btn');
    expect(toggleAllBtn.text()).toBe('Expand all');
    expect(toggleAllBtn.attributes('aria-expanded')).toBe('false');

    await toggleAllBtn.trigger('click');
    expect(toggleAllBtn.text()).toBe('Collapse all');
    expect(toggleAllBtn.attributes('aria-expanded')).toBe('true');
    for (const g of wrapper.findAll('.check-group')) {
      expect(g.attributes('open')).toBeDefined();
    }

    await toggleAllBtn.trigger('click');
    expect(toggleAllBtn.text()).toBe('Expand all');
    expect(toggleAllBtn.attributes('aria-expanded')).toBe('false');
    for (const g of wrapper.findAll('.check-group')) {
      expect(g.attributes('open')).toBeUndefined();
    }

    wrapper.unmount();
  });
});
