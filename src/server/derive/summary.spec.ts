import { describe, expect, it } from 'vitest';
import { deriveBlockerSummary, type SummaryInput } from '@/server/derive/summary';

function makeSummaryInput(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    isDraft: false,
    sources: ['authored'],
    bucket: 'waiting',
    ci: { state: 'passing', passing: 3, failing: [], pending: 0, hiddenCount: 0 },
    review: { decision: 'none', approvals: [], changesRequested: [], pending: [] },
    merge: { state: 'clean', source: 'fresh' },
    autoMerge: false,
    mergeQueue: null,
    idleDays: 0,
    ...overrides,
  };
}

describe('derive/summary table', () => {
  it.each<{
    label: string;
    input: SummaryInput;
    expectedParts: string[];
    forbiddenParts?: string[];
  }>([
    {
      label: 'CI failing + conflict + blocked by review',
      input: makeSummaryInput({
        bucket: 'needs-me',
        ci: {
          state: 'failing',
          passing: 1,
          failing: [
            { name: 'unit', url: '#' },
            { name: 'lint', url: '#' },
          ],
          pending: 0,
          hiddenCount: 0,
        },
        merge: { state: 'conflicting', source: 'fresh' },
        review: { decision: 'required', approvals: [], changesRequested: [], pending: [] },
      }),
      expectedParts: ['CI 2 failing', 'conflict with base', 'review required'],
    },
    {
      label: 'truncated failing CI past 30-context cap',
      input: makeSummaryInput({
        bucket: 'needs-me',
        ci: { state: 'failing', passing: 30, failing: [], pending: 0, hiddenCount: 5 },
      }),
      expectedParts: ['CI failing (see details)'],
    },
    {
      label: 'merge queue position',
      input: makeSummaryInput({
        bucket: 'waiting',
        merge: { state: 'queued', source: 'fresh' },
        mergeQueue: { position: 2, state: 'AWAITING_CHECKS', estimatedTimeToMerge: 180 },
      }),
      expectedParts: ['In merge queue (#2)', 'CI passing ✓'],
    },
    {
      label: 'auto-merge enabled',
      input: makeSummaryInput({
        bucket: 'waiting',
        autoMerge: true,
      }),
      expectedParts: ['CI passing ✓', 'mergeable (auto-merge on)'],
    },
    {
      label: 'unknown mergeability renders merge ?',
      input: makeSummaryInput({
        bucket: 'waiting',
        merge: { state: 'unknown', source: 'unknown' },
      }),
      expectedParts: ['merge ?'],
    },
    {
      label: 'approved waiting on reviewer with idle days',
      input: makeSummaryInput({
        bucket: 'waiting',
        merge: { state: 'blocked', source: 'fresh' },
        review: {
          decision: 'approved',
          approvals: ['leo'],
          changesRequested: [],
          pending: ['ana'],
        },
        idleDays: 4,
      }),
      expectedParts: ['Approved ✓', 'waiting on @ana', '4d since update'],
    },
    {
      label: 'draft with no review requested',
      input: makeSummaryInput({
        isDraft: true,
        bucket: 'draft',
        merge: { state: 'draft', source: 'fresh' },
      }),
      expectedParts: ['Draft', 'CI passing ✓', 'no review requested'],
    },
    {
      label: 'behind-base draft includes behind base in summary',
      input: makeSummaryInput({
        isDraft: true,
        bucket: 'draft',
        merge: { state: 'behind', source: 'fresh' },
      }),
      expectedParts: ['Draft', 'CI passing ✓', 'behind base', 'no review requested'],
    },
    {
      label: 'team review request',
      input: makeSummaryInput({
        sources: ['review-requested'],
        bucket: 'needs-me',
        review: {
          decision: 'required',
          requestKind: 'team',
          approvals: [],
          changesRequested: [],
          pending: ['@fe'],
        },
        merge: { state: 'blocked', source: 'fresh' },
      }),
      expectedParts: ['Team review requested', 'blocked by review'],
      forbiddenParts: ['Your review requested'],
    },
    {
      label: 'direct review request omits viewer from waiting on list while keeping others',
      input: makeSummaryInput({
        sources: ['review-requested'],
        bucket: 'needs-me',
        viewerLogin: 'vampaz',
        review: {
          decision: 'required',
          requestKind: 'direct',
          approvals: [],
          changesRequested: [],
          pending: ['ana', 'vampaz'],
        },
        merge: { state: 'blocked', source: 'fresh' },
      }),
      expectedParts: ['Your review requested', 'waiting on @ana'],
      forbiddenParts: ['waiting on @vampaz', '@vampaz'],
    },
    {
      label:
        'direct review request omits waiting on entirely when viewer is the sole pending reviewer',
      input: makeSummaryInput({
        sources: ['review-requested'],
        bucket: 'needs-me',
        viewerLogin: 'vampaz',
        review: {
          decision: 'required',
          requestKind: 'direct',
          approvals: [],
          changesRequested: [],
          pending: ['Vampaz'],
        },
        merge: { state: 'blocked', source: 'fresh' },
      }),
      expectedParts: ['Your review requested', 'blocked by review'],
      forbiddenParts: ['waiting on'],
    },
  ])('$label', ({ input, expectedParts, forbiddenParts = [] }) => {
    const sentence = deriveBlockerSummary(input);
    for (const part of expectedParts) {
      expect(sentence).toContain(part);
    }
    for (const forbidden of forbiddenParts) {
      expect(sentence).not.toContain(forbidden);
    }
  });
});
