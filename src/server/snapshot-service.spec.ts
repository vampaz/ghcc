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
} from '@/server/derive/__fixtures__/pull-requests';
import { GitHubAuthError, GitHubRateLimitError, type GitHubClient } from '@/server/github-client';
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

  it('coalesces concurrent requests (single-flight) and caches within 90s TTL', async () => {
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

    // Within 90s TTL -> serves cached snapshot
    nowMs += 30_000;
    await service.getSnapshot();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);

    // Past 90s TTL -> refreshes both
    nowMs += 65_000;
    await service.getSnapshot();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(2);
    expect(fetchReviewQueue).toHaveBeenCalledTimes(2);
  });

  it('enforces 10s manual refresh cooldown and keeps 90s review-queue TTL floor', async () => {
    let nowMs = FIXTURE_NOW_MS;
    const stateStore = await makeStateStore();
    const fetchAuthoredPulls = vi.fn<GitHubClient['fetchAuthoredPulls']>().mockResolvedValue({
      login: VIEWER_LOGIN,
      pullRequests: [fixtureAutoMerge],
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

    await service.forceRefresh();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);
    expect(fetchReviewQueue).toHaveBeenCalledTimes(1);

    // Within 10s -> throws cooldown error
    nowMs += 5_000;
    await expect(service.forceRefresh()).rejects.toBeInstanceOf(RefreshCooldownError);

    // At 15s -> authored refreshes, review queue stays cached by 90s floor!
    nowMs += 10_000;
    await service.forceRefresh();
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(2);
    expect(fetchReviewQueue).toHaveBeenCalledTimes(1);
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

  it('caches repo PRs per repository for 5m, preserves cached repo PRs on transient failure, and supports targeted invalidation', async () => {
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

    // At 2 minutes (past 90s snapshot TTL, within 5m repo TTL) -> reuses cached repo PRs
    nowMs += 120_000;
    await service.getSnapshot();
    expect(fetchRepoPulls).toHaveBeenCalledTimes(2);

    // Targeted invalidation of acme/docs only refetches acme/docs, NOT acme/frontend
    service.invalidateCache('acme/docs');
    failDocsRepo = true;
    const degraded = await service.getSnapshot();
    expect(fetchRepoPulls).toHaveBeenCalledTimes(3);
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

    // New service instance (simulating server restart) within 90s serves persisted snapshot without hitting GitHub
    nowMs += 20_000;
    const service2 = createSnapshotService({
      tokenStore: makeTokenStore(),
      githubClient: client,
      stateStore,
      now: () => nowMs,
    });
    const warmed = await service2.getSnapshot();
    expect(warmed.snapshot.pullRequests).toHaveLength(1);
    expect(fetchAuthoredPulls).toHaveBeenCalledTimes(1);
  });
});
