import type { PrTriageEntry } from '@/server/state-store';
import type { PrTriageInfo, PrView, SnoozeCondition } from '@/types/pr';
import { DEFAULT_PR_TRIAGE, sortPullsPinnedFirst } from '@/utils/triage';

export function shouldWakeUpSnooze(condition: SnoozeCondition, pr: PrView, nowMs: number): boolean {
  switch (condition.kind) {
    case 'until-time': {
      const targetMs = Date.parse(condition.untilIso);
      return !Number.isFinite(targetMs) || nowMs >= targetMs;
    }
    case 'until-push':
      return Boolean(pr.headRefOid) && pr.headRefOid !== condition.headRefOid;
    case 'until-ci-change':
      return (
        pr.ci.state !== condition.ciState ||
        (Boolean(pr.headRefOid) && pr.headRefOid !== condition.headRefOid)
      );
    case 'until-activity':
      return Boolean(pr.updatedAt) && pr.updatedAt !== condition.updatedAt;
  }
}

export function entryToTriageInfo(entry: PrTriageEntry | null | undefined): PrTriageInfo {
  if (!entry) {
    return DEFAULT_PR_TRIAGE;
  }
  const pinned = Boolean(entry.pinned);
  const isSnoozed = Boolean(entry.snoozed);
  return {
    pinned,
    ...(pinned && entry.pinnedAt ? { pinnedAt: entry.pinnedAt } : {}),
    isSnoozed,
    ...(isSnoozed && entry.snoozed
      ? {
          snoozedAt: entry.snoozed.snoozedAt,
          snoozeCondition: entry.snoozed.condition,
        }
      : {}),
  };
}

export interface ApplyTriageResult {
  pullRequests: PrView[];
  nextTriageMap: Record<string, PrTriageEntry>;
  changed: boolean;
}

export function applyTriageToPullRequests(
  pullRequests: PrView[],
  triageMap: Record<string, PrTriageEntry>,
  options: { nowMs: number; pruneClosed: boolean },
): ApplyTriageResult {
  const nextTriageMap: Record<string, PrTriageEntry> = { ...triageMap };
  const activeKeys = new Set<string>();
  let changed = false;

  const updatedPulls = pullRequests.map((pr) => {
    activeKeys.add(pr.key);
    const existing = nextTriageMap[pr.key];
    if (!existing) {
      return { ...pr, triage: DEFAULT_PR_TRIAGE };
    }

    let nextEntry: PrTriageEntry = existing;
    if (existing.snoozed && shouldWakeUpSnooze(existing.snoozed.condition, pr, options.nowMs)) {
      changed = true;
      if (existing.pinned) {
        nextEntry = {
          pinned: true,
          ...(existing.pinnedAt ? { pinnedAt: existing.pinnedAt } : {}),
        };
        nextTriageMap[pr.key] = nextEntry;
      } else {
        delete nextTriageMap[pr.key];
        return { ...pr, triage: DEFAULT_PR_TRIAGE };
      }
    }

    return {
      ...pr,
      triage: entryToTriageInfo(nextEntry),
    };
  });

  if (options.pruneClosed) {
    for (const key of Object.keys(nextTriageMap)) {
      if (!activeKeys.has(key)) {
        delete nextTriageMap[key];
        changed = true;
      }
    }
  }

  return {
    pullRequests: sortPullsPinnedFirst(updatedPulls),
    nextTriageMap,
    changed,
  };
}
