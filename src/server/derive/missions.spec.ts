// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveMissions, extractTicketKeys } from '@/server/derive/missions';
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
    bucket: 'needs-me',
    myAction: 'fix-ci',
    blockers: [],
    ci: { state: 'passing', passing: 1, failing: [], pending: 0, hiddenCount: 0 },
    review: { decision: 'approved', approvals: ['bob'], changesRequested: [], pending: [] },
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
    blockerSummary: 'CI passing',
    ...overrides,
  };
}

describe('extractTicketKeys', () => {
  it('extracts ticket keys from titles and branches while ignoring technical tokens', () => {
    expect(
      extractTicketKeys(
        'fix: exchange JWT via HTTP-2 using UTF-8 [SEC-16, FE-421]',
        'FE-421/fix-sha-256-session',
      ),
    ).toEqual(['FE-421', 'SEC-16']);
  });
});

describe('deriveMissions', () => {
  it('groups cross-repo PRs sharing a ticket key and respects Depends on FE merge order', () => {
    const fePr = makePr({
      key: 'acme/frontend#10',
      repo: 'frontend',
      repository: 'acme/frontend',
      number: 10,
      title: 'fix: redeem browser SSO codes [SEC-16]',
      headRefName: 'sec-16/fe',
      bucket: 'ready',
    });
    const bePr = makePr({
      key: 'acme/backend#20',
      repo: 'backend',
      repository: 'acme/backend',
      number: 20,
      title: 'fix(api): exchange browser SSO codes [SEC-16]',
      headRefName: 'sec-16/be',
      labels: [{ name: 'Depends on FE', color: 'a855f7', description: null }],
    });
    const soloPr = makePr({
      key: 'acme/backend#30',
      repo: 'backend',
      repository: 'acme/backend',
      number: 30,
      title: 'chore: unrelated [OPS-99]',
    });

    const result = deriveMissions([bePr, fePr, soloPr]);
    expect(result.missions).toHaveLength(1);
    const mission = result.missions[0]!;
    expect(mission.label).toBe('SEC-16');
    expect(mission.hasCrossRepo).toBe(true);
    expect(mission.hasStack).toBe(false);
    expect(mission.readyCount).toBe(1);
    expect(mission.prKeys).toEqual(['acme/frontend#10', 'acme/backend#20']);
    expect(mission.dependencyNotes).toEqual(['#20 waits on #10 (Depends on FE)']);

    const annotatedFe = result.pullRequests.find((p) => p.key === 'acme/frontend#10')!;
    const annotatedBe = result.pullRequests.find((p) => p.key === 'acme/backend#20')!;
    const annotatedSolo = result.pullRequests.find((p) => p.key === 'acme/backend#30')!;

    expect(annotatedFe.mission?.mergeOrder).toBe(1);
    expect(annotatedBe.mission?.mergeOrder).toBe(2);
    expect(annotatedBe.mission?.blockedByKeys).toEqual(['acme/frontend#10']);
    expect(annotatedSolo.mission).toBeUndefined();
  });

  it('detects stacked base-branch PRs in the same repo even without ticket keys', () => {
    const basePr = makePr({
      key: 'acme/app#1',
      number: 1,
      title: 'feat: part 1',
      baseRefName: 'main',
      headRefName: 'feat/auth-base',
    });
    const childPr = makePr({
      key: 'acme/app#2',
      number: 2,
      title: 'feat: part 2',
      baseRefName: 'feat/auth-base',
      headRefName: 'feat/auth-ui',
    });

    const result = deriveMissions([childPr, basePr]);
    expect(result.missions).toHaveLength(1);
    expect(result.missions[0]!.hasStack).toBe(true);
    expect(result.missions[0]!.prKeys).toEqual(['acme/app#1', 'acme/app#2']);

    const p1 = result.pullRequests.find((p) => p.key === 'acme/app#1')!;
    const p2 = result.pullRequests.find((p) => p.key === 'acme/app#2')!;
    expect(p1.mission?.stackChildKeys).toEqual(['acme/app#2']);
    expect(p2.mission?.stackParentKey).toBe('acme/app#1');
    expect(p2.mission?.mergeOrder).toBe(2);
  });
});
