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

  it('uses fresh cached mergeable value for matching headRefOid (<=15m) without probing', async () => {
    const store = await makeStore();
    await store.setMergeability('acme/core-api#201', {
      headRefOid: fixtureUnknownMergeable.headRefOid,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checkedAt: new Date(FIXTURE_NOW_MS - 5 * 60_000).toISOString(),
    });
    const probeFn = vi.fn<ProbeFn>();

    const res = await resolveMergeability(fixtureUnknownMergeable, {
      stateStore: store,
      probeFn,
      nowMs: FIXTURE_NOW_MS,
    });
    expect(res.merge.state).toBe('clean');
    expect(res.merge.source).toBe('cached');
    expect(probeFn).not.toHaveBeenCalled();
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

  it('enforces the max 2 probes per hour per headRefOid and max 5 probes per refresh', async () => {
    const store = await makeStore();
    const probeFn = vi.fn<ProbeFn>().mockResolvedValue({
      status: 'ok',
      mergeable: null,
      mergeableState: 'unknown',
      coreRateLimit: null,
    });

    await resolveMergeability(fixtureUnknownMergeable, {
      stateStore: store,
      probeFn,
      nowMs: FIXTURE_NOW_MS,
    });
    await resolveMergeability(fixtureUnknownMergeable, {
      stateStore: store,
      probeFn,
      nowMs: FIXTURE_NOW_MS + 1000,
    });
    await resolveMergeability(fixtureUnknownMergeable, {
      stateStore: store,
      probeFn,
      nowMs: FIXTURE_NOW_MS + 2000,
    });

    expect(probeFn).toHaveBeenCalledTimes(2);

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
    expect(probeFn).toHaveBeenCalledTimes(7); // 2 + 5
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
});
