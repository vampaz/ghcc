// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { annotateFlakyPullRequests, updateFlakeTracker } from '@/server/derive/flakes';
import type { PersistedFlakeTrackerState } from '@/server/state-store';
import type { PrView } from '@/types/pr';

function makePr(overrides: Partial<PrView> = {}): PrView {
  return {
    key: 'acme/app#1',
    owner: 'acme',
    repo: 'app',
    repository: 'acme/app',
    number: 1,
    title: 'feat: test',
    url: 'https://github.com/acme/app/pull/1',
    author: 'alice',
    baseRefName: 'main',
    headRefName: 'feat/1',
    headRefOid: 'a'.repeat(40),
    isDraft: false,
    labels: [],
    sources: ['authored'],
    bucket: 'needs-me',
    myAction: 'fix-ci',
    blockers: ['ci-failing'],
    ci: {
      state: 'failing',
      passing: 1,
      failing: [{ name: 'e2e', url: 'https://github.com/acme/app/runs/1' }],
      pending: 0,
      hiddenCount: 0,
    },
    review: { decision: 'none', approvals: [], changesRequested: [], pending: [] },
    merge: { state: 'clean', source: 'fresh' },
    autoMerge: false,
    autoMergeMethod: null,
    mergeQueue: null,
    size: { additions: 10, deletions: 2, files: 1 },
    createdAt: '2026-11-24T10:00:00Z',
    updatedAt: '2026-11-24T11:00:00Z',
    lastCommittedAt: '2026-11-24T11:00:00Z',
    ageDays: 1,
    idleDays: 0,
    blockerSummary: 'CI 1 failing',
    ...overrides,
  };
}

describe('flake tracker', () => {
  it('records a flake when a check flips failing -> passing on the exact same headRefOid', () => {
    const empty: PersistedFlakeTrackerState = { observations: {}, stats: {} };
    const t0 = Date.parse('2026-11-27T10:00:00Z');

    const poll1 = updateFlakeTracker(
      empty,
      [
        {
          prKey: 'acme/app#1',
          repository: 'acme/app',
          headRefOid: 'a'.repeat(40),
          checks: [{ name: 'e2e', outcome: 'failing' }],
        },
      ],
      { nowMs: t0 },
    );
    expect(Object.keys(poll1.nextState.stats)).toHaveLength(0);

    // Repeating same failing outcome does NOT record a flake
    const poll1Repeat = updateFlakeTracker(
      poll1.nextState,
      [
        {
          prKey: 'acme/app#1',
          repository: 'acme/app',
          headRefOid: 'a'.repeat(40),
          checks: [{ name: 'e2e', outcome: 'failing' }],
        },
      ],
      { nowMs: t0 + 60_000 },
    );
    expect(poll1Repeat.changed).toBe(false);
    expect(Object.keys(poll1Repeat.nextState.stats)).toHaveLength(0);

    // Passing on exact same headRefOid -> confirmed flake!
    const poll2 = updateFlakeTracker(
      poll1Repeat.nextState,
      [
        {
          prKey: 'acme/app#1',
          repository: 'acme/app',
          headRefOid: 'a'.repeat(40),
          checks: [{ name: 'e2e', outcome: 'passing' }],
        },
      ],
      { nowMs: t0 + 120_000 },
    );
    expect(poll2.changed).toBe(true);
    expect(poll2.nextState.stats['acme/app::e2e']).toMatchObject({
      repository: 'acme/app',
      checkName: 'e2e',
      flakeCount: 1,
      recentPrKeys: ['acme/app#1'],
    });

    // Annotate another PR failing the same check in the same repo
    const otherPr = makePr({
      key: 'acme/app#2',
      number: 2,
      headRefOid: 'b'.repeat(40),
    });
    const annotated = annotateFlakyPullRequests([otherPr], poll2.nextState, t0 + 120_000);
    expect(annotated.pullRequests[0]!.ci.flakyChecks).toEqual(['e2e']);
    expect(annotated.flakyChecks).toHaveLength(1);
    expect(annotated.flakyChecks[0]!.flakeCount).toBe(1);
  });

  it('does NOT count a pass after a new commit (different headRefOid) as a flake', () => {
    const empty: PersistedFlakeTrackerState = { observations: {}, stats: {} };
    const t0 = Date.parse('2026-11-27T10:00:00Z');

    const poll1 = updateFlakeTracker(
      empty,
      [
        {
          prKey: 'acme/app#1',
          repository: 'acme/app',
          headRefOid: 'a'.repeat(40),
          checks: [{ name: 'unit', outcome: 'failing' }],
        },
      ],
      { nowMs: t0 },
    );

    const poll2 = updateFlakeTracker(
      poll1.nextState,
      [
        {
          prKey: 'acme/app#1',
          repository: 'acme/app',
          headRefOid: 'b'.repeat(40),
          checks: [{ name: 'unit', outcome: 'passing' }],
        },
      ],
      { nowMs: t0 + 60_000 },
    );

    expect(Object.keys(poll2.nextState.stats)).toHaveLength(0);
  });

  it('prunes expired stats and observations past TTL', () => {
    const t0 = Date.parse('2026-11-01T10:00:00Z');
    const staleState: PersistedFlakeTrackerState = {
      observations: {
        'acme/app#1::old': {
          headRefOid: 'a'.repeat(40),
          lastOutcome: 'failing',
          flakedOnCommit: true,
          updatedAt: new Date(t0).toISOString(),
        },
      },
      stats: {
        'acme/app::old': {
          repository: 'acme/app',
          checkName: 'old',
          flakeCount: 3,
          lastFlakedAt: new Date(t0).toISOString(),
          recentPrKeys: ['acme/app#1'],
        },
      },
    };

    const later = t0 + 20 * 24 * 60 * 60_000;
    const updated = updateFlakeTracker(staleState, [], { nowMs: later });
    expect(updated.changed).toBe(true);
    expect(Object.keys(updated.nextState.observations)).toHaveLength(0);
    expect(Object.keys(updated.nextState.stats)).toHaveLength(0);
  });
});
