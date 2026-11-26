import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { SnapshotResponse } from '@/types/pr';

export interface CachedMergeabilityEntry {
  headRefOid: string;
  baseRefOid?: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING';
  mergeStateStatus?: string;
  checkedAt: string;
  etag?: string;
}

export interface ProbeCounterEntry {
  headRefOid: string;
  timestamps: string[];
}

export interface CachedSnapshotEntry {
  savedAt: string;
  snapshot: SnapshotResponse;
}

export interface CachedDraftComparisonEntry {
  baseRefOid: string;
  headRefOid: string;
  behindBy: number;
}

export interface PersistedState {
  version: 1;
  mergeability: Record<string, CachedMergeabilityEntry>;
  probeCounters: Record<string, ProbeCounterEntry>;
  draftComparisons?: Record<string, CachedDraftComparisonEntry>;
  lastSnapshot?: CachedSnapshotEntry;
}

const EMPTY_STATE: PersistedState = {
  version: 1,
  mergeability: {},
  probeCounters: {},
  draftComparisons: {},
};

export const DEFAULT_STATE_PATH = resolve(process.cwd(), '.cache/state.json');

export class StateStore {
  private readonly filePath: string;
  private state: PersistedState | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string = DEFAULT_STATE_PATH) {
    this.filePath = filePath;
  }

  async load(): Promise<PersistedState> {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed && parsed.version === 1 && parsed.mergeability && parsed.probeCounters) {
        this.state = {
          version: 1,
          mergeability: { ...parsed.mergeability },
          probeCounters: { ...parsed.probeCounters },
          draftComparisons: parsed.draftComparisons ? { ...parsed.draftComparisons } : {},
          ...(parsed.lastSnapshot?.snapshot && typeof parsed.lastSnapshot.savedAt === 'string'
            ? { lastSnapshot: parsed.lastSnapshot }
            : {}),
        };
        return this.state;
      }
    } catch {
      // Missing or corrupted cache resets cleanly to empty state.
    }

    this.state = {
      version: 1,
      mergeability: {},
      probeCounters: {},
      draftComparisons: {},
    };
    return this.state;
  }

  async getMergeability(prKey: string): Promise<CachedMergeabilityEntry | null> {
    const state = await this.load();
    return state.mergeability[prKey] ?? null;
  }

  async setMergeability(prKey: string, entry: CachedMergeabilityEntry): Promise<void> {
    const state = await this.load();
    state.mergeability[prKey] = entry;
    await this.persist();
  }

  async getRecentProbeCount(prKey: string, headRefOid: string, nowMs: number): Promise<number> {
    const state = await this.load();
    const counter = state.probeCounters[prKey];
    if (!counter || counter.headRefOid !== headRefOid) {
      return 0;
    }
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    return counter.timestamps.filter((ts) => Date.parse(ts) > oneHourAgo).length;
  }

  async recordProbeAttempt(prKey: string, headRefOid: string, nowIso: string): Promise<void> {
    const state = await this.load();
    const nowMs = Date.parse(nowIso);
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const existing = state.probeCounters[prKey];
    const kept =
      existing && existing.headRefOid === headRefOid
        ? existing.timestamps.filter((ts) => Date.parse(ts) > oneHourAgo)
        : [];
    kept.push(nowIso);
    state.probeCounters[prKey] = {
      headRefOid,
      timestamps: kept,
    };
    await this.persist();
  }

  async getDraftComparison(prKey: string): Promise<CachedDraftComparisonEntry | null> {
    const state = await this.load();
    return state.draftComparisons?.[prKey] ?? null;
  }

  async setDraftComparisons(entries: Record<string, CachedDraftComparisonEntry>): Promise<void> {
    const keys = Object.keys(entries);
    if (keys.length === 0) {
      return;
    }
    const state = await this.load();
    state.draftComparisons = {
      ...state.draftComparisons,
      ...entries,
    };
    await this.persist();
  }

  async getLastSnapshot(): Promise<CachedSnapshotEntry | null> {
    const state = await this.load();
    return state.lastSnapshot ?? null;
  }

  async setLastSnapshot(snapshot: SnapshotResponse, savedAt: string): Promise<void> {
    const state = await this.load();
    state.lastSnapshot = { savedAt, snapshot };
    await this.persist();
  }

  async reset(): Promise<void> {
    this.state = {
      ...EMPTY_STATE,
      mergeability: {},
      probeCounters: {},
      draftComparisons: {},
    };
    await this.persist();
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state ?? EMPTY_STATE, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true });
      const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, snapshot, 'utf8');
      await rename(tmpPath, this.filePath);
    });
    return this.writeChain;
  }
}
