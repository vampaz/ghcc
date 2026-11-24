import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeCounts,
  mergeRawPullRequests,
  normalizePullRequests,
} from '@/server/derive/normalize';
import {
  FIXTURE_NOW_MS,
  VIEWER_LOGIN,
  fixtureAutoMerge,
  fixtureBlockedReviewRequired,
  fixtureConflictingDraft,
  fixtureDirectReviewRequest,
  fixtureDraftChangesRequested,
  fixtureMergeQueue,
  fixtureNoCiRollup,
  fixtureNullReviewDecisionTwoApprovals,
  fixtureTeamReviewRequest,
  fixtureTruncatedFailingCi,
  fixtureUnknownMergeable,
} from '@/server/derive/__fixtures__/pull-requests';
import { StateStore } from '@/server/state-store';

describe('derive/normalize fixtures', () => {
  const dirs: string[] = [];

  async function makeStore(): Promise<StateStore> {
    const dir = await mkdtemp(join(tmpdir(), 'ghcc-norm-'));
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

  it('deduplicates PRs present in both authored and review-requested queues preserving both sources', () => {
    const merged = mergeRawPullRequests(
      [fixtureAutoMerge],
      [fixtureAutoMerge, fixtureDirectReviewRequest],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]!.sources).toEqual(['authored', 'review-requested']);
    expect(merged[1]!.sources).toEqual(['review-requested']);
  });

  it('normalizes all mandatory §11 fixtures into expected buckets, actions, and summaries', async () => {
    const store = await makeStore();
    const authored = [
      fixtureUnknownMergeable,
      fixtureNoCiRollup,
      fixtureTruncatedFailingCi,
      fixtureNullReviewDecisionTwoApprovals,
      fixtureBlockedReviewRequired,
      fixtureAutoMerge,
      fixtureMergeQueue,
      fixtureConflictingDraft,
      fixtureDraftChangesRequested,
    ];
    const reviewRequested = [fixtureDirectReviewRequest, fixtureTeamReviewRequest];
    const merged = mergeRawPullRequests(authored, reviewRequested);

    const { pullRequests } = await normalizePullRequests(merged, {
      viewerLogin: VIEWER_LOGIN,
      stateStore: store,
      nowMs: FIXTURE_NOW_MS,
    });

    const byKey = new Map(pullRequests.map((pr) => [pr.key, pr]));

    // Unknown mergeable
    const unknownPr = byKey.get('acme/core-api#201')!;
    expect(unknownPr.merge).toEqual({ state: 'unknown', source: 'unknown' });
    expect(unknownPr.blockerSummary).toContain('merge ?');

    // No CI at all -> ready still reachable
    const noCiPr = byKey.get('acme/docs#202')!;
    expect(noCiPr.ci.state).toBe('none');
    expect(noCiPr.bucket).toBe('ready');
    expect(noCiPr.myAction).toBe('merge');

    // Truncated failing checks -> needs-me + CI failing (see details)
    const truncPr = byKey.get('acme/worker#203')!;
    expect(truncPr.ci.state).toBe('failing');
    expect(truncPr.ci.hiddenCount).toBe(5);
    expect(truncPr.bucket).toBe('needs-me');
    expect(truncPr.blockerSummary).toContain('CI failing (see details)');

    // reviewDecision: null with two approvals -> ready + Approved ✓
    const nullDecPr = byKey.get('vampaz/tools#204')!;
    expect(nullDecPr.review.decision).toBe('none');
    expect(nullDecPr.review.approvals).toEqual(['ana', 'leo']);
    expect(nullDecPr.bucket).toBe('ready');
    expect(nullDecPr.blockerSummary).toContain('Approved ✓');

    // mergeStateStatus: BLOCKED + REVIEW_REQUIRED -> waiting, sorted by idleDays
    const blockedPr = byKey.get('acme/core-api#205')!;
    expect(blockedPr.bucket).toBe('waiting');
    expect(blockedPr.idleDays).toBe(4);
    expect(blockedPr.blockerSummary).toContain('blocked by review');
    expect(blockedPr.blockerSummary).toContain('4d since update');

    // Direct vs team-only review request
    const directPr = byKey.get('acme/core-api#301')!;
    expect(directPr.bucket).toBe('needs-me');
    expect(directPr.review.requestKind).toBe('direct');
    expect(directPr.blockerSummary).toContain('Your review requested');

    const teamPr = byKey.get('acme/web-app#302')!;
    expect(teamPr.bucket).toBe('needs-me');
    expect(teamPr.review.requestKind).toBe('team');
    expect(teamPr.blockerSummary).toContain('Team review requested');

    // Auto-merge -> waiting
    const autoPr = byKey.get('acme/web-app#206')!;
    expect(autoPr.bucket).toBe('waiting');
    expect(autoPr.autoMerge).toBe(true);
    expect(autoPr.blockerSummary).toContain('auto-merge on');

    // Merge queue -> waiting
    const mqPr = byKey.get('acme/core-api#207')!;
    expect(mqPr.bucket).toBe('waiting');
    expect(mqPr.merge.state).toBe('queued');
    expect(mqPr.blockerSummary).toContain('In merge queue (#2)');

    // Conflicting draft vs draft with changes requested
    const conflictDraft = byKey.get('acme/worker#208')!;
    expect(conflictDraft.bucket).toBe('draft');
    const changesDraft = byKey.get('acme/core-api#209')!;
    expect(changesDraft.bucket).toBe('needs-me');

    const counts = computeCounts(pullRequests);
    expect(counts).toEqual({
      needsMe: 4, // truncPr, directPr, teamPr, changesDraft
      ready: 2, // noCiPr, nullDecPr
      waiting: 4, // unknownPr, blockedPr, autoPr, mqPr
      draft: 1, // conflictDraft
    });
  });
});
