import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { PrDetailResponse, PrView, SnapshotResponse } from '@/types/pr';

export type ClientUiState = 'initializing' | 'live' | 'refreshing' | 'offline';

export type InspectorState =
  | { status: 'closed'; key: null; detail: null; error: null }
  | { status: 'loading'; key: string; detail: PrDetailResponse | null; error: null }
  | { status: 'open'; key: string; detail: PrDetailResponse; error: null }
  | { status: 'error'; key: string; detail: null; error: string };

export const DEFAULT_POLL_INTERVAL_MS = 120_000;
export const MIN_POLL_INTERVAL_MS = 60_000;

export function useDashboardState(
  options: {
    initialPollIntervalMs?: number;
    fetchFn?: typeof fetch;
  } = {},
) {
  const fetchFn = options.fetchFn ?? fetch;
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

  function announceSnapshot(data: SnapshotResponse): void {
    announcement.value = `Updated pull requests: ${data.counts.needsMe} need you, ${data.counts.ready} ready to merge, ${data.counts.waiting} waiting.`;
  }

  let fetchInFlight = false;

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
      announceSnapshot(data);
    } catch (error) {
      offlineMessage.value =
        error instanceof Error ? error.message : 'Local ghcc server is unreachable';
      clientState.value = 'offline';
    } finally {
      fetchInFlight = false;
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
    fetchSnapshot,
    openInspector,
    closeInspector,
    setPollIntervalMs,
  };
}
