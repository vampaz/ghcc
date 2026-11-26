import type { RawMergeable, RawMergeStateStatus, RawPullRequest } from '@/server/derive/types';
import type { ProbeMergeabilityResult } from '@/server/github-client';
import type { StateStore } from '@/server/state-store';
import type { PrMergeInfo } from '@/types/pr';

export const MERGEABILITY_CACHE_TTL_MS = 3 * 60 * 1000;
export const MAX_PROBES_PER_REFRESH = 5;
export const MAX_PROBES_PER_PR_PER_HOUR = 6;

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
  isBehindBase?: boolean;
  bypassCache?: boolean;
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
  isBehindBase?: boolean,
): PrMergeInfo['state'] {
  if (raw.mergeQueueEntry) {
    return 'queued';
  }
  if (raw.isDraft) {
    if (
      resolvedMergeable !== 'CONFLICTING' &&
      effectiveStatus !== 'DIRTY' &&
      (effectiveStatus === 'BEHIND' || isBehindBase === true)
    ) {
      return 'behind';
    }
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

  // Rule 1: GraphQL mergeable when known -> persist under (headRefOid, baseRefOid) and return 'fresh'.
  if (raw.mergeable !== 'UNKNOWN') {
    const existing = await ctx.stateStore.getMergeability(prKey);
    const matchesExistingRef =
      existing?.headRefOid === raw.headRefOid &&
      (!existing.baseRefOid || !raw.baseRefOid || existing.baseRefOid === raw.baseRefOid);
    await ctx.stateStore.setMergeability(prKey, {
      headRefOid: raw.headRefOid,
      ...(raw.baseRefOid ? { baseRefOid: raw.baseRefOid } : {}),
      mergeable: raw.mergeable,
      mergeStateStatus: raw.mergeStateStatus,
      checkedAt: nowIso,
      etag: matchesExistingRef ? existing?.etag : undefined,
    });
    return {
      merge: {
        state: mapMergeState(raw, raw.mergeable, raw.mergeStateStatus, ctx.isBehindBase),
        source: 'fresh',
        checkedAt: nowIso,
      },
      effectiveMergeStateStatus: raw.mergeStateStatus,
    };
  }

  const cached = await ctx.stateStore.getMergeability(prKey);
  const sameHeadCache =
    cached &&
    cached.headRefOid === raw.headRefOid &&
    (!cached.baseRefOid || !raw.baseRefOid || cached.baseRefOid === raw.baseRefOid)
      ? cached
      : null;

  // Rule 2: GraphQL UNKNOWN with fresh cached value for same (headRefOid, baseRefOid) (<= 3m).
  if (sameHeadCache && !ctx.bypassCache) {
    const ageMs = nowMs - Date.parse(sameHeadCache.checkedAt);
    if (Number.isFinite(ageMs) && ageMs <= MERGEABILITY_CACHE_TTL_MS) {
      const effectiveStatus =
        normalizeRestMergeableState(sameHeadCache.mergeStateStatus) ?? raw.mergeStateStatus;
      return {
        merge: {
          state: mapMergeState(raw, sameHeadCache.mergeable, effectiveStatus, ctx.isBehindBase),
          source: 'cached',
          checkedAt: sameHeadCache.checkedAt,
        },
        effectiveMergeStateStatus: effectiveStatus,
      };
    }
  }

  // Rule 3: Probe REST endpoint when budget allows (<= 5 per refresh, <= 6/hr/PR/headRefOid).
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
            ...(raw.baseRefOid ? { baseRefOid: raw.baseRefOid } : {}),
            checkedAt: nowIso,
          });
          const effectiveStatus =
            normalizeRestMergeableState(sameHeadCache.mergeStateStatus) ?? raw.mergeStateStatus;
          return {
            merge: {
              state: mapMergeState(raw, sameHeadCache.mergeable, effectiveStatus, ctx.isBehindBase),
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
            ...(raw.baseRefOid ? { baseRefOid: raw.baseRefOid } : {}),
            mergeable: resolvedMergeable,
            mergeStateStatus: effectiveStatus,
            checkedAt: nowIso,
            etag: probe.etag,
          });
          return {
            merge: {
              state: mapMergeState(raw, resolvedMergeable, effectiveStatus, ctx.isBehindBase),
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
        state: mapMergeState(raw, sameHeadCache.mergeable, effectiveStatus, ctx.isBehindBase),
        source: 'cached',
        checkedAt: sameHeadCache.checkedAt,
      },
      effectiveMergeStateStatus: effectiveStatus,
    };
  }

  // Rule 4: Unknown -> render as `merge ?`.
  return {
    merge: {
      state: mapMergeState(raw, 'UNKNOWN', raw.mergeStateStatus, ctx.isBehindBase),
      source: 'unknown',
    },
    effectiveMergeStateStatus: raw.mergeStateStatus,
  };
}
