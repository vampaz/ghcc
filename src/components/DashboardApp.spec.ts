import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardApp from '@/components/DashboardApp.vue';
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

    // Drafts collapsed by default
    expect(wrapper.find('#drafts-list').exists()).toBe(false);
    // Primary action queue shows needs-me + ready (2 cards)
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);
    expect(wrapper.text()).toContain('vampaz');
    expect(wrapper.text()).toContain('GQL 4950/5000');

    // Click READY KPI tile -> filters action queue to ready PR and syncs URL
    const kpiTiles = wrapper.findAll('.kpi-tile');
    await kpiTiles[1]!.trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(1);
    expect(wrapper.find('.action-queue').text()).toContain('acme/web-app#202');
    expect(window.location.search).toContain('bucket=ready');

    // Clear bucket filter via chip, then filter by repository
    await wrapper.find('.bucket-chip').trigger('click');
    expect(wrapper.findAll('.action-queue .pr-card')).toHaveLength(2);

    const repoRows = wrapper.findAll('.repo-row');
    await repoRows[0]!.trigger('click');
    expect(window.location.search).toContain('repo=');

    // Expand drafts toggle
    await wrapper.find('.drafts-toggle').trigger('click');
    expect(wrapper.find('#drafts-list').exists()).toBe(true);
    expect(window.location.search).toContain('drafts=1');

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
});
