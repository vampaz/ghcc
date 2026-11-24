import { describe, expect, it } from 'vitest';
import { deriveBucket, type BucketInput } from '@/server/derive/bucket';
import type { Bucket } from '@/types/pr';

function makeBucketInput(overrides: Partial<BucketInput> = {}): BucketInput {
  return {
    isDraft: false,
    sources: ['authored'],
    ci: { state: 'passing', passing: 2, failing: [], pending: 0, hiddenCount: 0 },
    review: { decision: 'approved', approvals: ['ana'], changesRequested: [], pending: [] },
    merge: { state: 'clean', source: 'fresh' },
    effectiveMergeStateStatus: 'CLEAN',
    autoMerge: false,
    mergeQueue: null,
    ...overrides,
  };
}

describe('derive/bucket precedence table', () => {
  it.each<{ label: string; input: BucketInput; expected: Bucket }>([
    {
      label: 'rule 1: draft PR with failing CI and conflicts stays in draft',
      input: makeBucketInput({
        isDraft: true,
        ci: {
          state: 'failing',
          passing: 0,
          failing: [{ name: 'test', url: '#' }],
          pending: 0,
          hiddenCount: 0,
        },
        merge: { state: 'conflicting', source: 'fresh' },
      }),
      expected: 'draft',
    },
    {
      label: 'rule 1 exception: draft PR with changes requested moves to needs-me',
      input: makeBucketInput({
        isDraft: true,
        review: {
          decision: 'changes-requested',
          approvals: [],
          changesRequested: ['ana'],
          pending: [],
        },
      }),
      expected: 'needs-me',
    },
    {
      label: 'rule 2a: authored PR with failing CI -> needs-me',
      input: makeBucketInput({
        ci: {
          state: 'failing',
          passing: 1,
          failing: [{ name: 'lint', url: '#' }],
          pending: 0,
          hiddenCount: 0,
        },
        effectiveMergeStateStatus: 'UNSTABLE',
      }),
      expected: 'needs-me',
    },
    {
      label: 'rule 2b: authored PR with conflict -> needs-me',
      input: makeBucketInput({
        merge: { state: 'conflicting', source: 'fresh' },
        effectiveMergeStateStatus: 'DIRTY',
      }),
      expected: 'needs-me',
    },
    {
      label: 'rule 2c: review-requested PR -> needs-me',
      input: makeBucketInput({
        sources: ['review-requested'],
        review: {
          decision: 'required',
          requestKind: 'team',
          approvals: [],
          changesRequested: [],
          pending: ['@fe'],
        },
        merge: { state: 'blocked', source: 'fresh' },
        effectiveMergeStateStatus: 'BLOCKED',
      }),
      expected: 'needs-me',
    },
    {
      label: 'rule 3a: authored, passing CI, CLEAN, auto-merge off -> ready',
      input: makeBucketInput(),
      expected: 'ready',
    },
    {
      label: 'rule 3b: authored, no CI (state=none), CLEAN -> ready',
      input: makeBucketInput({
        ci: { state: 'none', passing: 0, failing: [], pending: 0, hiddenCount: 0 },
        review: { decision: 'none', approvals: [], changesRequested: [], pending: [] },
      }),
      expected: 'ready',
    },
    {
      label: 'rule 4a: authored, CLEAN, auto-merge ON -> waiting',
      input: makeBucketInput({ autoMerge: true }),
      expected: 'waiting',
    },
    {
      label: 'rule 4b: authored, merge queue entry -> waiting',
      input: makeBucketInput({
        merge: { state: 'queued', source: 'fresh' },
        mergeQueue: { position: 2, state: 'AWAITING_CHECKS', estimatedTimeToMerge: 180 },
      }),
      expected: 'waiting',
    },
    {
      label:
        'rule 4c: authored, mergeStateStatus BLOCKED + REVIEW_REQUIRED -> waiting (never ready)',
      input: makeBucketInput({
        review: { decision: 'required', approvals: [], changesRequested: [], pending: ['ana'] },
        merge: { state: 'blocked', source: 'fresh' },
        effectiveMergeStateStatus: 'BLOCKED',
      }),
      expected: 'waiting',
    },
    {
      label: 'rule 4d: authored, CI pending -> waiting',
      input: makeBucketInput({
        ci: { state: 'pending', passing: 1, failing: [], pending: 1, hiddenCount: 0 },
        effectiveMergeStateStatus: 'BLOCKED',
      }),
      expected: 'waiting',
    },
  ])('$label', ({ input, expected }) => {
    expect(deriveBucket(input)).toBe(expected);
  });
});
