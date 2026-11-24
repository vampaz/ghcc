import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StateStore } from '@/server/state-store';

describe('StateStore', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('persists mergeability atomically and reloads from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghcc-state-'));
    dirs.push(dir);
    const filePath = join(dir, 'nested', 'state.json');

    const store = new StateStore(filePath);
    await store.setMergeability('acme/app#12', {
      headRefOid: 'abc123',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checkedAt: '2026-11-24T12:00:00.000Z',
      etag: '"etag-1"',
    });

    const files = await readdir(join(dir, 'nested'));
    expect(files).toEqual(['state.json']);

    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    expect(raw.version).toBe(1);
    expect(raw.mergeability['acme/app#12'].mergeable).toBe('MERGEABLE');

    const secondStore = new StateStore(filePath);
    const loaded = await secondStore.getMergeability('acme/app#12');
    expect(loaded).toEqual({
      headRefOid: 'abc123',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checkedAt: '2026-11-24T12:00:00.000Z',
      etag: '"etag-1"',
    });
  });

  it('tracks per-hour probe counts keyed by headRefOid and prunes stale entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ghcc-probes-'));
    dirs.push(dir);
    const store = new StateStore(join(dir, 'state.json'));

    const t0 = Date.parse('2026-11-24T10:00:00.000Z');
    await store.recordProbeAttempt('acme/app#5', 'sha-1', new Date(t0).toISOString());
    await store.recordProbeAttempt('acme/app#5', 'sha-1', new Date(t0 + 20 * 60_000).toISOString());

    expect(await store.getRecentProbeCount('acme/app#5', 'sha-1', t0 + 30 * 60_000)).toBe(2);
    // Past 1 hour, first timestamp expires.
    expect(await store.getRecentProbeCount('acme/app#5', 'sha-1', t0 + 65 * 60_000)).toBe(1);
    // New headRefOid resets counter.
    expect(await store.getRecentProbeCount('acme/app#5', 'sha-2', t0 + 30 * 60_000)).toBe(0);
  });
});
