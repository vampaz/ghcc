import { computed, onMounted, onUnmounted, ref } from 'vue';
import type {
  PrDetailResponse,
  PrView,
  SnapshotResponse,
  ToggleDraftResponse,
  UpdateBranchResponse,
} from '@/types/pr';

export type ClientUiState = 'initializing' | 'live' | 'refreshing' | 'offline';

export type InspectorState =
  | { status: 'closed'; key: null; detail: null; error: null }
  | { status: 'loading'; key: string; detail: PrDetailResponse | null; error: null }
  | { status: 'open'; key: string; detail: PrDetailResponse; error: null }
  | { status: 'error'; key: string; detail: null; error: string };

export type PrSyncState =
  | { status: 'idle' }
  | { status: 'syncing'; headRefOid: string }
  | { status: 'synced'; headRefOid: string; message: string }
  | { status: 'error'; headRefOid: string; error: string };

export type PrSyncEvent =
  | { type: 'SYNC_REQUEST'; headRefOid: string }
  | { type: 'SYNC_ACCEPTED'; headRefOid: string; message: string }
  | { type: 'SYNC_FAILED'; headRefOid: string; error: string }
  | { type: 'RESET' };

export const IDLE_PR_SYNC_STATE: PrSyncState = { status: 'idle' };

export type PrDraftState =
  | { status: 'idle' }
  | { status: 'updating'; targetDraft: boolean }
  | { status: 'error'; targetDraft: boolean; error: string };

export type PrDraftEvent =
  | { type: 'TOGGLE_REQUEST'; targetDraft: boolean }
  | { type: 'TOGGLE_SUCCEEDED' }
  | { type: 'TOGGLE_FAILED'; targetDraft: boolean; error: string }
  | { type: 'RESET' };

export const IDLE_PR_DRAFT_STATE: PrDraftState = { status: 'idle' };

export function transitionPrDraftState(current: PrDraftState, event: PrDraftEvent): PrDraftState {
  if (event.type === 'RESET') {
    return IDLE_PR_DRAFT_STATE;
  }
  switch (current.status) {
    case 'idle':
    case 'error':
      if (event.type === 'TOGGLE_REQUEST') {
        return { status: 'updating', targetDraft: event.targetDraft };
      }
      return current;
    case 'updating':
      if (event.type === 'TOGGLE_SUCCEEDED') {
        return IDLE_PR_DRAFT_STATE;
      }
      if (event.type === 'TOGGLE_FAILED') {
        return { status: 'error', targetDraft: event.targetDraft, error: event.error };
      }
      return current;
  }
}

export function transitionPrSyncState(current: PrSyncState, event: PrSyncEvent): PrSyncState {
  if (event.type === 'RESET') {
    return IDLE_PR_SYNC_STATE;
  }
  switch (current.status) {
    case 'idle':
    case 'error':
      if (event.type === 'SYNC_REQUEST') {
        return { status: 'syncing', headRefOid: event.headRefOid };
      }
      return current;
    case 'syncing':
      if (event.type === 'SYNC_ACCEPTED') {
        return { status: 'synced', headRefOid: event.headRefOid, message: event.message };
      }
      if (event.type === 'SYNC_FAILED') {
        return { status: 'error', headRefOid: event.headRefOid, error: event.error };
      }
      return current;
    case 'synced':
      return current;
  }
}

export const DEFAULT_POLL_INTERVAL_MS = 120_000;
export const MIN_POLL_INTERVAL_MS = 60_000;
export const DEFAULT_SYNC_REFRESH_DELAY_MS = 2_000;

export function useDashboardState(
  options: {
    initialPollIntervalMs?: number;
    syncRefreshDelayMs?: number;
    fetchFn?: typeof fetch;
  } = {},
) {
  const fetchFn = options.fetchFn ?? fetch;
  const syncRefreshDelayMs = options.syncRefreshDelayMs ?? DEFAULT_SYNC_REFRESH_DELAY_MS;
  const pollIntervalMs = ref<number>(
    Math.max(MIN_POLL_INTERVAL_MS, options.initialPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
  );

  const clientState = ref<ClientUiState>('initializing');
  const snapshot = ref<SnapshotResponse | null>(null);
  const etag = ref<string | null>(null);
  const nowMs = ref<number>(Date.now());
  const offlineMessage = ref<string | null>(null);
  const refreshCooldownNotice = ref<string | null>(null);
  const announcement = ref<string>('');
  const syncStates = ref<Record<string, PrSyncState>>({});
  const draftStates = ref<Record<string, PrDraftState>>({});

  const inspector = ref<InspectorState>({
    status: 'closed',
    key: null,
    detail: null,
    error: null,
  });
  const detailCache = new Map<string, PrDetailResponse>();

  const isStale = computed<boolean>(() => {
    if (!snapshot.value?.fetchedAt) {
      return false;
    }
    const fetchedMs = Date.parse(snapshot.value.fetchedAt);
    if (!Number.isFinite(fetchedMs)) {
      return false;
    }
    return nowMs.value - fetchedMs > 2.5 * pollIntervalMs.value;
  });

  function getSyncState(prKey: string): PrSyncState {
    return syncStates.value[prKey] ?? IDLE_PR_SYNC_STATE;
  }

  function setSyncState(prKey: string, next: PrSyncState): void {
    if (next.status === 'idle') {
      if (!(prKey in syncStates.value)) {
        return;
      }
      const copy = { ...syncStates.value };
      delete copy[prKey];
      syncStates.value = copy;
      return;
    }
    syncStates.value = {
      ...syncStates.value,
      [prKey]: next,
    };
  }

  function getDraftState(prKey: string): PrDraftState {
    return draftStates.value[prKey] ?? IDLE_PR_DRAFT_STATE;
  }

  function setDraftState(prKey: string, next: PrDraftState): void {
    if (next.status === 'idle') {
      if (!(prKey in draftStates.value)) {
        return;
      }
      const copy = { ...draftStates.value };
      delete copy[prKey];
      draftStates.value = copy;
      return;
    }
    draftStates.value = {
      ...draftStates.value,
      [prKey]: next,
    };
  }

  function reconcileDraftStates(data: SnapshotResponse): void {
    const entries = Object.entries(draftStates.value);
    if (entries.length === 0) {
      return;
    }
    const prByKey = new Map(data.pullRequests.map((pr) => [pr.key, pr]));
    let changed = false;
    const nextMap: Record<string, PrDraftState> = { ...draftStates.value };

    for (const [key, state] of entries) {
      if (state.status === 'idle') {
        delete nextMap[key];
        changed = true;
        continue;
      }
      const updated = prByKey.get(key);
      if (!updated || (state.status === 'error' && updated.isDraft === state.targetDraft)) {
        delete nextMap[key];
        changed = true;
      }
    }

    if (changed) {
      draftStates.value = nextMap;
    }
  }

  function reconcileSyncStates(data: SnapshotResponse): void {
    const entries = Object.entries(syncStates.value);
    if (entries.length === 0) {
      return;
    }
    const prByKey = new Map(data.pullRequests.map((pr) => [pr.key, pr]));
    let changed = false;
    const nextMap: Record<string, PrSyncState> = { ...syncStates.value };

    for (const [key, state] of entries) {
      if (state.status === 'idle') {
        delete nextMap[key];
        changed = true;
        continue;
      }
      const updated = prByKey.get(key);
      const shouldReset =
        !updated ||
        (state.status !== 'syncing' &&
          (updated.merge.state !== 'behind' || updated.headRefOid !== state.headRefOid));

      if (shouldReset) {
        delete nextMap[key];
        changed = true;
        if (
          updated &&
          inspector.value.status === 'open' &&
          inspector.value.key === key &&
          updated.headRefOid !== state.headRefOid
        ) {
          void openInspector(updated);
        }
      }
    }

    if (changed) {
      syncStates.value = nextMap;
    }
  }

  function announceSnapshot(data: SnapshotResponse): void {
    announcement.value = `Updated pull requests: ${data.counts.needsMe} need you, ${data.counts.ready} ready to merge, ${data.counts.waiting} waiting.`;
  }

  let fetchInFlight = false;
  let pendingRefreshAfterSync = false;

  async function fetchSnapshot(force = false): Promise<void> {
    if (fetchInFlight) {
      return;
    }
    fetchInFlight = true;
    if (snapshot.value !== null) {
      clientState.value = 'refreshing';
    }
    refreshCooldownNotice.value = null;

    try {
      let response: Response;
      if (force) {
        response = await fetchFn('/api/refresh', {
          method: 'POST',
          headers: { Accept: 'application/json' },
        });
        if (response.status === 429) {
          const errBody = (await response.json().catch(() => ({}))) as {
            retryAfterSeconds?: number;
            error?: string;
          };
          refreshCooldownNotice.value =
            errBody.error ??
            `Refresh cooldown active. Try again in ${errBody.retryAfterSeconds ?? 10}s.`;
          offlineMessage.value = null;
          clientState.value = 'live';
          return;
        }
      } else {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (etag.value) {
          headers['If-None-Match'] = etag.value;
        }
        response = await fetchFn('/api/snapshot', { method: 'GET', headers });
      }

      if (response.status === 304) {
        offlineMessage.value = null;
        clientState.value = 'live';
        nowMs.value = Date.now();
        return;
      }

      if (!response.ok) {
        throw new Error(`Dashboard server returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as SnapshotResponse;
      const nextEtag = response.headers.get('etag');
      if (nextEtag) {
        etag.value = nextEtag;
      }
      snapshot.value = data;
      offlineMessage.value = null;
      clientState.value = 'live';
      nowMs.value = Date.now();
      reconcileSyncStates(data);
      reconcileDraftStates(data);
      announceSnapshot(data);
    } catch (error) {
      offlineMessage.value =
        error instanceof Error ? error.message : 'Local ghcc server is unreachable';
      clientState.value = 'offline';
    } finally {
      fetchInFlight = false;
      if (pendingRefreshAfterSync) {
        pendingRefreshAfterSync = false;
        void fetchSnapshot(false);
      }
    }
  }

  let syncRefreshTimer: number | null = null;

  function schedulePostSyncRefresh(): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (syncRefreshTimer !== null) {
      window.clearTimeout(syncRefreshTimer);
    }
    syncRefreshTimer = window.setTimeout(() => {
      syncRefreshTimer = null;
      if (fetchInFlight) {
        pendingRefreshAfterSync = true;
      } else {
        void fetchSnapshot(false);
      }
    }, syncRefreshDelayMs);
  }

  async function syncPullRequest(pr: PrView): Promise<void> {
    const current = getSyncState(pr.key);
    if (current.status === 'syncing' || current.status === 'synced') {
      return;
    }

    setSyncState(
      pr.key,
      transitionPrSyncState(current, { type: 'SYNC_REQUEST', headRefOid: pr.headRefOid }),
    );

    try {
      const response = await fetchFn(
        `/api/pull/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/${pr.number}/update-branch`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(pr.headRefOid ? { expectedHeadSha: pr.headRefOid } : {}),
        },
      );

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Failed to synchronize branch (HTTP ${response.status})`);
      }

      const data = (await response.json()) as UpdateBranchResponse;
      detailCache.delete(`${pr.key}@${pr.headRefOid}`);
      setSyncState(
        pr.key,
        transitionPrSyncState(getSyncState(pr.key), {
          type: 'SYNC_ACCEPTED',
          headRefOid: pr.headRefOid,
          message: data.message,
        }),
      );
      announcement.value = `Synchronized ${pr.key} with ${pr.baseRefName}.`;
      schedulePostSyncRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to synchronize branch';
      setSyncState(
        pr.key,
        transitionPrSyncState(getSyncState(pr.key), {
          type: 'SYNC_FAILED',
          headRefOid: pr.headRefOid,
          error: message,
        }),
      );
      announcement.value = `Failed to synchronize ${pr.key}: ${message}`;
    }
  }

  async function togglePullDraft(pr: PrView, nextDraft?: boolean): Promise<void> {
    const targetDraft = nextDraft ?? !pr.isDraft;
    const current = getDraftState(pr.key);
    if (current.status === 'updating' || targetDraft === pr.isDraft) {
      return;
    }

    setDraftState(pr.key, transitionPrDraftState(current, { type: 'TOGGLE_REQUEST', targetDraft }));

    try {
      const response = await fetchFn(
        `/api/pull/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/${pr.number}/draft`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ draft: targetDraft }),
        },
      );

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Failed to update draft state (HTTP ${response.status})`);
      }

      const data = (await response.json()) as ToggleDraftResponse;
      detailCache.delete(`${pr.key}@${pr.headRefOid}`);
      setDraftState(
        pr.key,
        transitionPrDraftState(getDraftState(pr.key), { type: 'TOGGLE_SUCCEEDED' }),
      );

      if (snapshot.value) {
        snapshot.value = {
          ...snapshot.value,
          pullRequests: snapshot.value.pullRequests.map((item) =>
            item.key === pr.key ? { ...item, isDraft: data.isDraft } : item,
          ),
        };
      }

      announcement.value = data.isDraft
        ? `Converted ${pr.key} to draft.`
        : `Marked ${pr.key} ready for review.`;

      if (inspector.value.status !== 'closed' && inspector.value.key === pr.key) {
        void openInspector({ ...pr, isDraft: data.isDraft });
      }

      if (fetchInFlight) {
        pendingRefreshAfterSync = true;
      } else {
        void fetchSnapshot(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update draft state';
      setDraftState(
        pr.key,
        transitionPrDraftState(getDraftState(pr.key), {
          type: 'TOGGLE_FAILED',
          targetDraft,
          error: message,
        }),
      );
      announcement.value = `Failed to update draft state for ${pr.key}: ${message}`;
    }
  }

  async function openInspector(pr: PrView): Promise<void> {
    const cacheKey = `${pr.key}@${pr.headRefOid}`;
    const cached = detailCache.get(cacheKey);
    if (cached) {
      inspector.value = { status: 'open', key: pr.key, detail: cached, error: null };
      return;
    }

    inspector.value = { status: 'loading', key: pr.key, detail: null, error: null };
    try {
      const response = await fetchFn(
        `/api/pull/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/${pr.number}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          errBody.error ?? `Failed to load pull request detail (HTTP ${response.status})`,
        );
      }
      const detail = (await response.json()) as PrDetailResponse;
      detailCache.set(cacheKey, detail);
      // Guard against stale async completion if user switched PR or closed inspector.
      if (inspector.value.status === 'loading' && inspector.value.key === pr.key) {
        inspector.value = { status: 'open', key: pr.key, detail, error: null };
      }
    } catch (error) {
      if (inspector.value.status === 'loading' && inspector.value.key === pr.key) {
        inspector.value = {
          status: 'error',
          key: pr.key,
          detail: null,
          error: error instanceof Error ? error.message : 'Failed to load PR details',
        };
      }
    }
  }

  function closeInspector(): void {
    inspector.value = { status: 'closed', key: null, detail: null, error: null };
  }

  function setPollIntervalMs(ms: number): void {
    pollIntervalMs.value = Math.max(MIN_POLL_INTERVAL_MS, ms);
    restartPolling();
  }

  let pollTimer: number | null = null;
  let clockTimer: number | null = null;

  function restartPolling(): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }
    pollTimer = window.setInterval(() => {
      void fetchSnapshot(false);
    }, pollIntervalMs.value);
  }

  onMounted(() => {
    void fetchSnapshot(false);
    restartPolling();
    clockTimer = window.setInterval(() => {
      nowMs.value = Date.now();
    }, 10_000);
  });

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
      if (clockTimer !== null) {
        window.clearInterval(clockTimer);
      }
      if (syncRefreshTimer !== null) {
        window.clearTimeout(syncRefreshTimer);
      }
    }
  });

  return {
    clientState,
    snapshot,
    nowMs,
    pollIntervalMs,
    isStale,
    offlineMessage,
    refreshCooldownNotice,
    announcement,
    inspector,
    syncStates,
    draftStates,
    fetchSnapshot,
    syncPullRequest,
    togglePullDraft,
    openInspector,
    closeInspector,
    setPollIntervalMs,
  };
}
