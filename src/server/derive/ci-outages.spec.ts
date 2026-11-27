// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveCiOutages } from '@/server/derive/ci-outages';
import type { PrView } from '@/types/pr';

function makePr(overrides: Partial<PrView>): PrView {
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
    headRefOid: '1111111111111111111111111111111111111111',
    isDraft: false,
    labels: [],
    sources: ['repo'],
    bucket: 'needs-me',
    myAction: 'fix-ci',
    blockers: ['ci-failing'],
    ci: {
      state: 'failing',
      passing: 2,
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

describe('deriveCiOutages', () => {
  it('flags a shared outage when 3+ unrelated non-draft PRs in the same repo fail the same check', () => {
    const prs = [
      makePr({
        key: 'acme/app#1',
        number: 1,
        author: 'alice',
        headRefName: 'f1',
        headRefOid: 'a'.repeat(40),
      }),
      makePr({
        key: 'acme/app#2',
        number: 2,
        author: 'bob',
        headRefName: 'f2',
        headRefOid: 'b'.repeat(40),
      }),
      makePr({
        key: 'acme/app#3',
        number: 3,
        author: 'carol',
        headRefName: 'f3',
        headRefOid: 'c'.repeat(40),
      }),
    ];

    const outages = deriveCiOutages(prs);
    expect(outages).toHaveLength(1);
    expect(outages[0]).toEqual({
      id: 'acme/app::e2e',
      repository: 'acme/app',
      checkName: 'e2e',
      affectedCount: 3,
      affectedPrKeys: ['acme/app#1', 'acme/app#2', 'acme/app#3'],
      authors: ['alice', 'bob', 'carol'],
      sampleUrl: 'https://github.com/acme/app/runs/1',
    });
  });

  it('ignores draft PRs, stacked child PRs, and duplicate headRefOids', () => {
    const prs = [
      makePr({
        key: 'acme/app#1',
        number: 1,
        headRefName: 'stack-1',
        baseRefName: 'main',
        headRefOid: 'a'.repeat(40),
      }),
      // Stacked on stack-1
      makePr({
        key: 'acme/app#2',
        number: 2,
        headRefName: 'stack-2',
        baseRefName: 'stack-1',
        headRefOid: 'b'.repeat(40),
      }),
      // Stacked on stack-2
      makePr({
        key: 'acme/app#3',
        number: 3,
        headRefName: 'stack-3',
        baseRefName: 'stack-2',
        headRefOid: 'c'.repeat(40),
      }),
      // Draft PR
      makePr({
        key: 'acme/app#4',
        number: 4,
        isDraft: true,
        headRefName: 'draft-1',
        headRefOid: 'd'.repeat(40),
      }),
      // Unrelated second PR (total independent = 2 < 3)
      makePr({ key: 'acme/app#5', number: 5, headRefName: 'other', headRefOid: 'e'.repeat(40) }),
    ];

    expect(deriveCiOutages(prs)).toEqual([]);
  });

  it('does not mix checks across different repositories', () => {
    const prs = [
      makePr({ key: 'acme/a#1', repository: 'acme/a', repo: 'a', headRefOid: 'a'.repeat(40) }),
      makePr({ key: 'acme/a#2', repository: 'acme/a', repo: 'a', headRefOid: 'b'.repeat(40) }),
      makePr({ key: 'acme/b#1', repository: 'acme/b', repo: 'b', headRefOid: 'c'.repeat(40) }),
    ];

    expect(deriveCiOutages(prs)).toEqual([]);
  });
});
