import type { PrTriageInfo, PrView, SnoozeCondition } from '@/types/pr';

export const DEFAULT_PR_TRIAGE: PrTriageInfo = {
  pinned: false,
  isSnoozed: false,
};

export function isPrPinned(pr: PrView): boolean {
  return Boolean(pr.triage?.pinned);
}

export function isPrSnoozed(pr: PrView): boolean {
  return Boolean(pr.triage?.isSnoozed);
}

export function sortPullsPinnedFirst(pullRequests: PrView[]): PrView[] {
  const pinned: PrView[] = [];
  const rest: PrView[] = [];
  for (const pr of pullRequests) {
    if (isPrPinned(pr)) {
      pinned.push(pr);
    } else {
      rest.push(pr);
    }
  }
  return [...pinned, ...rest];
}

export function formatSnoozeBadge(condition: SnoozeCondition | undefined, nowMs: number): string {
  if (!condition) {
    return 'snoozed';
  }
  switch (condition.kind) {
    case 'until-push':
      return 'snoozed · next push';
    case 'until-ci-change':
      return 'snoozed · CI change';
    case 'until-activity':
      return 'snoozed · activity';
    case 'until-time': {
      const targetMs = Date.parse(condition.untilIso);
      if (!Number.isFinite(targetMs)) {
        return 'snoozed';
      }
      const remainingMs = targetMs - nowMs;
      if (remainingMs <= 0) {
        return 'snoozed · waking';
      }
      const totalMins = Math.ceil(remainingMs / 60_000);
      if (totalMins < 60) {
        return `snoozed · ${totalMins}m left`;
      }
      const totalHours = Math.ceil(totalMins / 60);
      if (totalHours < 48) {
        return `snoozed · ${totalHours}h left`;
      }
      const totalDays = Math.ceil(totalHours / 24);
      return `snoozed · ${totalDays}d left`;
    }
  }
}

export interface SnoozePresetOption {
  id: string;
  label: string;
  hint: string;
  condition: SnoozeCondition;
}

function getNextMorningAt9(nowMs: number, daysAhead: number): string {
  const d = new Date(nowMs);
  d.setDate(d.getDate() + daysAhead);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function getNextMondayAt9(nowMs: number): string {
  const d = new Date(nowMs);
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

export function buildSnoozePresets(pr: PrView, nowMs: number = Date.now()): SnoozePresetOption[] {
  const presets: SnoozePresetOption[] = [];

  if (pr.headRefOid) {
    presets.push({
      id: 'until-push',
      label: 'Until next push',
      hint: 'Wakes when a new commit is pushed',
      condition: { kind: 'until-push', headRefOid: pr.headRefOid },
    });
    presets.push({
      id: 'until-ci-change',
      label: 'Until CI changes',
      hint: `Wakes when CI leaves ${pr.ci.state}`,
      condition: { kind: 'until-ci-change', ciState: pr.ci.state, headRefOid: pr.headRefOid },
    });
  }

  if (pr.updatedAt) {
    presets.push({
      id: 'until-activity',
      label: 'Until new activity',
      hint: 'Wakes on any new review, comment, or commit',
      condition: { kind: 'until-activity', updatedAt: pr.updatedAt },
    });
  }

  presets.push({
    id: '2h',
    label: 'For 2 hours',
    hint: 'Timed snooze',
    condition: { kind: 'until-time', untilIso: new Date(nowMs + 2 * 60 * 60_000).toISOString() },
  });

  presets.push({
    id: 'tomorrow',
    label: 'Tomorrow 9:00 AM',
    hint: 'Local time',
    condition: { kind: 'until-time', untilIso: getNextMorningAt9(nowMs, 1) },
  });

  presets.push({
    id: 'next-monday',
    label: 'Next Monday 9:00 AM',
    hint: 'Local time',
    condition: { kind: 'until-time', untilIso: getNextMondayAt9(nowMs) },
  });

  return presets;
}
