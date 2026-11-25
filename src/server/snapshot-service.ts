import { createHash } from 'node:crypto';
import type { TokenStore } from '@/server/auth';
import {
  computeCounts,
  isActivePullRequest,
  mergeRawPullRequests,
  normalizePullRequests,
} from '@/server/derive/normalize';
import type { RawPullRequest } from '@/server/derive/types';
import { GitHubAuthError, GitHubRateLimitError, type GitHubClient } from '@/server/github-client';
import { sanitizeErrorMessage } from '@/server/redact';
import type { StateStore } from '@/server/state-store';
import type {
  RateLimitBucket,
  SchedulerState,
  ServerLifecycleState,
  SnapshotResponse,
  SnapshotWarning,
} from '@/types/pr';

export const SNAPSHOT_TTL_MS = 90_000;
export const REVIEW_QUEUE_TTL_MS = 90_000;
export const REPO_PULLS_TTL_MS = 90_000;
export const MANUAL_REFRESH_COOLDOWN_MS = 10_000;
export const RATE_LIMIT_BACKOFF_BUFFER_MS = 5_000;

export type LifecycleEvent =
  | 'REQUEST'
  | 'FORCE_REFRESH'
  | 'MANUAL_RETRY'
  | 'FETCH_OK'
  | 'FETCH_PARTIAL'
  | 'FETCH_AUTH_ERROR'
  | 'FETCH_RATE_LIMITED'
  | 'FETCH_ERROR'
  | 'RESET_REACHED';

export function transitionLifecycleState(
  current: ServerLifecycleState,
  event: LifecycleEvent,
  hasCachedData: boolean,
): ServerLifecycleState {
  switch (current) {
    case 'idle':
      if (event === 'REQUEST' || event === 'FORCE_REFRESH') {
        return 'loading';
      }
      return current;
    case 'loading':
      if (event === 'FETCH_OK') {
        return 'ready';
      }
      if (event === 'FETCH_PARTIAL') {
        return 'degraded';
      }
      if (event === 'FETCH_AUTH_ERROR') {
        return 'auth-error';
      }
      if (event === 'FETCH_RATE_LIMITED' || event === 'FETCH_ERROR') {
        return hasCachedData ? 'degraded' : 'fatal';
      }
      return current;
    case 'ready':
    case 'degraded':
      if (event === 'REQUEST' || event === 'FORCE_REFRESH') {
        return 'refreshing';
      }
      return current;
    case 'refreshing':
      if (event === 'FETCH_OK') {
        return 'ready';
      }
      if (event === 'FETCH_PARTIAL') {
        return 'degraded';
      }
      if (event === 'FETCH_AUTH_ERROR') {
        return 'auth-error';
      }
      if (event === 'FETCH_RATE_LIMITED') {
        return hasCachedData ? 'rate-limited' : 'fatal';
      }
      if (event === 'FETCH_ERROR') {
        return hasCachedData ? 'degraded' : 'fatal';
      }
      return current;
    case 'rate-limited':
      if (event === 'RESET_REACHED' || event === 'FORCE_REFRESH') {
        return 'refreshing';
      }
      return current;
    case 'auth-error':
    case 'fatal':
      if (event === 'MANUAL_RETRY' || event === 'FORCE_REFRESH') {
        return 'loading';
      }
      return current;
  }
}

export interface SnapshotResult {
  snapshot: SnapshotResponse;
  etag: string;
}

export class RefreshCooldownError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Manual refresh is rate-limited. Retry in ${retryAfterSeconds}s.`);
    this.name = 'RefreshCooldownError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface SnapshotServiceDeps {
  tokenStore: TokenStore;
  githubClient: GitHubClient;
  stateStore: StateStore;
  now?: () => number;
}

export interface SnapshotService {
  getSnapshot(): Promise<SnapshotResult>;
  forceRefresh(): Promise<SnapshotResult>;
  invalidateCache(): void;
  getStates(): { lifecycle: ServerLifecycleState; scheduler: SchedulerState };
}

function computeSnapshotEtag(snapshot: SnapshotResponse): string {
  const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 24);
  return `"${hash}"`;
}

function dedupeWarnings(warnings: SnapshotWarning[]): SnapshotWarning[] {
  const seen = new Set<string>();
  const out: SnapshotWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(warning);
    }
  }
  return out;
}

export function createSnapshotService(deps: SnapshotServiceDeps): SnapshotService {
  const now = deps.now ?? (() => Date.now());

  let lifecycle: ServerLifecycleState = 'idle';
  let scheduler: SchedulerState = 'idle';
  let cachedResult: SnapshotResult | null = null;
  let lastSnapshotAtMs = 0;
  let lastManualRefreshAtMs = 0;
  let backoffUntilMs = 0;
  let lastLogin = '';
  let lastGraphqlLimit: RateLimitBucket | null = null;
  let lastCoreLimit: RateLimitBucket | null = null;
  let inFlight: Promise<SnapshotResult> | null = null;

  let cachedReviewQueue: {
    fetchedAtMs: number;
    pullRequests: RawPullRequest[];
    warnings: SnapshotWarning[];
  } | null = null;

  let cachedRepoPulls: {
    fetchedAtMs: number;
    repoKeys: string;
    pullRequests: RawPullRequest[];
    warnings: SnapshotWarning[];
  } | null = null;

  function buildErrorSnapshot(
    nextState: 'rate-limited' | 'auth-error' | 'fatal',
    warnings: SnapshotWarning[],
    nowMs: number,
  ): SnapshotResult {
    const base = cachedResult?.snapshot;
    const snapshot: SnapshotResponse = base
      ? {
          ...base,
          state: nextState,
          rateLimit: {
            graphql: lastGraphqlLimit ?? base.rateLimit.graphql,
            core: lastCoreLimit ?? base.rateLimit.core,
          },
          warnings: dedupeWarnings(warnings),
        }
      : {
          fetchedAt: new Date(nowMs).toISOString(),
          viewer: { login: lastLogin },
          state: nextState,
          counts: { needsMe: 0, ready: 0, waiting: 0, draft: 0 },
          pullRequests: [],
          rateLimit: {
            graphql: lastGraphqlLimit,
            core: lastCoreLimit,
          },
          warnings: dedupeWarnings(warnings),
        };
    const result = { snapshot, etag: computeSnapshotEtag(snapshot) };
    cachedResult = result;
    return result;
  }

  async function runFetch(isManual: boolean): Promise<SnapshotResult> {
    const startMs = now();
    const hadCachedData = Boolean(cachedResult && cachedResult.snapshot.pullRequests.length > 0);
    const hadAnySnapshot = cachedResult !== null;

    if (lifecycle === 'auth-error' || lifecycle === 'fatal') {
      lifecycle = transitionLifecycleState(lifecycle, 'MANUAL_RETRY', hadAnySnapshot);
      try {
        await deps.tokenStore.reloadToken();
      } catch (error) {
        const msg = sanitizeErrorMessage(error, deps.tokenStore.peekToken());
        lifecycle = transitionLifecycleState(lifecycle, 'FETCH_AUTH_ERROR', hadAnySnapshot);
        scheduler = 'idle';
        return buildErrorSnapshot('auth-error', [{ code: 'auth-error', message: msg }], startMs);
      }
    } else if (lifecycle === 'rate-limited') {
      lifecycle = transitionLifecycleState(
        lifecycle,
        isManual ? 'FORCE_REFRESH' : 'RESET_REACHED',
        hadAnySnapshot,
      );
    } else {
      lifecycle = transitionLifecycleState(
        lifecycle,
        isManual ? 'FORCE_REFRESH' : 'REQUEST',
        hadAnySnapshot,
      );
    }

    scheduler = 'in-flight';
    const warnings: SnapshotWarning[] = [];
    let reviewFailed = false;

    try {
      const authored = await deps.githubClient.fetchAuthoredPulls();
      lastLogin = authored.login || lastLogin;
      if (authored.rateLimit) {
        lastGraphqlLimit = authored.rateLimit;
      }
      warnings.push(...authored.warnings);

      let reviewPulls: RawPullRequest[] = [];
      const canReuseReviewQueue =
        cachedReviewQueue !== null && startMs - cachedReviewQueue.fetchedAtMs < REVIEW_QUEUE_TTL_MS;

      if (canReuseReviewQueue && cachedReviewQueue) {
        reviewPulls = cachedReviewQueue.pullRequests;
        warnings.push(...cachedReviewQueue.warnings);
      } else {
        try {
          const review = await deps.githubClient.fetchReviewQueue();
          if (review.rateLimit) {
            lastGraphqlLimit = review.rateLimit;
          }
          reviewPulls = review.pullRequests;
          cachedReviewQueue = {
            fetchedAtMs: startMs,
            pullRequests: review.pullRequests,
            warnings: review.warnings,
          };
          warnings.push(...review.warnings);
        } catch (error) {
          if (error instanceof GitHubAuthError || error instanceof GitHubRateLimitError) {
            throw error;
          }
          reviewFailed = true;
          const msg = sanitizeErrorMessage(error, deps.tokenStore.peekToken());
          warnings.push({
            code: 'review-queue-failed',
            message: `Review queue unavailable: ${msg}`,
          });
          if (cachedReviewQueue) {
            reviewPulls = cachedReviewQueue.pullRequests;
          }
        }
      }

      const activeRepos = Array.from(
        new Set(
          [...authored.pullRequests, ...reviewPulls]
            .filter(isActivePullRequest)
            .map((pr) => pr.repository.nameWithOwner)
            .filter((name) => name.includes('/')),
        ),
      ).sort();

      let repoPulls: RawPullRequest[] = [];
      let repoPullsFailed = false;
      const repoKeys = activeRepos.join(',');
      const canReuseRepoPulls =
        cachedRepoPulls !== null &&
        cachedRepoPulls.repoKeys === repoKeys &&
        startMs - cachedRepoPulls.fetchedAtMs < REPO_PULLS_TTL_MS;

      if (activeRepos.length > 0 && deps.githubClient.fetchRepoPulls) {
        if (canReuseRepoPulls && cachedRepoPulls) {
          repoPulls = cachedRepoPulls.pullRequests;
          warnings.push(...cachedRepoPulls.warnings);
        } else {
          const collected: RawPullRequest[] = [];
          const repoWarnings: SnapshotWarning[] = [];
          const queue = [...activeRepos];
          const concurrency = Math.min(2, queue.length);

          async function runWorker(): Promise<void> {
            while (queue.length > 0) {
              const fullName = queue.shift();
              if (!fullName) {
                continue;
              }
              const [owner, repo] = fullName.split('/');
              if (!owner || !repo) {
                continue;
              }
              try {
                const res = await deps.githubClient.fetchRepoPulls(owner, repo);
                if (res.rateLimit) {
                  lastGraphqlLimit = res.rateLimit;
                }
                collected.push(...res.pullRequests);
                repoWarnings.push(...res.warnings);
              } catch (err) {
                if (err instanceof GitHubAuthError || err instanceof GitHubRateLimitError) {
                  throw err;
                }
                repoPullsFailed = true;
                const msg = sanitizeErrorMessage(err, deps.tokenStore.peekToken());
                repoWarnings.push({
                  code: 'repo-pulls-failed',
                  message: `Repository pull requests unavailable: ${msg}`,
                });
              }
            }
          }

          await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

          repoPulls = collected;
          warnings.push(...repoWarnings);
          if (!repoPullsFailed) {
            cachedRepoPulls = {
              fetchedAtMs: startMs,
              repoKeys,
              pullRequests: collected,
              warnings: repoWarnings,
            };
          } else if (cachedRepoPulls && collected.length === 0) {
            repoPulls = cachedRepoPulls.pullRequests;
          }
        }
      }

      const merged = mergeRawPullRequests(authored.pullRequests, reviewPulls, repoPulls);
      let probeErrored = false;

      const normalized = await normalizePullRequests(merged, {
        viewerLogin: lastLogin,
        stateStore: deps.stateStore,
        nowMs: startMs,
        probeFn: async (owner, repo, number, etag) => {
          try {
            const res = await deps.githubClient.probeMergeability(owner, repo, number, etag);
            if (res.coreRateLimit) {
              lastCoreLimit = res.coreRateLimit;
            }
            if (res.status === 'unavailable') {
              probeErrored = true;
            }
            return res;
          } catch (error) {
            if (error instanceof GitHubAuthError) {
              throw error;
            }
            if (error instanceof GitHubRateLimitError) {
              probeErrored = true;
              return { status: 'unavailable', coreRateLimit: null };
            }
            probeErrored = true;
            return { status: 'unavailable', coreRateLimit: null };
          }
        },
      });

      if (probeErrored && normalized.hasCachedMergeability) {
        warnings.push({
          code: 'mergeability-cached',
          message: 'Some mergeability checks used cached values after probe unavailability.',
        });
      }

      const uniqueWarnings = dedupeWarnings(warnings);
      const isDegraded = reviewFailed || repoPullsFailed || uniqueWarnings.length > 0;
      lifecycle = transitionLifecycleState(
        lifecycle,
        isDegraded ? 'FETCH_PARTIAL' : 'FETCH_OK',
        true,
      );
      scheduler = 'scheduled';
      lastSnapshotAtMs = startMs;
      backoffUntilMs = 0;

      const snapshot: SnapshotResponse = {
        fetchedAt: new Date(startMs).toISOString(),
        viewer: { login: lastLogin },
        state: lifecycle === 'degraded' ? 'degraded' : 'ready',
        counts: computeCounts(normalized.pullRequests),
        pullRequests: normalized.pullRequests,
        rateLimit: {
          graphql: lastGraphqlLimit,
          core: lastCoreLimit,
        },
        warnings: uniqueWarnings,
      };
      const result: SnapshotResult = {
        snapshot,
        etag: computeSnapshotEtag(snapshot),
      };
      cachedResult = result;
      return result;
    } catch (error) {
      const token = deps.tokenStore.peekToken();
      const msg = sanitizeErrorMessage(error, token);

      if (error instanceof GitHubAuthError) {
        lifecycle = transitionLifecycleState(lifecycle, 'FETCH_AUTH_ERROR', hadCachedData);
        scheduler = 'idle';
        return buildErrorSnapshot('auth-error', [{ code: 'auth-error', message: msg }], startMs);
      }

      if (error instanceof GitHubRateLimitError) {
        const resetMs = Date.parse(error.resetAt);
        backoffUntilMs = Number.isFinite(resetMs)
          ? resetMs + RATE_LIMIT_BACKOFF_BUFFER_MS
          : startMs + 60_000;
        lifecycle = transitionLifecycleState(lifecycle, 'FETCH_RATE_LIMITED', hadAnySnapshot);
        scheduler = hadAnySnapshot ? 'backing-off' : 'idle';
        const nextState = lifecycle === 'rate-limited' ? 'rate-limited' : 'fatal';
        return buildErrorSnapshot(
          nextState,
          [
            {
              code: 'rate-limited',
              message: `GitHub rate limit reached. Next retry after ${new Date(backoffUntilMs).toISOString()}.`,
            },
          ],
          startMs,
        );
      }

      lifecycle = transitionLifecycleState(lifecycle, 'FETCH_ERROR', hadAnySnapshot);
      scheduler = hadAnySnapshot ? 'scheduled' : 'idle';
      if (hadAnySnapshot && cachedResult) {
        const snapshot: SnapshotResponse = {
          ...cachedResult.snapshot,
          state: 'degraded',
          warnings: dedupeWarnings([{ code: 'refresh-failed', message: `Refresh failed: ${msg}` }]),
        };
        const result = { snapshot, etag: computeSnapshotEtag(snapshot) };
        cachedResult = result;
        return result;
      }

      return buildErrorSnapshot('fatal', [{ code: 'refresh-failed', message: msg }], startMs);
    }
  }

  function triggerFetch(isManual: boolean): Promise<SnapshotResult> {
    if (inFlight) {
      return inFlight;
    }
    inFlight = runFetch(isManual).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    async getSnapshot(): Promise<SnapshotResult> {
      const currentMs = now();

      if (lifecycle === 'rate-limited') {
        if (currentMs < backoffUntilMs && cachedResult) {
          return cachedResult;
        }
        return triggerFetch(false);
      }

      if (lifecycle === 'auth-error' || lifecycle === 'fatal') {
        if (cachedResult) {
          return cachedResult;
        }
      }

      if (cachedResult && currentMs - lastSnapshotAtMs < SNAPSHOT_TTL_MS) {
        return cachedResult;
      }

      return triggerFetch(false);
    },

    async forceRefresh(): Promise<SnapshotResult> {
      const currentMs = now();
      if (inFlight) {
        return inFlight;
      }

      const isRecovering = lifecycle === 'auth-error' || lifecycle === 'fatal';
      if (
        !isRecovering &&
        lastManualRefreshAtMs > 0 &&
        currentMs - lastManualRefreshAtMs < MANUAL_REFRESH_COOLDOWN_MS
      ) {
        const remainingMs = MANUAL_REFRESH_COOLDOWN_MS - (currentMs - lastManualRefreshAtMs);
        throw new RefreshCooldownError(Math.max(1, Math.ceil(remainingMs / 1000)));
      }

      lastManualRefreshAtMs = currentMs;
      return triggerFetch(true);
    },

    invalidateCache(): void {
      lastSnapshotAtMs = 0;
      cachedReviewQueue = null;
      cachedRepoPulls = null;
    },

    getStates(): { lifecycle: ServerLifecycleState; scheduler: SchedulerState } {
      return { lifecycle, scheduler };
    },
  };
}
