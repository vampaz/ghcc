import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type MergeabilityContext, resolveMergeability } from '@/server/derive/mergeability';
import {
  FIXTURE_NOW_MS,
  fixtureUnknownMergeable,
  makeBaseRawPr,
} from '@/server/derive/__fixtures__/pull-requests';
import { StateStore } from '@/server/state-store';

type ProbeFn = NonNullable<MergeabilityContext['probeFn']>;

describe('derive/mergeability', () => {
  const dirs: string[] = [];

  async function makeStore(): Promise<StateStore> {
    const dir = await mkdtemp(join(tmpdir(), 'ghcc-merge-'));
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

  it('persists fresh GraphQL mergeable values under headRefOid', async () => {
    const store = await makeStore();
    const raw = makeBaseRawPr({
      headRefOid: 'sha-fresh',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
    });
    const probeFn = vi.fn<ProbeFn>();

    const res = await resolveMergeability(raw, {
      stateStore: store,
      probeFn,
      nowMs: FIXTURE_NOW_MS,
    });
    expect(res.merge).toEqual({
      state: 'clean',
      source: 'fresh',
      checkedAt: '2026-11-24T12:00:00.000Z',
    });
    expect(probeFn).not.toHaveBeenCalled();

    const cached = await store.getMergeability('acme/web-app#101');
    expect(cached?.headRefOid).toBe('sha-fresh');
    expect(cached?.mergeable).toBe('MERGEABLE');
  });

  it('uses fresh cached mergeable value for matching (headRefOid, baseRefOid) (<=3m) without probing', async () => {
    const store = await makeStore();
    await store.setMergeability('acme/core-api#201', {
      headRefOid: fixtureUnknownMergeable.headRefOid,
      baseRefOid: 'base-sha-v1',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checkedAt: new Date(FIXTURE_NOW_MS - 2 * 60_000).toISOString(),
    });
    const probeFn = vi.fn<ProbeFn>();

    const res = await resolveMergeability(
      { ...fixtureUnknownMergeable, baseRefOid: 'base-sha-v1' },
      {
        stateStore: store,
        probeFn,
        nowMs: FIXTURE_NOW_MS,
      },
    );
    expect(res.merge.state).toBe('clean');
    expect(res.merge.source).toBe('cached');
    expect(probeFn).not.toHaveBeenCalled();
  });

  it('invalidates cached mergeability and ETag when baseRefOid advances or bypassCache is true', async () => {
    const store = await makeStore();
    await store.setMergeability('acme/core-api#201', {
      headRefOid: fixtureUnknownMergeable.headRefOid,
      baseRefOid: 'base-sha-v1',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checkedAt: new Date(FIXTURE_NOW_MS - 30_000).toISOString(),
      etag: '"etag-old-base"',
    });

    const probeFn = vi
      .fn<ProbeFn>()
      .mockResolvedValueOnce({
        status: 'ok',
        mergeable: false,
        mergeableState: 'dirty',
        etag: '"etag-new-base"',
        coreRateLimit: null,
      })
      .mockResolvedValueOnce({
        status: 'ok',
        mergeable: true,
        mergeableState: 'behind',
        etag: '"etag-manual"',
        coreRateLimit: null,
      });

    // Base branch moved -> must not reuse old CLEAN cache or stale ETag
    const afterBaseMove = await resolveMergeability(
      { ...fixtureUnknownMergeable, baseRefOid: 'base-sha-v2' },
      {
        stateStore: store,
        probeFn,
        nowMs: FIXTURE_NOW_MS,
      },
    );
    expect(probeFn).toHaveBeenNthCalledWith(1, 'acme', 'core-api', 201, undefined);
    expect(afterBaseMove.merge.state).toBe('conflicting');
    expect(afterBaseMove.merge.source).toBe('probe');

    // bypassCache: true forces a REST probe even within 3m TTL using current ETag
    const afterBypass = await resolveMergeability(
      { ...fixtureUnknownMergeable, baseRefOid: 'base-sha-v2' },
      {
        stateStore: store,
        probeFn,
        nowMs: FIXTURE_NOW_MS + 15_000,
        bypassCache: true,
      },
    );
    expect(probeFn).toHaveBeenNthCalledWith(2, 'acme', 'core-api', 201, '"etag-new-base"');
    expect(afterBypass.merge.state).toBe('behind');
    expect(afterBypass.merge.source).toBe('probe');
  });

  it('probes REST when headRefOid changes or cache expires, and handles null benignly', async () => {
    const store = await makeStore();
    await store.setMergeability('acme/core-api#201', {
      headRefOid: 'old-head-sha',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checkedAt: new Date(FIXTURE_NOW_MS - 2 * 60_000).toISOString(),
      etag: '"stale-etag"',
    });

    const probeFn = vi
      .fn<ProbeFn>()
      .mockResolvedValueOnce({
        status: 'ok',
        mergeable: null,
        mergeableState: 'unknown',
        coreRateLimit: null,
      })
      .mockResolvedValueOnce({
        status: 'ok',
        mergeable: false,
        mergeableState: 'dirty',
        etag: '"new-etag"',
        coreRateLimit: null,
      });

    // First probe returns null -> benign fallback to unknown (not old head's cached value!)
    const first = await resolveMergeability(fixtureUnknownMergeable, {
      stateStore: store,
      probeFn,
      nowMs: FIXTURE_NOW_MS,
    });
    expect(first.merge).toEqual({ state: 'unknown', source: 'unknown' });
    // Should not send stale ETag from old headRefOid.
    expect(probeFn).toHaveBeenNthCalledWith(1, 'acme', 'core-api', 201, undefined);

    // Second probe within the hourly cap of 2 succeeds and persists conflicting state.
    const second = await resolveMergeability(fixtureUnknownMergeable, {
      stateStore: store,
      probeFn,
      nowMs: FIXTURE_NOW_MS + 30_000,
    });
    expect(second.merge.state).toBe('conflicting');
    expect(second.merge.source).toBe('probe');
  });

  it('enforces the max 6 probes per hour per headRefOid and max 5 probes per refresh', async () => {
    const store = await makeStore();
    const probeFn = vi.fn<ProbeFn>().mockResolvedValue({
      status: 'ok',
      mergeable: null,
      mergeableState: 'unknown',
      coreRateLimit: null,
    });

    for (let i = 0; i < 7; i++) {
      await resolveMergeability(fixtureUnknownMergeable, {
        stateStore: store,
        probeFn,
        nowMs: FIXTURE_NOW_MS + i * 1000,
      });
    }

    expect(probeFn).toHaveBeenCalledTimes(6);

    // Refresh-level budget of 5 shared across PRs:
    const budget = { remaining: 5 };
    for (let i = 1; i <= 7; i++) {
      const pr = makeBaseRawPr({
        id: `PR_cap_${i}`,
        number: 500 + i,
        headRefOid: `sha-cap-${i}`,
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'UNKNOWN',
      });
      await resolveMergeability(pr, {
        stateStore: store,
        probeFn,
        nowMs: FIXTURE_NOW_MS,
        probeBudget: budget,
      });
    }
    expect(probeFn).toHaveBeenCalledTimes(11); // 6 + 5
  });

  it('refreshes checkedAt on 304 Not Modified when cached value exists for same headRefOid', async () => {
    const store = await makeStore();
    await store.setMergeability('acme/core-api#201', {
      headRefOid: fixtureUnknownMergeable.headRefOid,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checkedAt: new Date(FIXTURE_NOW_MS - 20 * 60_000).toISOString(),
      etag: '"etag-201"',
    });

    const probeFn = vi.fn<ProbeFn>().mockResolvedValueOnce({
      status: 'not-modified',
      coreRateLimit: null,
    });

    const res = await resolveMergeability(fixtureUnknownMergeable, {
      stateStore: store,
      probeFn,
      nowMs: FIXTURE_NOW_MS,
    });
    expect(probeFn).toHaveBeenCalledWith('acme', 'core-api', 201, '"etag-201"');
    expect(res.merge).toEqual({
      state: 'clean',
      source: 'cached',
      checkedAt: '2026-11-24T12:00:00.000Z',
    });
  });

  it('preserves behind merge state for non-conflicting draft PRs while keeping other drafts as draft', async () => {
    const store = await makeStore();
    const probeFn = vi.fn<ProbeFn>().mockResolvedValueOnce({
      status: 'ok',
      mergeable: true,
      mergeableState: 'behind',
      etag: '"etag-draft-behind"',
      coreRateLimit: null,
    });

    const behindDraft = await resolveMergeability(
      makeBaseRawPr({
        id: 'PR_draft_behind',
        number: 601,
        isDraft: true,
        headRefOid: 'sha-draft-behind',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BEHIND',
      }),
      { stateStore: store, probeFn, nowMs: FIXTURE_NOW_MS },
    );
    expect(behindDraft.merge.state).toBe('behind');
    expect(behindDraft.merge.source).toBe('fresh');

    const conflictingBehindDraft = await resolveMergeability(
      makeBaseRawPr({
        id: 'PR_draft_conflict',
        number: 602,
        isDraft: true,
        headRefOid: 'sha-draft-conflict',
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'BEHIND',
      }),
      { stateStore: store, probeFn, nowMs: FIXTURE_NOW_MS },
    );
    expect(conflictingBehindDraft.merge.state).toBe('draft');

    const upToDateDraft = await resolveMergeability(
      makeBaseRawPr({
        id: 'PR_draft_clean',
        number: 603,
        isDraft: true,
        headRefOid: 'sha-draft-clean',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
      }),
      { stateStore: store, probeFn, nowMs: FIXTURE_NOW_MS },
    );
    expect(upToDateDraft.merge.state).toBe('draft');

    const probedBehindDraft = await resolveMergeability(
      makeBaseRawPr({
        id: 'PR_draft_probe',
        number: 604,
        isDraft: true,
        headRefOid: 'sha-draft-probe',
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'UNKNOWN',
      }),
      { stateStore: store, probeFn, nowMs: FIXTURE_NOW_MS },
    );
    expect(probedBehindDraft.merge.state).toBe('behind');
    expect(probedBehindDraft.merge.source).toBe('probe');

    const comparedBehindDraft = await resolveMergeability(
      makeBaseRawPr({
        id: 'PR_draft_compared_behind',
        number: 605,
        isDraft: true,
        headRefOid: 'sha-draft-compared',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'BLOCKED',
      }),
      { stateStore: store, probeFn, nowMs: FIXTURE_NOW_MS, isBehindBase: true },
    );
    expect(comparedBehindDraft.merge.state).toBe('behind');

    const dirtyComparedDraft = await resolveMergeability(
      makeBaseRawPr({
        id: 'PR_draft_dirty_compared',
        number: 606,
        isDraft: true,
        headRefOid: 'sha-draft-dirty',
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'DIRTY',
      }),
      { stateStore: store, nowMs: FIXTURE_NOW_MS, isBehindBase: true },
    );
    expect(dirtyComparedDraft.merge.state).toBe('draft');
  });
});
