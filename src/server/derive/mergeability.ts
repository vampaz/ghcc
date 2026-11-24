import type { RawMergeable, RawMergeStateStatus, RawPullRequest } from '@/server/derive/types';
import type { ProbeMergeabilityResult } from '@/server/github-client';
import type { StateStore } from '@/server/state-store';
import type { PrMergeInfo } from '@/types/pr';

export const MERGEABILITY_CACHE_TTL_MS = 15 * 60 * 1000;
export const MAX_PROBES_PER_REFRESH = 5;
export const MAX_PROBES_PER_PR_PER_HOUR = 2;

export interface MergeabilityContext {
  stateStore: StateStore;
  probeFn?: (
    owner: string,
    repo: string,
    number: number,
    etag?: string,
  ) => Promise<ProbeMergeabilityResult>;
  nowMs?: number;
  probeBudget?: { remaining: number };
}

export interface ResolvedMergeability {
  merge: PrMergeInfo;
  effectiveMergeStateStatus: RawMergeStateStatus;
}

const VALID_MERGE_STATES = new Set<RawMergeStateStatus>([
  'BEHIND',
  'BLOCKED',
  'CLEAN',
  'DIRTY',
  'DRAFT',
  'HAS_HOOKS',
  'UNKNOWN',
  'UNSTABLE',
]);

function normalizeRestMergeableState(raw: string | null | undefined): RawMergeStateStatus | null {
  if (!raw) {
    return null;
  }
  const upper = raw.toUpperCase() as RawMergeStateStatus;
  return VALID_MERGE_STATES.has(upper) ? upper : null;
}

function mapMergeState(
  raw: RawPullRequest,
  resolvedMergeable: RawMergeable,
  effectiveStatus: RawMergeStateStatus,
): PrMergeInfo['state'] {
  if (raw.mergeQueueEntry) {
    return 'queued';
  }
  if (raw.isDraft) {
    return 'draft';
  }
  if (resolvedMergeable === 'CONFLICTING' || effectiveStatus === 'DIRTY') {
    return 'conflicting';
  }
  if (effectiveStatus === 'BEHIND') {
    return 'behind';
  }
  if (effectiveStatus === 'BLOCKED') {
    return 'blocked';
  }
  if (effectiveStatus === 'CLEAN' || effectiveStatus === 'HAS_HOOKS') {
    return 'clean';
  }
  if (effectiveStatus === 'UNSTABLE' && resolvedMergeable === 'MERGEABLE') {
    return 'clean';
  }
  if (resolvedMergeable === 'MERGEABLE') {
    return 'clean';
  }
  return 'unknown';
}

export async function resolveMergeability(
  raw: RawPullRequest,
  ctx: MergeabilityContext,
): Promise<ResolvedMergeability> {
  const nowMs = ctx.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const prKey = `${raw.repository.nameWithOwner}#${raw.number}`;

  // Rule 1: GraphQL mergeable when known -> persist under headRefOid and return 'fresh'.
  if (raw.mergeable !== 'UNKNOWN') {
    const existing = await ctx.stateStore.getMergeability(prKey);
    await ctx.stateStore.setMergeability(prKey, {
      headRefOid: raw.headRefOid,
      mergeable: raw.mergeable,
      mergeStateStatus: raw.mergeStateStatus,
      checkedAt: nowIso,
      etag: existing?.headRefOid === raw.headRefOid ? existing.etag : undefined,
    });
    return {
      merge: {
        state: mapMergeState(raw, raw.mergeable, raw.mergeStateStatus),
        source: 'fresh',
        checkedAt: nowIso,
      },
      effectiveMergeStateStatus: raw.mergeStateStatus,
    };
  }

  const cached = await ctx.stateStore.getMergeability(prKey);
  const sameHeadCache = cached && cached.headRefOid === raw.headRefOid ? cached : null;

  // Rule 2: GraphQL UNKNOWN with fresh cached value for same headRefOid (<= 15m).
  if (sameHeadCache) {
    const ageMs = nowMs - Date.parse(sameHeadCache.checkedAt);
    if (Number.isFinite(ageMs) && ageMs <= MERGEABILITY_CACHE_TTL_MS) {
      const effectiveStatus =
        normalizeRestMergeableState(sameHeadCache.mergeStateStatus) ?? raw.mergeStateStatus;
      return {
        merge: {
          state: mapMergeState(raw, sameHeadCache.mergeable, effectiveStatus),
          source: 'cached',
          checkedAt: sameHeadCache.checkedAt,
        },
        effectiveMergeStateStatus: effectiveStatus,
      };
    }
  }

  // Rule 3: Probe REST endpoint when budget allows (<= 5 per refresh, <= 2/hr/PR/headRefOid).
  const budget = ctx.probeBudget ?? { remaining: MAX_PROBES_PER_REFRESH };
  if (ctx.probeFn && budget.remaining > 0) {
    const recentCount = await ctx.stateStore.getRecentProbeCount(prKey, raw.headRefOid, nowMs);
    if (recentCount < MAX_PROBES_PER_PR_PER_HOUR) {
      budget.remaining--;
      await ctx.stateStore.recordProbeAttempt(prKey, raw.headRefOid, nowIso);
      const [owner, repo] = raw.repository.nameWithOwner.split('/');
      if (owner && repo) {
        const probe = await ctx.probeFn(owner, repo, raw.number, sameHeadCache?.etag);
        if (probe.status === 'not-modified' && sameHeadCache) {
          await ctx.stateStore.setMergeability(prKey, {
            ...sameHeadCache,
            checkedAt: nowIso,
          });
          const effectiveStatus =
            normalizeRestMergeableState(sameHeadCache.mergeStateStatus) ?? raw.mergeStateStatus;
          return {
            merge: {
              state: mapMergeState(raw, sameHeadCache.mergeable, effectiveStatus),
              source: 'cached',
              checkedAt: nowIso,
            },
            effectiveMergeStateStatus: effectiveStatus,
          };
        }
        if (probe.status === 'ok' && probe.mergeable !== null) {
          const resolvedMergeable: 'MERGEABLE' | 'CONFLICTING' = probe.mergeable
            ? 'MERGEABLE'
            : 'CONFLICTING';
          const effectiveStatus =
            normalizeRestMergeableState(probe.mergeableState) ?? raw.mergeStateStatus;
          await ctx.stateStore.setMergeability(prKey, {
            headRefOid: raw.headRefOid,
            mergeable: resolvedMergeable,
            mergeStateStatus: effectiveStatus,
            checkedAt: nowIso,
            etag: probe.etag,
          });
          return {
            merge: {
              state: mapMergeState(raw, resolvedMergeable, effectiveStatus),
              source: 'probe',
              checkedAt: nowIso,
            },
            effectiveMergeStateStatus: effectiveStatus,
          };
        }
      }
    }
  }

  // Benign fallback to same-headRefOid cached entry if any exists, otherwise unknown.
  if (sameHeadCache) {
    const effectiveStatus =
      normalizeRestMergeableState(sameHeadCache.mergeStateStatus) ?? raw.mergeStateStatus;
    return {
      merge: {
        state: mapMergeState(raw, sameHeadCache.mergeable, effectiveStatus),
        source: 'cached',
        checkedAt: sameHeadCache.checkedAt,
      },
      effectiveMergeStateStatus: effectiveStatus,
    };
  }

  // Rule 4: Unknown -> render as `merge ?`.
  return {
    merge: {
      state: mapMergeState(raw, 'UNKNOWN', raw.mergeStateStatus),
      source: 'unknown',
    },
    effectiveMergeStateStatus: raw.mergeStateStatus,
  };
}
