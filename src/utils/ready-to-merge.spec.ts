import { describe, expect, it } from 'vitest';
import type { PrView } from '@/types/pr';
import { isPrReadyToMerge } from '@/utils/ready-to-merge';

function makePr(overrides: Partial<PrView> = {}): PrView {
  return {
    key: 'acme/web-app#202',
    owner: 'acme',
    repo: 'web-app',
    repository: 'acme/web-app',
    number: 202,
    title: 'feat: ready pr',
    url: 'https://github.com/acme/web-app/pull/202',
    author: 'vampaz',
    baseRefName: 'main',
    headRefName: 'feat/ready',
    headRefOid: '1234567890abcdef1234567890abcdef12345678',
    isDraft: false,
    labels: [],
    sources: ['authored'],
    bucket: 'ready',
    myAction: 'merge',
    blockers: [],
    ci: { state: 'passing', passing: 4, failing: [], pending: 0, hiddenCount: 0 },
    review: { decision: 'approved', approvals: ['ana'], changesRequested: [], pending: [] },
    merge: { state: 'clean', source: 'fresh' },
    autoMerge: false,
    autoMergeMethod: null,
    mergeQueue: null,
    size: { additions: 10, deletions: 2, files: 1 },
    createdAt: '2026-11-23T09:00:00.000Z',
    updatedAt: '2026-11-24T11:00:00.000Z',
    lastCommittedAt: '2026-11-24T10:00:00.000Z',
    ageDays: 1,
    idleDays: 0,
    blockerSummary: 'CI passing ✓ · mergeable · Approved ✓',
    ...overrides,
  };
}

describe('isPrReadyToMerge', () => {
  it.each<{ label: string; pr: PrView; expected: boolean }>([
    {
      label: 'returns true for authored clean PR with passing CI and approval',
      pr: makePr(),
      expected: true,
    },
    {
      label: 'returns true for teammate repo PR that is clean with passing CI and approved',
      pr: makePr({
        author: 'leo',
        sources: ['repo'],
        bucket: 'waiting',
        myAction: 'none',
      }),
      expected: true,
    },
    {
      label: 'returns true for clean PR in repo with no CI checks and no required reviews',
      pr: makePr({
        ci: { state: 'none', passing: 0, failing: [], pending: 0, hiddenCount: 0 },
        review: { decision: 'none', approvals: [], changesRequested: [], pending: [] },
      }),
      expected: true,
    },
    {
      label: 'returns false for draft PR',
      pr: makePr({ isDraft: true, bucket: 'draft', merge: { state: 'draft', source: 'fresh' } }),
      expected: false,
    },
    {
      label: 'returns false when CI is failing even if merge state is clean (UNSTABLE)',
      pr: makePr({
        ci: {
          state: 'failing',
          passing: 1,
          failing: [{ name: 'unit', url: '#' }],
          pending: 0,
          hiddenCount: 0,
        },
        blockers: ['ci-failing'],
      }),
      expected: false,
    },
    {
      label: 'returns false when CI is pending',
      pr: makePr({
        ci: { state: 'pending', passing: 1, failing: [], pending: 2, hiddenCount: 0 },
        blockers: ['ci-pending'],
      }),
      expected: false,
    },
    {
      label: 'returns false when review is still required',
      pr: makePr({
        review: { decision: 'required', approvals: [], changesRequested: [], pending: ['ana'] },
        blockers: ['review-required'],
      }),
      expected: false,
    },
    {
      label: 'returns false when changes are requested',
      pr: makePr({
        review: {
          decision: 'changes-requested',
          approvals: [],
          changesRequested: ['ana'],
          pending: [],
        },
        blockers: ['changes-requested'],
      }),
      expected: false,
    },
    {
      label: 'returns false when reviewers are requested and no approval exists yet',
      pr: makePr({
        review: { decision: 'none', approvals: [], changesRequested: [], pending: ['ana'] },
      }),
      expected: false,
    },
    {
      label: 'returns false for unapproved stacked PR targeting a non-mainline feature branch',
      pr: makePr({
        author: 'leo',
        sources: ['repo'],
        bucket: 'waiting',
        baseRefName: 'paris/be-525-parent-branch',
        review: { decision: 'none', approvals: [], changesRequested: [], pending: [] },
      }),
      expected: false,
    },
    {
      label:
        'returns true for approved stacked PR targeting a feature branch when CI is passing and CLEAN',
      pr: makePr({
        author: 'michele',
        sources: ['repo'],
        bucket: 'waiting',
        baseRefName: 'michele/be-564-parent-branch',
        review: {
          decision: 'approved',
          approvals: ['plysytsya'],
          changesRequested: [],
          pending: [],
        },
      }),
      expected: true,
    },
    {
      label: 'returns false when behind base, conflicting, blocked, or unknown mergeability',
      pr: makePr({ merge: { state: 'behind', source: 'fresh' }, blockers: ['behind-base'] }),
      expected: false,
    },
    {
      label: 'returns false when merge state is blocked by branch rule',
      pr: makePr({ merge: { state: 'blocked', source: 'fresh' }, blockers: ['blocked-unknown'] }),
      expected: false,
    },
    {
      label: 'returns false when auto-merge is enabled',
      pr: makePr({ autoMerge: true, bucket: 'waiting' }),
      expected: false,
    },
    {
      label: 'returns false when already in merge queue',
      pr: makePr({
        bucket: 'waiting',
        merge: { state: 'queued', source: 'fresh' },
        mergeQueue: { position: 1, state: 'AWAITING_CHECKS', estimatedTimeToMerge: 120 },
      }),
      expected: false,
    },
  ])('$label', ({ pr, expected }) => {
    expect(isPrReadyToMerge(pr)).toBe(expected);
  });
});
