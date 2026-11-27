import { createHash } from 'node:crypto';
import type { TokenStore } from '@/server/auth';
import {
  computeCounts,
  isActivePullRequest,
  mergeRawPullRequests,
  normalizePullRequests,
} from '@/server/derive/normalize';
import { applyTriageToPullRequests, entryToTriageInfo } from '@/server/derive/triage';
import type { RawPullRequest } from '@/server/derive/types';
import {
  GitHubAuthError,
  GitHubRateLimitError,
  type DraftBranchCompareItem,
  type GitHubClient,
} from '@/server/github-client';
import { sanitizeErrorMessage } from '@/server/redact';
import type { CachedDraftComparisonEntry, PrTriageEntry, StateStore } from '@/server/state-store';
import type {
  PrTriageInfo,
  RateLimitBucket,
  SchedulerState,
  ServerLifecycleState,
  SnapshotResponse,
  SnapshotWarning,
} from '@/types/pr';

export const SNAPSHOT_TTL_MS = 55_000;
export const REVIEW_QUEUE_TTL_MS = 55_000;
export const REPO_PULLS_TTL_MS = 2 * 60_000;
export const PERSISTED_SNAPSHOT_MAX_AGE_MS = 30 * 60_000;
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
  isRefreshing?: boolean;
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

export interface GetSnapshotOptions {
  waitForInFlight?: boolean;
}

export interface SnapshotService {
  getSnapshot(options?: GetSnapshotOptions): Promise<SnapshotResult>;
  forceRefresh(): Promise<SnapshotResult>;
  invalidateCache(repoKey?: string): void;
  applyLocalTriageUpdate(prKey: string, entry: PrTriageEntry | null): Promise<PrTriageInfo>;
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

  interface CachedRepoPullsEntry {
    fetchedAtMs: number;
    pullRequests: RawPullRequest[];
    warnings: SnapshotWarning[];
  }

  const repoPullsCache = new Map<string, CachedRepoPullsEntry>();
  let persistedHydrated = false;
  let hydrationInFlight: Promise<void> | null = null;

  async function hydrateFromDiskIfNeeded(currentMs: number): Promise<void> {
    if (persistedHydrated || cachedResult || lifecycle !== 'idle') {
      return;
    }
    if (hydrationInFlight) {
      await hydrationInFlight;
      return;
    }
    hydrationInFlight = (async () => {
      try {
        const persisted = await deps.stateStore.getLastSnapshot().catch(() => null);
        if (
          persisted?.snapshot &&
          Array.isArray(persisted.snapshot.pullRequests) &&
          persisted.snapshot.pullRequests.every((p) => Array.isArray(p.labels))
        ) {
          const savedMs = Date.parse(persisted.savedAt);
          const ageMs = Number.isFinite(savedMs) ? currentMs - savedMs : Number.POSITIVE_INFINITY;
          if (ageMs >= 0 && ageMs < PERSISTED_SNAPSHOT_MAX_AGE_MS && !cachedResult) {
            const triageMap = await deps.stateStore.getTriageMap().catch(() => ({}));
            const triaged = applyTriageToPullRequests(persisted.snapshot.pullRequests, triageMap, {
              nowMs: currentMs,
              pruneClosed: false,
            });
            const hydratedSnapshot: SnapshotResponse = {
              ...persisted.snapshot,
              pullRequests: triaged.pullRequests,
            };
            cachedResult = {
              snapshot: hydratedSnapshot,
              etag: computeSnapshotEtag(hydratedSnapshot),
            };
            lastSnapshotAtMs = savedMs;
            lastLogin = persisted.snapshot.viewer.login || lastLogin;
            lastGraphqlLimit = persisted.snapshot.rateLimit.graphql;
            lastCoreLimit = persisted.snapshot.rateLimit.core;
            lifecycle = persisted.snapshot.state === 'degraded' ? 'degraded' : 'ready';
            scheduler = 'scheduled';
            if (ageMs >= SNAPSHOT_TTL_MS) {
              // Stale-while-revalidate on warm restart: serve cached snapshot immediately and refresh in background.
              void triggerFetch(false);
            }
          }
        }
      } finally {
        persistedHydrated = true;
        hydrationInFlight = null;
      }
    })();
    await hydrationInFlight;
  }

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
        !isManual &&
        cachedReviewQueue !== null &&
        startMs - cachedReviewQueue.fetchedAtMs < REVIEW_QUEUE_TTL_MS;

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
            fetchedAtMs: now(),
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

      const repoPulls: RawPullRequest[] = [];
      let repoPullsFailed = false;

      if (activeRepos.length > 0 && deps.githubClient.fetchRepoPulls) {
        const collected: RawPullRequest[] = [];
        const repoWarnings: SnapshotWarning[] = [];
        const staleRepos: string[] = [];

        for (const fullName of activeRepos) {
          const cached = repoPullsCache.get(fullName);
          if (!isManual && cached && startMs - cached.fetchedAtMs < REPO_PULLS_TTL_MS) {
            collected.push(...cached.pullRequests);
            repoWarnings.push(...cached.warnings);
          } else {
            staleRepos.push(fullName);
          }
        }

        if (staleRepos.length > 0) {
          const queue = [...staleRepos];
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
                const res = await deps.githubClient.fetchRepoPulls!(owner, repo);
                if (res.rateLimit) {
                  lastGraphqlLimit = res.rateLimit;
                }
                repoPullsCache.set(fullName, {
                  fetchedAtMs: now(),
                  pullRequests: res.pullRequests,
                  warnings: res.warnings,
                });
                collected.push(...res.pullRequests);
                repoWarnings.push(...res.warnings);
              } catch (err) {
                if (err instanceof GitHubAuthError || err instanceof GitHubRateLimitError) {
                  throw err;
                }
                repoPullsFailed = true;
                const msg = sanitizeErrorMessage(err, deps.tokenStore.peekToken());
                const fallback = repoPullsCache.get(fullName);
                if (fallback) {
                  collected.push(...fallback.pullRequests);
                  repoWarnings.push({
                    code: 'repo-pulls-failed',
                    message: `${fullName} refresh failed (showing cached PRs): ${msg}`,
                  });
                } else {
                  repoWarnings.push({
                    code: 'repo-pulls-failed',
                    message: `Repository pull requests unavailable (${fullName}): ${msg}`,
                  });
                }
              }
            }
          }

          await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
        }

        repoPulls.push(...collected);
        warnings.push(...repoWarnings);
      }

      const merged = mergeRawPullRequests(authored.pullRequests, reviewPulls, repoPulls);
      const draftBehindByKey = new Map<string, boolean>();
      const uncachedDrafts: DraftBranchCompareItem[] = [];

      for (const { raw } of merged) {
        if (
          !raw.isDraft ||
          raw.mergeQueueEntry ||
          raw.mergeable === 'CONFLICTING' ||
          raw.mergeStateStatus === 'BEHIND' ||
          raw.mergeStateStatus === 'DIRTY' ||
          !raw.baseRefOid ||
          !raw.headRefOid
        ) {
          continue;
        }
        const key = `${raw.repository.nameWithOwner}#${raw.number}`;
        if (raw.headRefOid === raw.baseRefOid) {
          draftBehindByKey.set(key, false);
          continue;
        }
        const cached = await deps.stateStore.getDraftComparison(key);
        if (
          cached &&
          cached.baseRefOid === raw.baseRefOid &&
          cached.headRefOid === raw.headRefOid
        ) {
          draftBehindByKey.set(key, cached.behindBy > 0);
          continue;
        }
        const [owner, repo] = raw.repository.nameWithOwner.split('/');
        if (owner && repo) {
          uncachedDrafts.push({
            key,
            owner,
            repo,
            baseRefName: raw.baseRefName,
            baseRefOid: raw.baseRefOid,
            headRefOid: raw.headRefOid,
          });
        }
      }

      if (uncachedDrafts.length > 0 && deps.githubClient.compareDraftBranches) {
        try {
          const compared = await deps.githubClient.compareDraftBranches(uncachedDrafts);
          if (compared.rateLimit) {
            lastGraphqlLimit = compared.rateLimit;
          }
          const toPersist: Record<string, CachedDraftComparisonEntry> = {};
          for (const item of uncachedDrafts) {
            const behindBy = compared.behindByByKey[item.key];
            if (typeof behindBy === 'number' && Number.isFinite(behindBy)) {
              draftBehindByKey.set(item.key, behindBy > 0);
              toPersist[item.key] = {
                baseRefOid: item.baseRefOid,
                headRefOid: item.headRefOid,
                behindBy,
              };
            }
          }
          await deps.stateStore.setDraftComparisons(toPersist).catch(() => {
            // Best-effort cache persistence; ignore disk errors.
          });
        } catch (error) {
          if (error instanceof GitHubAuthError) {
            throw error;
          }
          // Best-effort draft comparison; keep snapshot healthy on transient or rate-limit errors.
        }
      }

      let probeErrored = false;

      const normalized = await normalizePullRequests(merged, {
        viewerLogin: lastLogin,
        stateStore: deps.stateStore,
        nowMs: startMs,
        draftBehindByKey,
        bypassMergeabilityCache: isManual,
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

      const completedMs = now();
      const uniqueWarnings = dedupeWarnings(warnings);
      const isDegraded = reviewFailed || repoPullsFailed || uniqueWarnings.length > 0;
      lifecycle = transitionLifecycleState(
        lifecycle,
        isDegraded ? 'FETCH_PARTIAL' : 'FETCH_OK',
        true,
      );
      scheduler = 'scheduled';
      lastSnapshotAtMs = completedMs;
      backoffUntilMs = 0;

      const triageMap = await deps.stateStore.getTriageMap().catch(() => ({}));
      const triaged = applyTriageToPullRequests(normalized.pullRequests, triageMap, {
        nowMs: completedMs,
        pruneClosed: !isDegraded,
      });
      if (triaged.changed) {
        await deps.stateStore.setTriageMap(triaged.nextTriageMap).catch(() => {
          // Best-effort triage persistence; ignore disk errors.
        });
      }

      const snapshot: SnapshotResponse = {
        fetchedAt: new Date(completedMs).toISOString(),
        viewer: { login: lastLogin },
        state: lifecycle === 'degraded' ? 'degraded' : 'ready',
        counts: computeCounts(triaged.pullRequests),
        pullRequests: triaged.pullRequests,
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
      persistedHydrated = true;
      if (snapshot.state === 'ready' || snapshot.pullRequests.length > 0) {
        await deps.stateStore.setLastSnapshot(snapshot, snapshot.fetchedAt).catch(() => {
          // Best-effort cache persistence; ignore disk errors.
        });
      }
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
    async getSnapshot(options: GetSnapshotOptions = {}): Promise<SnapshotResult> {
      const currentMs = now();
      const wasIdle = lifecycle === 'idle' && !cachedResult;
      await hydrateFromDiskIfNeeded(currentMs);

      if (options.waitForInFlight && inFlight) {
        return inFlight;
      }

      if (wasIdle && cachedResult) {
        return {
          ...cachedResult,
          isRefreshing: inFlight !== null,
        };
      }

      if (lifecycle === 'rate-limited') {
        if (currentMs < backoffUntilMs && cachedResult) {
          return {
            ...cachedResult,
            isRefreshing: inFlight !== null,
          };
        }
        return triggerFetch(false);
      }

      if (lifecycle === 'auth-error' || lifecycle === 'fatal') {
        if (cachedResult) {
          return {
            ...cachedResult,
            isRefreshing: inFlight !== null,
          };
        }
      }

      if (cachedResult && currentMs - lastSnapshotAtMs < SNAPSHOT_TTL_MS) {
        return {
          ...cachedResult,
          isRefreshing: inFlight !== null,
        };
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
      deps.githubClient.invalidatePullDetailCache?.();
      return triggerFetch(true);
    },

    invalidateCache(repoKey?: string): void {
      lastSnapshotAtMs = 0;
      cachedReviewQueue = null;
      if (repoKey) {
        const entry = repoPullsCache.get(repoKey);
        if (entry) {
          entry.fetchedAtMs = 0;
        }
      } else {
        for (const entry of repoPullsCache.values()) {
          entry.fetchedAtMs = 0;
        }
      }
    },

    async applyLocalTriageUpdate(
      prKey: string,
      entry: PrTriageEntry | null,
    ): Promise<PrTriageInfo> {
      await deps.stateStore.setPrTriage(prKey, entry);
      if (cachedResult) {
        const triageMap = await deps.stateStore.getTriageMap();
        const triaged = applyTriageToPullRequests(cachedResult.snapshot.pullRequests, triageMap, {
          nowMs: now(),
          pruneClosed: false,
        });
        const nextSnapshot: SnapshotResponse = {
          ...cachedResult.snapshot,
          pullRequests: triaged.pullRequests,
        };
        cachedResult = {
          snapshot: nextSnapshot,
          etag: computeSnapshotEtag(nextSnapshot),
        };
        await deps.stateStore.setLastSnapshot(nextSnapshot, nextSnapshot.fetchedAt).catch(() => {
          // Best-effort cache persistence; ignore disk errors.
        });
      }
      return entryToTriageInfo(entry);
    },

    getStates(): { lifecycle: ServerLifecycleState; scheduler: SchedulerState } {
      return { lifecycle, scheduler };
    },
  };
}
