// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runBulkAction, type BulkActionState } from '@/utils/bulk-runner';

describe('runBulkAction', () => {
  it('enforces bounded concurrency and tracks successes and partial failures', async () => {
    let active = 0;
    let peak = 0;
    const states: BulkActionState[] = [];

    const finalState = await runBulkAction({
      actionLabel: 'Syncing branches',
      items: [{ key: 'a#1' }, { key: 'a#2' }, { key: 'a#3' }, { key: 'a#4' }],
      concurrency: 2,
      isCancelled: () => false,
      onUpdate: (st) => states.push(st),
      execute: async (item) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        if (item.key === 'a#2') {
          return { ok: false, error: 'Merge conflict' };
        }
        return { ok: true };
      },
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(finalState).toEqual({
      status: 'done',
      actionLabel: 'Syncing branches',
      total: 4,
      completed: 4,
      succeeded: ['a#1', 'a#3', 'a#4'],
      failed: [{ key: 'a#2', error: 'Merge conflict' }],
      cancelled: false,
    });
    expect(states[0]?.status).toBe('running');
  });

  it('aborts remaining items immediately on fatal auth/rate-limit error or cancellation', async () => {
    const executed: string[] = [];
    const finalState = await runBulkAction({
      actionLabel: 'Re-running CI',
      items: [{ key: 'a#1' }, { key: 'a#2' }, { key: 'a#3' }],
      concurrency: 1,
      isCancelled: () => false,
      onUpdate: () => {},
      execute: async (item) => {
        executed.push(item.key);
        if (item.key === 'a#1') {
          return { ok: false, error: 'GitHub rate limit exceeded', fatal: true };
        }
        return { ok: true };
      },
    });

    expect(executed).toEqual(['a#1']);
    expect(finalState).toEqual({
      status: 'done',
      actionLabel: 'Re-running CI',
      total: 3,
      completed: 1,
      succeeded: [],
      failed: [{ key: 'a#1', error: 'GitHub rate limit exceeded' }],
      cancelled: true,
    });
  });
});
