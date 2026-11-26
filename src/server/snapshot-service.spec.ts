import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenStore } from '@/server/auth';
import {
  FIXTURE_NOW_MS,
  VIEWER_LOGIN,
  fixtureAutoMerge,
  fixtureDirectReviewRequest,
  fixtureNoCiRollup,
  makeBaseRawPr,
} from '@/server/derive/__fixtures__/pull-requests';
import {
  GitHubAuthError,
  GitHubRateLimitError,
  createGitHubClient,
  type GitHubClient,
} from '@/server/github-client';
import {
  RefreshCooldownError,
  createSnapshotService,
  transitionLifecycleState,
} from '@/server/snapshot-service';
import { StateStore } from '@/server/state-store';

describe('snapshot-service & state machine', () => {
  const dirs: string[] = [];

  async function makeStateStore(): Promise<StateStore> {
    const dir = await mkdtemp(join(tmpdir(), 'ghcc-snap-'));
    dirs.push(dir);
    return new StateStore(join(dir, 'state.json'));
  }

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  function makeTokenStore(): TokenStore {
    return {
      getToken: vi.fn<TokenStore['getToken']>().mockResolvedValue('gho_fakeToken1234567890'),
      reloadToken: vi
        .fn<TokenStore['reloadToken']>()
        .mockResolvedValue('gho_reloadedToken1234567890'),
      getLogin: vi.fn<TokenStore['getLogin']>().mockResolvedValue(VIEWER_LOGIN),
      getTokenSource: vi.fn<TokenStore['getTokenSource']>().mockReturnValue('gh-cli'),
      peekToken: vi.fn<TokenStore['peekToken']>().mockReturnValue('gho_fakeToken1234567890'),
    };
  }

  it('follows explicit lifecycle transitions cleanly', () => {
    expect(transitionLifecycleState('idle', 'REQUEST', false)).toBe('loading');
    expect(transitionLifecycleState('loading', 'FETCH_OK', true)).toBe('ready');
    expect(transitionLifecycleState('loading', 'FETCH_PARTIAL', true)).toBe('degraded');
    expect(transitionLifecycleState('loading', 'FETCH_AUTH_ERROR', false)).toBe('auth-error');
    expect(transitionLifecycleState('loading', 'FETCH_RATE_LIMITED', false)).toBe('fatal');
    expect(transitionLifecycleState('ready', 'REQUEST', true)).toBe('refreshing');
    expect(transitionLifecycleState('refreshing', 'FETCH_RATE_LIMITED', true)).toBe('rate-limited');
    expect(transitionLifecycleState('rate-limited', 'RESET_REACHED', true)).toBe('refreshing');
    expect(transitionLifecycleState('auth-error', 'MANUAL_RETRY', false)).toBe('loading');
  });

  it('coalesces concurrent requests (single-flight) and caches within 55s TTL so 60s polls refresh', async () => {
    let nowMs = FIXTURE_NOW_MS;
    const stateStore = await makeStateStore();
    const fetchAuthoredPulls = vi.fn<GitHubClient['fetchAuthoredPulls']>().mockResolvedValue({
      login: VIEWER_LOGIN,
      pullRequests: [fixtureNoCiRollup],
      rateLimit: { remaining: 4990, limit: 5000, resetAt: '2026-11-24T13:00:00.000Z' },
      warnings: [],
      cost: 1,
    });
    const fetchReviewQueue = vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
      pullRequests: [fixtureDirectReviewRequest],
      rateLimit: { remaining: 4989, limit: 5000, resetAt: '2026-11-24T13:00:00.000Z' },
      warnings: [],
      cost: 1,
    });
    const client: GitHubClient = {
      fetchAuthoredPulls,
      fetchReviewQueue,
      probeMergeability: vi.fn<GitHubClient['probeMergeability']>(),
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      fetchRepoPulls: vi.fn<GitHubClient['fetchRepoPulls']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 0,
      }),
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
    };

    const service = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });

    const [a, b] = await Promise.all([service.getSnapshot(), service.getSnapshot()]);
    expect(a.etag).toBe(b.etag);
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);
    expect(fetchReviewQueue).toHaveBeenCalledTimes(1);

    // Within 55s TTL -> serves cached snapshot
    nowMs += 30_000;
    await service.getSnapshot();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);

    // At 60s (past 55s TTL) -> refreshes both
    nowMs += 30_000;
    await service.getSnapshot();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(2);
    expect(fetchReviewQueue).toHaveBeenCalledTimes(2);
  });

  it('enforces 10s manual refresh cooldown and bypasses review-queue, repo, detail, and mergeability caches', async () => {
    let nowMs = FIXTURE_NOW_MS;
    const stateStore = await makeStateStore();
    const unknownMergePr = makeBaseRawPr({
      id: 'PR_manual_probe',
      number: 801,
      headRefOid: 'sha-manual-probe',
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'UNKNOWN',
    });
    await stateStore.setMergeability('acme/web-app#801', {
      headRefOid: 'sha-manual-probe',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checkedAt: new Date(nowMs - 30_000).toISOString(),
    });

    const fetchAuthoredPulls = vi.fn<GitHubClient['fetchAuthoredPulls']>().mockResolvedValue({
      login: VIEWER_LOGIN,
      pullRequests: [fixtureAutoMerge, unknownMergePr],
      rateLimit: null,
      warnings: [],
      cost: 1,
    });
    const fetchReviewQueue = vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
      pullRequests: [fixtureDirectReviewRequest],
      rateLimit: null,
      warnings: [],
      cost: 1,
    });
    const fetchRepoPulls = vi.fn<GitHubClient['fetchRepoPulls']>().mockResolvedValue({
      pullRequests: [],
      rateLimit: null,
      warnings: [],
      cost: 1,
    });
    const probeMergeability = vi.fn<GitHubClient['probeMergeability']>().mockResolvedValue({
      status: 'ok',
      mergeable: false,
      mergeableState: 'dirty',
      coreRateLimit: null,
    });
    const invalidatePullDetailCache =
      vi.fn<NonNullable<GitHubClient['invalidatePullDetailCache']>>();
    const client: GitHubClient = {
      fetchAuthoredPulls,
      fetchReviewQueue,
      probeMergeability,
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      fetchRepoPulls,
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
      invalidatePullDetailCache,
    };

    const service = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });

    const first = await service.forceRefresh();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);
    expect(fetchReviewQueue).toHaveBeenCalledTimes(1);
    expect(fetchRepoPulls).toHaveBeenCalledTimes(2);
    expect(probeMergeability).toHaveBeenCalledTimes(1);
    expect(invalidatePullDetailCache).toHaveBeenCalledTimes(1);
    expect(first.snapshot.pullRequests.find((p) => p.number === 801)?.merge.state).toBe(
      'conflicting',
    );

    // Within 10s -> throws cooldown error
    nowMs += 5_000;
    await expect(service.forceRefresh()).rejects.toBeInstanceOf(RefreshCooldownError);

    // At 15s -> manual refresh bypasses review-queue, repo, and detail caches
    nowMs += 10_000;
    await service.forceRefresh();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(2);
    expect(fetchReviewQueue).toHaveBeenCalledTimes(2);
    expect(fetchRepoPulls).toHaveBeenCalledTimes(4);
    expect(probeMergeability).toHaveBeenCalledTimes(2);
    expect(invalidatePullDetailCache).toHaveBeenCalledTimes(2);
  });

  it('enters rate-limited retaining cached PRs on 403 and recovers after resetAt + 5s', async () => {
    let nowMs = FIXTURE_NOW_MS;
    const stateStore = await makeStateStore();
    const resetAt = new Date(nowMs + 120_000).toISOString();
    const fetchAuthoredPulls = vi
      .fn<GitHubClient['fetchAuthoredPulls']>()
      .mockResolvedValueOnce({
        login: VIEWER_LOGIN,
        pullRequests: [fixtureNoCiRollup],
        rateLimit: { remaining: 100, limit: 5000, resetAt },
        warnings: [],
        cost: 1,
      })
      .mockRejectedValueOnce(new GitHubRateLimitError('Rate limited', resetAt))
      .mockResolvedValueOnce({
        login: VIEWER_LOGIN,
        pullRequests: [fixtureNoCiRollup],
        rateLimit: {
          remaining: 5000,
          limit: 5000,
          resetAt: new Date(nowMs + 3600_000).toISOString(),
        },
        warnings: [],
        cost: 1,
      });

    const client: GitHubClient = {
      fetchAuthoredPulls,
      fetchReviewQueue: vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      probeMergeability: vi.fn<GitHubClient['probeMergeability']>(),
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      fetchRepoPulls: vi.fn<GitHubClient['fetchRepoPulls']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 0,
      }),
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
    };

    const service = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });

    const initial = await service.getSnapshot();
    expect(initial.snapshot.state).toBe('ready');
    expect(initial.snapshot.pullRequests).toHaveLength(1);

    nowMs += 95_000;
    const limited = await service.getSnapshot();
    expect(limited.snapshot.state).toBe('rate-limited');
    expect(limited.snapshot.pullRequests).toHaveLength(1);
    expect(limited.snapshot.warnings[0]?.code).toBe('rate-limited');
    expect(service.getStates()).toEqual({ lifecycle: 'rate-limited', scheduler: 'backing-off' });

    // Before resetAt + 5s -> still serves cached rate-limited response without hitting GitHub
    await service.getSnapshot();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(2);

    // Past resetAt + 5s -> recovers to ready
    nowMs = Date.parse(resetAt) + 6_000;
    const recovered = await service.getSnapshot();
    expect(recovered.snapshot.state).toBe('ready');
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(3);
  });

  it('enters auth-error on 401 and reloads token on manual retry', async () => {
    const tokenStore = makeTokenStore();
    const stateStore = await makeStateStore();
    const fetchAuthoredPulls = vi
      .fn<GitHubClient['fetchAuthoredPulls']>()
      .mockRejectedValueOnce(new GitHubAuthError('Bad credentials'))
      .mockResolvedValueOnce({
        login: VIEWER_LOGIN,
        pullRequests: [fixtureNoCiRollup],
        rateLimit: null,
        warnings: [],
        cost: 1,
      });

    const client: GitHubClient = {
      fetchAuthoredPulls,
      fetchReviewQueue: vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      probeMergeability: vi.fn<GitHubClient['probeMergeability']>(),
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      fetchRepoPulls: vi.fn<GitHubClient['fetchRepoPulls']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 0,
      }),
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
    };

    const service = createSnapshotService({
      tokenStore,
      githubClient: client,
      stateStore,
      now: () => FIXTURE_NOW_MS,
    });

    const errRes = await service.getSnapshot();
    expect(errRes.snapshot.state).toBe('auth-error');

    const retried = await service.forceRefresh();
    expect(tokenStore.reloadToken).toHaveBeenCalledTimes(1);
    expect(retried.snapshot.state).toBe('ready');
  });

  it('fetches open PRs across active repositories and deduplicates with authored/review PRs', async () => {
    const stateStore = await makeStateStore();
    const teammatePr = {
      ...fixtureNoCiRollup,
      id: 'PR_teammate_5579',
      number: 5579,
      title: 'feat: unify status colours across numbers [FE-446]',
      author: { login: 'sh1ndz' },
    };

    const fetchRepoPulls = vi.fn<GitHubClient['fetchRepoPulls']>().mockResolvedValue({
      pullRequests: [fixtureNoCiRollup, teammatePr],
      rateLimit: null,
      warnings: [],
      cost: 1,
    });

    const client: GitHubClient = {
      fetchAuthoredPulls: vi.fn<GitHubClient['fetchAuthoredPulls']>().mockResolvedValue({
        login: VIEWER_LOGIN,
        pullRequests: [fixtureNoCiRollup],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      fetchReviewQueue: vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      fetchRepoPulls,
      probeMergeability: vi.fn<GitHubClient['probeMergeability']>(),
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
    };

    const service = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => FIXTURE_NOW_MS,
    });

    const result = await service.getSnapshot();
    expect(fetchRepoPulls).toHaveBeenCalledWith('acme', 'docs');
    expect(result.snapshot.pullRequests).toHaveLength(2);

    const authored = result.snapshot.pullRequests.find((p) => p.number === 202);
    const team = result.snapshot.pullRequests.find((p) => p.number === 5579);
    expect(authored?.sources).toEqual(['authored', 'repo']);
    expect(team?.sources).toEqual(['repo']);
    expect(team?.author).toBe('sh1ndz');
    expect(team?.bucket).toBe('waiting');
  });

  it('caches repo PRs per repository for 2m, preserves cached repo PRs on transient failure, and supports targeted invalidation', async () => {
    let nowMs = FIXTURE_NOW_MS;
    const stateStore = await makeStateStore();
    const otherRepoPr = {
      ...fixtureDirectReviewRequest,
      id: 'PR_other_repo_77',
      number: 77,
      repository: {
        nameWithOwner: 'acme/frontend',
        isArchived: false,
        isDisabled: false,
        isLocked: false,
      },
    };
    const teammateDocsPr = {
      ...fixtureNoCiRollup,
      id: 'PR_docs_team_901',
      number: 901,
      author: { login: 'teammate' },
    };
    const teammateFrontendPr = {
      ...otherRepoPr,
      id: 'PR_fe_team_902',
      number: 902,
      author: { login: 'teammate' },
    };

    let failDocsRepo = false;
    const fetchRepoPulls = vi
      .fn<GitHubClient['fetchRepoPulls']>()
      .mockImplementation(async (_owner, repo) => {
        if (repo === 'docs') {
          if (failDocsRepo) {
            throw new Error('Something went wrong while executing your query');
          }
          return {
            pullRequests: [fixtureNoCiRollup, teammateDocsPr],
            rateLimit: null,
            warnings: [],
            cost: 1,
          };
        }
        return {
          pullRequests: [otherRepoPr, teammateFrontendPr],
          rateLimit: null,
          warnings: [],
          cost: 1,
        };
      });

    const client: GitHubClient = {
      fetchAuthoredPulls: vi.fn<GitHubClient['fetchAuthoredPulls']>().mockResolvedValue({
        login: VIEWER_LOGIN,
        pullRequests: [fixtureNoCiRollup],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      fetchReviewQueue: vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
        pullRequests: [otherRepoPr],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      fetchRepoPulls,
      probeMergeability: vi.fn<GitHubClient['probeMergeability']>(),
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
    };

    const service = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });

    // Initial fetch loads both repos
    const first = await service.getSnapshot();
    expect(first.snapshot.pullRequests).toHaveLength(4);
    expect(fetchRepoPulls).toHaveBeenCalledTimes(2);

    // At 60s (past 55s snapshot TTL, within 2m repo TTL) -> reuses cached repo PRs
    nowMs += 60_000;
    await service.getSnapshot();
    expect(fetchRepoPulls).toHaveBeenCalledTimes(2);

    // At 130s (past 2m repo TTL) -> refreshes both repos
    nowMs += 70_000;
    await service.getSnapshot();
    expect(fetchRepoPulls).toHaveBeenCalledTimes(4);

    // Targeted invalidation of acme/docs only refetches acme/docs, NOT acme/frontend
    service.invalidateCache('acme/docs');
    failDocsRepo = true;
    const degraded = await service.getSnapshot();
    expect(fetchRepoPulls).toHaveBeenCalledTimes(5);
    expect(fetchRepoPulls).toHaveBeenLastCalledWith('acme', 'docs');
    expect(degraded.snapshot.state).toBe('degraded');
    // Cached PRs from acme/docs are preserved instead of vanishing
    expect(degraded.snapshot.pullRequests.some((p) => p.number === 901)).toBe(true);
    expect(degraded.snapshot.pullRequests.some((p) => p.number === 902)).toBe(true);
    expect(degraded.snapshot.warnings[0]?.message).toContain('showing cached PRs');
  });

  it('warm-starts from persisted StateStore snapshot after restart', async () => {
    let nowMs = FIXTURE_NOW_MS;
    const stateStore = await makeStateStore();
    const fetchAuthoredPulls = vi.fn<GitHubClient['fetchAuthoredPulls']>().mockResolvedValue({
      login: VIEWER_LOGIN,
      pullRequests: [fixtureNoCiRollup],
      rateLimit: null,
      warnings: [],
      cost: 1,
    });
    const client: GitHubClient = {
      fetchAuthoredPulls,
      fetchReviewQueue: vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      fetchRepoPulls: vi.fn<GitHubClient['fetchRepoPulls']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 0,
      }),
      probeMergeability: vi.fn<GitHubClient['probeMergeability']>(),
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
    };

    const service1 = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });
    await service1.getSnapshot();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);

    // Wait a tick for best-effort disk persistence to flush
    await stateStore.getLastSnapshot();

    // New service instance (simulating server restart) within 55s serves persisted snapshot without hitting GitHub
    nowMs += 20_000;
    const service2 = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });
    const warmed = await service2.getSnapshot();
    expect(warmed.snapshot.pullRequests).toHaveLength(1);
    expect(warmed.isRefreshing).toBe(false);
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);

    // Restart after persisted snapshot is stale (> 55s): returns disk cache with isRefreshing=true,
    // and waitForInFlight=true joins the background refresh and returns fresh data.
    let resolveBackgroundFetch!: (
      value: Awaited<ReturnType<GitHubClient['fetchAuthoredPulls']>>,
    ) => void;
    fetchAuthoredPulls.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBackgroundFetch = resolve;
        }),
    );
    nowMs += 120_000;
    const service3 = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });
    const staleWarm = await service3.getSnapshot();
    expect(staleWarm.snapshot.pullRequests).toHaveLength(1);
    expect(staleWarm.isRefreshing).toBe(true);
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(2);

    const waitedPromise = service3.getSnapshot({ waitForInFlight: true });
    resolveBackgroundFetch({
      login: VIEWER_LOGIN,
      pullRequests: [fixtureNoCiRollup, fixtureAutoMerge],
      rateLimit: null,
      warnings: [],
      cost: 1,
    });
    const fresh = await waitedPromise;
    expect(fresh.snapshot.pullRequests).toHaveLength(2);
    expect(fresh.isRefreshing).toBeFalsy();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(2);
  });

  it('stamps fetchedAt and cache TTL at fetch completion time so slow refreshes show as fresh', async () => {
    let nowMs = FIXTURE_NOW_MS;
    const stateStore = await makeStateStore();
    const fetchAuthoredPulls = vi
      .fn<GitHubClient['fetchAuthoredPulls']>()
      .mockImplementation(async () => {
        nowMs += 25_000;
        return {
          login: VIEWER_LOGIN,
          pullRequests: [fixtureNoCiRollup],
          rateLimit: null,
          warnings: [],
          cost: 1,
        };
      });
    const client: GitHubClient = {
      fetchAuthoredPulls,
      fetchReviewQueue: vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      fetchRepoPulls: vi.fn<GitHubClient['fetchRepoPulls']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 0,
      }),
      probeMergeability: vi.fn<GitHubClient['probeMergeability']>(),
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
    };

    const service = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });

    const result = await service.getSnapshot();
    expect(result.snapshot.fetchedAt).toBe(new Date(FIXTURE_NOW_MS + 25_000).toISOString());

    // 40s after completion is still within 55s TTL (would have been 65s from startMs!)
    nowMs += 40_000;
    await service.getSnapshot();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);
  });

  it('compares uncached non-conflicting draft branches once per (baseRefOid, headRefOid) pair and reuses cache', async () => {
    const stateStore = await makeStateStore();
    let nowMs = FIXTURE_NOW_MS;
    const baseShaV1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const baseShaV2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const headBehind = '1111111111111111111111111111111111111111';
    const headUpToDate = '2222222222222222222222222222222222222222';
    const headConflict = '3333333333333333333333333333333333333333';
    const headAlreadyBehind = '4444444444444444444444444444444444444444';

    let currentBaseSha = baseShaV1;
    const makeDrafts = () => [
      makeBaseRawPr({
        id: 'PR_d1',
        number: 701,
        isDraft: true,
        baseRefName: 'master',
        baseRefOid: currentBaseSha,
        headRefOid: headBehind,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
      }),
      makeBaseRawPr({
        id: 'PR_d2',
        number: 702,
        isDraft: true,
        baseRefName: 'master',
        baseRefOid: currentBaseSha,
        headRefOid: headUpToDate,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
      }),
      makeBaseRawPr({
        id: 'PR_d3',
        number: 703,
        isDraft: true,
        baseRefName: 'master',
        baseRefOid: currentBaseSha,
        headRefOid: headConflict,
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
      }),
      makeBaseRawPr({
        id: 'PR_d4',
        number: 704,
        isDraft: true,
        baseRefName: 'master',
        baseRefOid: currentBaseSha,
        headRefOid: headAlreadyBehind,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BEHIND',
      }),
    ];

    const compareDraftBranches = vi
      .fn<NonNullable<GitHubClient['compareDraftBranches']>>()
      .mockResolvedValueOnce({
        behindByByKey: {
          'acme/web-app#701': 12,
          'acme/web-app#702': 0,
        },
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        behindByByKey: {
          'acme/web-app#701': 15,
          'acme/web-app#702': 3,
        },
        rateLimit: null,
      });

    const client: GitHubClient = {
      fetchAuthoredPulls: vi
        .fn<GitHubClient['fetchAuthoredPulls']>()
        .mockImplementation(async () => ({
          login: VIEWER_LOGIN,
          pullRequests: makeDrafts(),
          rateLimit: null,
          warnings: [],
          cost: 1,
        })),
      fetchReviewQueue: vi.fn<GitHubClient['fetchReviewQueue']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 1,
      }),
      fetchRepoPulls: vi.fn<GitHubClient['fetchRepoPulls']>().mockResolvedValue({
        pullRequests: [],
        rateLimit: null,
        warnings: [],
        cost: 0,
      }),
      probeMergeability: vi.fn<GitHubClient['probeMergeability']>(),
      compareDraftBranches,
      fetchPullDetail: vi.fn<GitHubClient['fetchPullDetail']>(),
      updatePullBranch: vi.fn<GitHubClient['updatePullBranch']>(),
      setPullDraftState: vi.fn<GitHubClient['setPullDraftState']>(),
      mergePullRequest: vi.fn<GitHubClient['mergePullRequest']>(),
      fetchRepoLabels: vi.fn<GitHubClient['fetchRepoLabels']>(),
      setPullLabels: vi.fn<GitHubClient['setPullLabels']>(),
    };

    const service = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });

    const first = await service.getSnapshot();
    expect(compareDraftBranches).toHaveBeenCalledTimes(1);
    expect(compareDraftBranches.mock.calls[0]![0].map((item) => item.key)).toEqual([
      'acme/web-app#701',
      'acme/web-app#702',
    ]);
    const byKey1 = new Map(first.snapshot.pullRequests.map((pr) => [pr.key, pr]));
    expect(byKey1.get('acme/web-app#701')!.merge.state).toBe('behind');
    expect(byKey1.get('acme/web-app#702')!.merge.state).toBe('draft');
    expect(byKey1.get('acme/web-app#703')!.merge.state).toBe('draft');
    expect(byKey1.get('acme/web-app#704')!.merge.state).toBe('behind');

    // Second refresh with same baseRefOid + headRefOid reuses cache with 0 compare calls.
    nowMs += 120_000;
    const second = await service.getSnapshot();
    expect(compareDraftBranches).toHaveBeenCalledTimes(1);
    const byKey2 = new Map(second.snapshot.pullRequests.map((pr) => [pr.key, pr]));
    expect(byKey2.get('acme/web-app#701')!.merge.state).toBe('behind');
    expect(byKey2.get('acme/web-app#702')!.merge.state).toBe('draft');

    // Base branch advances -> cache invalidates and #702 is now detected as behind.
    currentBaseSha = baseShaV2;
    nowMs += 120_000;
    const third = await service.getSnapshot();
    expect(compareDraftBranches).toHaveBeenCalledTimes(2);
    const byKey3 = new Map(third.snapshot.pullRequests.map((pr) => [pr.key, pr]));
    expect(byKey3.get('acme/web-app#702')!.merge.state).toBe('behind');
  });

  it('batches draft branch comparisons in createGitHubClient using parameterized GraphQL variables', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            rateLimit: { remaining: 4990, limit: 5000, resetAt: '2026-11-24T13:00:00Z' },
            repository: {
              ref: {
                c0: { behindBy: 21 },
                c1: { behindBy: 0 },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const gh = createGitHubClient({
      tokenStore: makeTokenStore(),
      fetchFn: fetchMock,
    });

    const result = await gh.compareDraftBranches!([
      {
        key: 'acme/app#1',
        owner: 'acme',
        repo: 'app',
        baseRefName: 'master',
        baseRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headRefOid: '1111111111111111111111111111111111111111',
      },
      {
        key: 'acme/app#2',
        owner: 'acme',
        repo: 'app',
        baseRefName: 'master',
        baseRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headRefOid: '2222222222222222222222222222222222222222',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
      query: string;
      variables: Record<string, string>;
    };
    expect(body.variables).toEqual({
      owner: 'acme',
      repo: 'app',
      baseRef: 'refs/heads/master',
      h0: '1111111111111111111111111111111111111111',
      h1: '2222222222222222222222222222222222222222',
    });
    expect(result.behindByByKey).toEqual({
      'acme/app#1': 21,
      'acme/app#2': 0,
    });
    expect(result.rateLimit?.remaining).toBe(4990);
  });
});
