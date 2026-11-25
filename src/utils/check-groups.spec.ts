import { describe, expect, it } from 'vitest';
import type { PrDetailCheck } from '@/types/pr';
import { groupDetailChecks } from '@/utils/check-groups';

function makeCheck(
  name: string,
  bucket: PrDetailCheck['bucket'],
  kind: PrDetailCheck['kind'] = 'CheckRun',
): PrDetailCheck {
  return {
    name,
    kind,
    status: bucket === 'pending' ? 'IN_PROGRESS' : 'COMPLETED',
    conclusion: bucket === 'failing' ? 'FAILURE' : bucket === 'passing' ? 'SUCCESS' : null,
    bucket,
    url: `https://example.test/${encodeURIComponent(name)}`,
    description: null,
    startedAt: null,
    completedAt: null,
  };
}

describe('groupDetailChecks', () => {
  it('returns an empty list for zero checks', () => {
    expect(groupDetailChecks([])).toEqual([]);
  });

  it('groups Vercel prefixes, sharded coverage checks, and singletons into Other with natural sorting', () => {
    const checks: PrDetailCheck[] = [
      makeCheck('owned-elements', 'pending'),
      makeCheck('Advisory deployment assessment', 'passing'),
      makeCheck('cancel-previous', 'passing'),
      makeCheck('check-index', 'passing'),
      makeCheck('coverage (3)', 'pending'),
      makeCheck('coverage (1)', 'pending'),
      makeCheck('coverage (4)', 'pending'),
      makeCheck('coverage (2)', 'pending'),
      makeCheck('Vercel – notes-auditor-aux-10', 'passing', 'StatusContext'),
      makeCheck('Vercel – notes-auditor-aux-2', 'passing', 'StatusContext'),
      makeCheck('Vercel – notes-auditor-aux-9', 'pending', 'StatusContext'),
      makeCheck('Vercel – notes-auditor-aux-1', 'passing', 'StatusContext'),
      makeCheck('Vercel – staging', 'passing', 'StatusContext'),
    ];

    const groups = groupDetailChecks(checks);
    expect(groups.map((g) => g.label)).toEqual(['Vercel', 'coverage', 'Other']);

    const vercel = groups[0]!;
    expect(vercel.bucket).toBe('pending');
    expect(vercel.defaultOpen).toBe(true);
    expect(vercel.pendingCount).toBe(1);
    expect(vercel.passingCount).toBe(4);
    expect(vercel.items.map((i) => i.displayName)).toEqual([
      'notes-auditor-aux-9',
      'notes-auditor-aux-1',
      'notes-auditor-aux-2',
      'notes-auditor-aux-10',
      'staging',
    ]);

    const coverage = groups[1]!;
    expect(coverage.bucket).toBe('pending');
    expect(coverage.defaultOpen).toBe(true);
    expect(coverage.pendingCount).toBe(4);
    expect(coverage.items.map((i) => i.displayName)).toEqual([
      'coverage (1)',
      'coverage (2)',
      'coverage (3)',
      'coverage (4)',
    ]);

    const other = groups[2]!;
    expect(other.isOther).toBe(true);
    expect(other.bucket).toBe('pending');
    expect(other.defaultOpen).toBe(true);
    expect(other.items.map((i) => i.displayName)).toEqual([
      'owned-elements',
      'Advisory deployment assessment',
      'cancel-previous',
      'check-index',
    ]);
  });

  it('orders failing groups first and collapses all-passing groups by default', () => {
    const checks: PrDetailCheck[] = [
      makeCheck('Vercel – preview', 'passing'),
      makeCheck('Vercel – staging', 'passing'),
      makeCheck('codecov/patch', 'failing'),
      makeCheck('codecov/project', 'passing'),
      makeCheck('lint: eslint', 'passing'),
    ];

    const groups = groupDetailChecks(checks);
    expect(groups.map((g) => ({ label: g.label, bucket: g.bucket, open: g.defaultOpen }))).toEqual([
      { label: 'codecov', bucket: 'failing', open: true },
      { label: 'Vercel', bucket: 'passing', open: false },
      { label: 'Other', bucket: 'passing', open: false },
    ]);

    // Singletons like "lint: eslint" are NOT split into a 1-item named group
    expect(groups[2]!.items.map((i) => i.displayName)).toEqual(['lint: eslint']);
  });
});
