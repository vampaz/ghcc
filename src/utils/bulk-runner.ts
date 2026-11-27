export interface BulkActionFailure {
  key: string;
  error: string;
}

export type BulkActionState =
  | { status: 'idle' }
  | {
      status: 'running';
      actionLabel: string;
      total: number;
      completed: number;
      succeeded: string[];
      failed: BulkActionFailure[];
      cancelled: boolean;
    }
  | {
      status: 'done';
      actionLabel: string;
      total: number;
      completed: number;
      succeeded: string[];
      failed: BulkActionFailure[];
      cancelled: boolean;
    };

export const IDLE_BULK_ACTION_STATE: BulkActionState = { status: 'idle' };

export interface BulkItemOutcome {
  ok: boolean;
  error?: string;
  fatal?: boolean;
}

export async function runBulkAction<T extends { key: string }>(options: {
  actionLabel: string;
  items: T[];
  concurrency?: number;
  isCancelled: () => boolean;
  execute: (item: T) => Promise<BulkItemOutcome>;
  onUpdate: (state: BulkActionState) => void;
}): Promise<BulkActionState> {
  const { actionLabel, items, isCancelled, execute, onUpdate } = options;
  const total = items.length;
  if (total === 0) {
    return IDLE_BULK_ACTION_STATE;
  }

  const succeeded: string[] = [];
  const failed: BulkActionFailure[] = [];
  let completed = 0;
  let aborted = false;

  const emitRunning = () => {
    onUpdate({
      status: 'running',
      actionLabel,
      total,
      completed,
      succeeded: [...succeeded],
      failed: [...failed],
      cancelled: aborted || isCancelled(),
    });
  };

  emitRunning();

  const queue = [...items];
  const workerCount = Math.max(1, Math.min(options.concurrency ?? 2, queue.length));

  async function worker(): Promise<void> {
    while (queue.length > 0 && !aborted && !isCancelled()) {
      const item = queue.shift();
      if (!item) {
        continue;
      }
      try {
        const result = await execute(item);
        completed++;
        if (result.ok) {
          succeeded.push(item.key);
        } else {
          failed.push({ key: item.key, error: result.error ?? 'Action failed' });
          if (result.fatal) {
            aborted = true;
          }
        }
      } catch (error) {
        completed++;
        const msg = error instanceof Error ? error.message : 'Action failed';
        failed.push({ key: item.key, error: msg });
        if (/rate limit|401|unauthorized|offline/i.test(msg)) {
          aborted = true;
        }
      }
      emitRunning();
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const finalState: BulkActionState = {
    status: 'done',
    actionLabel,
    total,
    completed,
    succeeded: [...succeeded],
    failed: [...failed],
    cancelled: aborted || isCancelled(),
  };
  onUpdate(finalState);
  return finalState;
}
