import type { ExtractedCheckOutcome } from '@/server/derive/checks';
import type {
  FlakeCheckStat,
  FlakeObservation,
  PersistedFlakeTrackerState,
} from '@/server/state-store';
import type { FlakyCheckSummary, PrView } from '@/types/pr';

export const FLAKE_OBSERVATION_TTL_MS = 7 * 24 * 60 * 60_000;
export const FLAKE_STAT_TTL_MS = 14 * 24 * 60 * 60_000;
export const MAX_FLAKE_OBSERVATIONS = 500;
export const MAX_FLAKE_STATS = 200;

export interface PrCheckSnapshot {
  prKey: string;
  repository: string;
  headRefOid: string;
  checks: ExtractedCheckOutcome[];
}

export interface FlakeUpdateResult {
  nextState: PersistedFlakeTrackerState;
  changed: boolean;
}

function pruneMapByTimestamp<T>(
  record: Record<string, T>,
  getTsIso: (item: T) => string,
  cutoffMs: number,
  maxEntries: number,
): { next: Record<string, T>; pruned: boolean } {
  const entries = Object.entries(record);
  const kept: Array<[string, T, number]> = [];
  let pruned = false;

  for (const [key, value] of entries) {
    const ts = Date.parse(getTsIso(value));
    if (!Number.isFinite(ts) || ts < cutoffMs) {
      pruned = true;
      continue;
    }
    kept.push([key, value, ts]);
  }

  if (kept.length > maxEntries) {
    kept.sort((a, b) => b[2] - a[2]);
    kept.length = maxEntries;
    pruned = true;
  }

  const next: Record<string, T> = {};
  for (const [key, value] of kept) {
    next[key] = value;
  }
  return { next, pruned };
}

/**
 * Updates poll-over-poll CI flake observations and repo-level flake stats.
 *
 * A flake is recorded strictly when a check flips between 'failing' and 'passing'
 * (or vice versa) on the EXACT same (prKey, headRefOid). Commits with a new
 * headRefOid reset the per-PR observation so real code fixes are never misclassified
 * as flakes.
 */
export function updateFlakeTracker(
  current: PersistedFlakeTrackerState,
  snapshots: readonly PrCheckSnapshot[],
  options: { nowMs?: number } = {},
): FlakeUpdateResult {
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const observations: Record<string, FlakeObservation> = { ...current.observations };
  const stats: Record<string, FlakeCheckStat> = { ...current.stats };
  let changed = false;

  for (const snap of snapshots) {
    if (!snap.headRefOid) {
      continue;
    }
    for (const check of snap.checks) {
      if (check.outcome === 'pending') {
        continue;
      }
      const obsKey = `${snap.prKey}::${check.name}`;
      const existing = observations[obsKey];

      if (!existing || existing.headRefOid !== snap.headRefOid) {
        observations[obsKey] = {
          headRefOid: snap.headRefOid,
          lastOutcome: check.outcome,
          flakedOnCommit: false,
          updatedAt: nowIso,
        };
        changed = true;
        continue;
      }

      if (existing.lastOutcome !== check.outcome) {
        observations[obsKey] = {
          headRefOid: snap.headRefOid,
          lastOutcome: check.outcome,
          flakedOnCommit: true,
          updatedAt: nowIso,
        };
        const statKey = `${snap.repository}::${check.name}`;
        const prevStat = stats[statKey];
        const recentPrKeys = Array.from(
          new Set([snap.prKey, ...(prevStat?.recentPrKeys ?? [])]),
        ).slice(0, 5);
        stats[statKey] = {
          repository: snap.repository,
          checkName: check.name,
          flakeCount: (prevStat?.flakeCount ?? 0) + 1,
          lastFlakedAt: nowIso,
          recentPrKeys,
        };
        changed = true;
      }
    }
  }

  const prunedObs = pruneMapByTimestamp(
    observations,
    (item) => item.updatedAt,
    nowMs - FLAKE_OBSERVATION_TTL_MS,
    MAX_FLAKE_OBSERVATIONS,
  );
  const prunedStats = pruneMapByTimestamp(
    stats,
    (item) => item.lastFlakedAt,
    nowMs - FLAKE_STAT_TTL_MS,
    MAX_FLAKE_STATS,
  );

  return {
    nextState: {
      observations: prunedObs.next,
      stats: prunedStats.next,
    },
    changed: changed || prunedObs.pruned || prunedStats.pruned,
  };
}

export function annotateFlakyPullRequests(
  pullRequests: readonly PrView[],
  tracker: PersistedFlakeTrackerState,
  nowMs: number = Date.now(),
): { pullRequests: PrView[]; flakyChecks: FlakyCheckSummary[] } {
  const cutoffMs = nowMs - FLAKE_STAT_TTL_MS;
  const activeStats = new Map<string, FlakeCheckStat>();

  for (const [key, stat] of Object.entries(tracker.stats)) {
    const ts = Date.parse(stat.lastFlakedAt);
    if (stat.flakeCount > 0 && Number.isFinite(ts) && ts >= cutoffMs) {
      activeStats.set(key, stat);
    }
  }

  const annotated = pullRequests.map((pr) => {
    const flakyNames = new Set<string>();

    // Any currently failing check that is known flaky in this repository
    for (const check of pr.ci.failing) {
      if (activeStats.has(`${pr.repository}::${check.name}`)) {
        flakyNames.add(check.name);
      }
    }

    // Any check that flipped on this exact PR commit SHA
    for (const [obsKey, obs] of Object.entries(tracker.observations)) {
      if (!obs.flakedOnCommit || obs.headRefOid !== pr.headRefOid) {
        continue;
      }
      const prefix = `${pr.key}::`;
      if (obsKey.startsWith(prefix)) {
        flakyNames.add(obsKey.slice(prefix.length));
      }
    }

    if (flakyNames.size === 0) {
      if (!pr.ci.flakyChecks) {
        return pr;
      }
      const { flakyChecks: _removed, ...restCi } = pr.ci;
      return { ...pr, ci: restCi };
    }

    return {
      ...pr,
      ci: {
        ...pr.ci,
        flakyChecks: Array.from(flakyNames).sort(),
      },
    };
  });

  const flakyChecks: FlakyCheckSummary[] = Array.from(activeStats.values())
    .map((stat) => ({
      repository: stat.repository,
      checkName: stat.checkName,
      flakeCount: stat.flakeCount,
      lastFlakedAt: stat.lastFlakedAt,
    }))
    .sort((a, b) => {
      if (b.flakeCount !== a.flakeCount) {
        return b.flakeCount - a.flakeCount;
      }
      return b.lastFlakedAt.localeCompare(a.lastFlakedAt);
    });

  return { pullRequests: annotated, flakyChecks };
}
