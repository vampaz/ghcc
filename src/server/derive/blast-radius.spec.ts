// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { annotateFileOverlaps } from '@/server/derive/blast-radius';
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
    headRefOid: 'a'.repeat(40),
    isDraft: false,
    labels: [],
    sources: ['authored'],
    bucket: 'ready',
    myAction: 'merge',
    blockers: [],
    ci: { state: 'passing', passing: 1, failing: [], pending: 0, hiddenCount: 0 },
    review: { decision: 'approved', approvals: ['bob'], changesRequested: [], pending: [] },
    merge: { state: 'clean', source: 'fresh' },
    autoMerge: false,
    autoMergeMethod: null,
    mergeQueue: null,
    size: { additions: 10, deletions: 2, files: 2 },
    createdAt: '2026-11-24T10:00:00Z',
    updatedAt: '2026-11-24T11:00:00Z',
    lastCommittedAt: '2026-11-24T11:00:00Z',
    ageDays: 1,
    idleDays: 0,
    blockerSummary: 'CI passing',
    ...overrides,
  };
}

describe('annotateFileOverlaps', () => {
  it('detects same-repo file overlaps, prioritizes source files over lockfiles, and ignores other repos', () => {
    const pr1 = makePr({ key: 'acme/app#1', number: 1, title: 'feat: auth', author: 'alice' });
    const pr2 = makePr({ key: 'acme/app#2', number: 2, title: 'fix: session', author: 'bob' });
    const prOtherRepo = makePr({
      key: 'acme/other#3',
      repo: 'other',
      repository: 'acme/other',
      number: 3,
      title: 'chore: unrelated',
    });

    const files = new Map<string, string[]>([
      ['acme/app#1', ['package-lock.json', 'src/auth.ts', 'src/only-1.ts']],
      ['acme/app#2', ['package-lock.json', 'src/auth.ts', 'src/only-2.ts']],
      ['acme/other#3', ['src/auth.ts']],
    ]);

    const result = annotateFileOverlaps([pr1, pr2, prOtherRepo], files);
    const r1 = result.find((p) => p.key === 'acme/app#1')!;
    const r2 = result.find((p) => p.key === 'acme/app#2')!;
    const r3 = result.find((p) => p.key === 'acme/other#3')!;

    expect(r1.overlaps).toEqual([
      {
        prKey: 'acme/app#2',
        number: 2,
        title: 'fix: session',
        author: 'bob',
        isDraft: false,
        sharedFiles: ['src/auth.ts', 'package-lock.json'],
        sharedCount: 2,
      },
    ]);
    expect(r2.overlaps).toHaveLength(1);
    expect(r2.overlaps![0]!.prKey).toBe('acme/app#1');
    expect(r3.overlaps).toBeUndefined();
  });

  it('excludes stacked parent/child pairs from false-positive overlap warnings', () => {
    const parent = makePr({
      key: 'acme/app#1',
      number: 1,
      mission: {
        id: 'stack:acme/app#1',
        label: 'Stack',
        ticketKeys: [],
        peerCount: 1,
        stackChildKeys: ['acme/app#2'],
      },
    });
    const child = makePr({
      key: 'acme/app#2',
      number: 2,
      mission: {
        id: 'stack:acme/app#1',
        label: 'Stack',
        ticketKeys: [],
        peerCount: 1,
        stackParentKey: 'acme/app#1',
      },
    });
    const files = new Map<string, string[]>([
      ['acme/app#1', ['src/shared.ts']],
      ['acme/app#2', ['src/shared.ts']],
    ]);

    const result = annotateFileOverlaps([parent, child], files);
    expect(result[0]!.overlaps).toBeUndefined();
    expect(result[1]!.overlaps).toBeUndefined();
  });
});
