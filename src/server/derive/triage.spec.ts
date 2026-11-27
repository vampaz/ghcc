// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyTriageToPullRequests, shouldWakeUpSnooze } from '@/server/derive/triage';
import type { PrTriageEntry } from '@/server/state-store';
import type { PrView } from '@/types/pr';

function makePr(overrides: Partial<PrView> = {}): PrView {
  return {
    key: 'acme/core-api#101',
    owner: 'acme',
    repo: 'core-api',
    repository: 'acme/core-api',
    number: 101,
    title: 'fix: retry',
    url: 'https://github.com/acme/core-api/pull/101',
    author: 'vampaz',
    baseRefName: 'main',
    headRefName: 'fix/retry',
    headRefOid: 'sha-1',
    isDraft: false,
    labels: [],
    sources: ['authored'],
    bucket: 'needs-me',
    myAction: 'fix-ci',
    blockers: ['ci-failing'],
    ci: {
      state: 'failing',
      passing: 1,
      failing: [{ name: 'test', url: '' }],
      pending: 0,
      hiddenCount: 0,
    },
    review: { decision: 'none', approvals: [], changesRequested: [], pending: [] },
    merge: { state: 'clean', source: 'fresh' },
    autoMerge: false,
    autoMergeMethod: null,
    mergeQueue: null,
    size: { additions: 10, deletions: 2, files: 1 },
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T11:00:00.000Z',
    lastCommittedAt: '2026-11-24T10:30:00.000Z',
    ageDays: 0,
    idleDays: 0,
    blockerSummary: 'CI 1 failing',
    ...overrides,
  };
}

describe('triage derivation', () => {
  const nowMs = Date.parse('2026-11-24T12:00:00.000Z');

  it('evaluates all four snooze wake-up conditions accurately', () => {
    const pr = makePr();

    expect(
      shouldWakeUpSnooze({ kind: 'until-time', untilIso: '2026-11-24T13:00:00.000Z' }, pr, nowMs),
    ).toBe(false);
    expect(
      shouldWakeUpSnooze({ kind: 'until-time', untilIso: '2026-11-24T12:00:00.000Z' }, pr, nowMs),
    ).toBe(true);
    expect(shouldWakeUpSnooze({ kind: 'until-time', untilIso: 'invalid' }, pr, nowMs)).toBe(true);

    expect(shouldWakeUpSnooze({ kind: 'until-push', headRefOid: 'sha-1' }, pr, nowMs)).toBe(false);
    expect(shouldWakeUpSnooze({ kind: 'until-push', headRefOid: 'sha-old' }, pr, nowMs)).toBe(true);

    expect(
      shouldWakeUpSnooze(
        { kind: 'until-ci-change', ciState: 'failing', headRefOid: 'sha-1' },
        pr,
        nowMs,
      ),
    ).toBe(false);
    expect(
      shouldWakeUpSnooze(
        { kind: 'until-ci-change', ciState: 'pending', headRefOid: 'sha-1' },
        pr,
        nowMs,
      ),
    ).toBe(true);

    expect(
      shouldWakeUpSnooze(
        { kind: 'until-activity', updatedAt: '2026-11-24T11:00:00.000Z' },
        pr,
        nowMs,
      ),
    ).toBe(false);
    expect(
      shouldWakeUpSnooze(
        { kind: 'until-activity', updatedAt: '2026-11-24T10:00:00.000Z' },
        pr,
        nowMs,
      ),
    ).toBe(true);
  });

  it('sorts pinned PRs first, wakes expired snoozes, and prunes closed PRs only on clean snapshots', () => {
    const pr1 = makePr({ key: 'acme/core-api#101', number: 101, headRefOid: 'sha-new' });
    const pr2 = makePr({ key: 'acme/web-app#202', number: 202 });
    const pr3 = makePr({ key: 'acme/worker#303', number: 303 });

    const triageMap: Record<string, PrTriageEntry> = {
      'acme/core-api#101': {
        snoozed: {
          condition: { kind: 'until-push', headRefOid: 'sha-old' },
          snoozedAt: '2026-11-24T10:00:00.000Z',
        },
      },
      'acme/web-app#202': {
        snoozed: {
          condition: { kind: 'until-time', untilIso: '2026-11-24T15:00:00.000Z' },
          snoozedAt: '2026-11-24T11:00:00.000Z',
        },
      },
      'acme/worker#303': {
        pinned: true,
        pinnedAt: '2026-11-24T11:30:00.000Z',
      },
      'acme/closed#999': {
        pinned: true,
        pinnedAt: '2026-11-20T00:00:00.000Z',
      },
    };

    const degraded = applyTriageToPullRequests([pr1, pr2, pr3], triageMap, {
      nowMs,
      pruneClosed: false,
    });
    expect(degraded.pullRequests.map((p) => p.key)).toEqual([
      'acme/worker#303',
      'acme/core-api#101',
      'acme/web-app#202',
    ]);
    expect(degraded.pullRequests[0]?.triage?.pinned).toBe(true);
    expect(degraded.pullRequests[1]?.triage?.isSnoozed).toBe(false);
    expect(degraded.pullRequests[2]?.triage?.isSnoozed).toBe(true);
    expect(degraded.nextTriageMap['acme/core-api#101']).toBeUndefined();
    expect(degraded.nextTriageMap['acme/closed#999']).toBeDefined();

    const clean = applyTriageToPullRequests([pr1, pr2, pr3], triageMap, {
      nowMs,
      pruneClosed: true,
    });
    expect(clean.changed).toBe(true);
    expect(clean.nextTriageMap['acme/closed#999']).toBeUndefined();
  });
});
