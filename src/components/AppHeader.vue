<template>
  <header class="app-header">
    <div class="header-left">
      <div class="brand-group">
        <span class="brand-mark" aria-hidden="true">
          <CarbonIcon name="terminal" :size="16" />
        </span>
        <span class="brand-name">ghcc</span>
      </div>

      <span class="status-pill" :data-tone="statusTone">
        <span class="status-dot" aria-hidden="true"></span>
        <span>{{ viewerLogin ? `@${viewerLogin}` : 'connecting' }}</span>
      </span>

      <div class="freshness-pill tabular" :data-state="freshnessState" :title="freshnessTitle">
        <progress
          v-if="isRefreshing"
          class="loading-spinner freshness-spinner"
          aria-label="Refreshing pull requests from GitHub"
        ></progress>
        <span v-else class="freshness-dot" aria-hidden="true"></span>
        <span class="freshness-text" :class="{ stale: isStale }">
          <template v-if="clientState === 'initializing' && !fetchedAt">
            Loading from GitHub…
          </template>
          <template v-else-if="isRefreshing"> Refreshing… </template>
          <template v-else-if="clientState === 'offline'">
            Offline<template v-if="fetchedAt">
              · cached {{ formatRelativeAge(fetchedAt, nowMs) }}</template
            >
          </template>
          <template v-else-if="fetchedAt">
            Updated {{ formatRelativeAge(fetchedAt, nowMs) }}
            <span v-if="isStale" class="stale-badge">(stale)</span>
            <span v-else-if="nextRefreshLabel" class="freshness-next">
              · next {{ nextRefreshLabel }}
            </span>
          </template>
          <template v-else>Initializing…</template>
        </span>
      </div>
    </div>

    <div class="header-right">
      <div
        v-if="rateLimit?.graphql || rateLimit?.core"
        class="rate-gauges"
        :class="{ 'is-low': isRateLimitLow }"
        aria-label="GitHub API rate limits"
      >
        <span
          v-if="rateLimit?.graphql"
          class="rate-chip mono-num"
          :title="`GraphQL resets ${formatRelativeAge(rateLimit.graphql.resetAt, nowMs)}`"
        >
          GQL {{ rateLimit.graphql.remaining }}/{{ rateLimit.graphql.limit }}
        </span>
        <span
          v-if="rateLimit?.core"
          class="rate-chip mono-num"
          :title="`REST core resets ${formatRelativeAge(rateLimit.core.resetAt, nowMs)}`"
        >
          REST {{ rateLimit.core.remaining }}/{{ rateLimit.core.limit }}
        </span>
      </div>

      <div class="poll-select-wrap">
        <label for="poll-interval-select" class="visually-hidden">Polling interval</label>
        <select
          id="poll-interval-select"
          class="header-select mono-num"
          :value="pollIntervalMs"
          @change="onPollChange"
        >
          <option :value="60000">60s poll</option>
          <option :value="120000">120s poll</option>
          <option :value="300000">5m poll</option>
        </select>
      </div>

      <button
        type="button"
        class="header-btn palette-trigger-btn"
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        title="Command palette (⌘K / Ctrl+K)"
        @click="$emit('openPalette')"
      >
        <CarbonIcon name="terminal" :size="14" />
        <span class="btn-label">Commands</span>
        <kbd class="header-kbd">⌘K</kbd>
      </button>

      <button
        type="button"
        class="header-btn"
        :aria-label="themeButtonLabel"
        @click="$emit('toggleTheme')"
      >
        <CarbonIcon :name="resolvedTheme === 'dark' ? 'sun' : 'moon'" :size="15" />
        <span class="btn-label">{{ resolvedTheme === 'dark' ? 'Light' : 'Dark' }}</span>
      </button>

      <button
        type="button"
        class="header-btn refresh-btn"
        :aria-disabled="isRefreshing ? 'true' : undefined"
        aria-keyshortcuts="r"
        @click="onRefreshClick"
      >
        <CarbonIcon
          name="renew"
          :size="15"
          class="refresh-glyph"
          :class="{ spinning: isRefreshing }"
        />
        <span>Refresh</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import type { ClientUiState } from '@/composables/use-dashboard-state';
import type { ResolvedTheme } from '@/composables/use-theme';
import type { RateLimitBucket, SnapshotState } from '@/types/pr';
import { formatRelativeAge, formatResetCountdown } from '@/utils/format';

interface Props {
  viewerLogin?: string;
  fetchedAt?: string;
  nowMs: number;
  nextRefreshAtMs?: number | null;
  recentlyUpdated?: boolean;
  isStale: boolean;
  clientState: ClientUiState;
  serverState?: SnapshotState;
  pollIntervalMs: number;
  resolvedTheme: ResolvedTheme;
  rateLimit?: {
    graphql: RateLimitBucket | null;
    core: RateLimitBucket | null;
  };
}

const props = withDefaults(defineProps<Props>(), {
  viewerLogin: '',
  fetchedAt: '',
  nextRefreshAtMs: null,
  recentlyUpdated: false,
  serverState: undefined,
  rateLimit: undefined,
});

const emit = defineEmits<{
  refresh: [];
  toggleTheme: [];
  updatePollInterval: [ms: number];
  openPalette: [];
}>();

const statusTone = computed<'ok' | 'warn' | 'err'>(() => {
  if (
    props.clientState === 'offline' ||
    props.serverState === 'auth-error' ||
    props.serverState === 'fatal'
  ) {
    return 'err';
  }
  if (props.isStale || props.serverState === 'degraded' || props.serverState === 'rate-limited') {
    return 'warn';
  }
  return 'ok';
});

const isRateLimitLow = computed<boolean>(() => {
  const buckets = [props.rateLimit?.graphql, props.rateLimit?.core];
  return buckets.some((b) => b && b.limit > 0 && b.remaining / b.limit < 0.2);
});

const isRefreshing = computed<boolean>(
  () =>
    props.clientState === 'refreshing' ||
    (props.clientState === 'initializing' && !props.fetchedAt),
);

const freshnessState = computed<'refreshing' | 'just-updated' | 'live' | 'stale' | 'offline'>(
  () => {
    if (isRefreshing.value) {
      return 'refreshing';
    }
    if (props.clientState === 'offline') {
      return 'offline';
    }
    if (props.isStale) {
      return 'stale';
    }
    if (props.recentlyUpdated) {
      return 'just-updated';
    }
    return 'live';
  },
);

const nextRefreshLabel = computed<string>(() => {
  if (
    props.serverState === 'rate-limited' ||
    props.serverState === 'auth-error' ||
    props.serverState === 'fatal'
  ) {
    return 'paused';
  }
  if (props.nextRefreshAtMs === null) {
    return '';
  }
  const remainingMs = props.nextRefreshAtMs - props.nowMs;
  if (remainingMs <= 1_000) {
    return 'soon';
  }
  return `in ${formatResetCountdown(new Date(props.nextRefreshAtMs).toISOString(), props.nowMs)}`;
});

const freshnessTitle = computed<string | undefined>(() => {
  if (!props.fetchedAt) {
    return undefined;
  }
  const ts = Date.parse(props.fetchedAt);
  if (!Number.isFinite(ts)) {
    return undefined;
  }
  return `Last synced at ${new Date(ts).toLocaleTimeString()}`;
});

const themeButtonLabel = computed<string>(() => {
  return props.resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
});

function onPollChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  emit('updatePollInterval', Number(target.value));
}

function onRefreshClick(): void {
  if (isRefreshing.value) {
    return;
  }
  emit('refresh');
}
</script>

<style scoped>
.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  padding: 0.75rem 1.25rem;
  background-color: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}

.header-left,
.header-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.625rem 0.875rem;
  min-width: 0;
}

.brand-group {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.02em;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.15rem 0.4rem;
  border-radius: 0.35rem;
  background-color: var(--bg-surface-muted);
  border: 1px solid var(--border-subtle);
  font-size: 0.78rem;
  color: var(--accent-blue);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 500;
  background-color: var(--bg-surface-muted);
  border: 1px solid var(--border-subtle);
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background-color: var(--accent-emerald);
}

.status-pill[data-tone='warn'] .status-dot {
  background-color: var(--accent-amber);
}

.status-pill[data-tone='err'] .status-dot {
  background-color: var(--accent-red);
}

.freshness-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.16rem 0.58rem;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  font-size: 0.78rem;
  color: var(--ink-secondary);
  transition:
    background-color 220ms ease,
    border-color 220ms ease,
    color 220ms ease;
}

.freshness-pill[data-state='refreshing'] {
  border-color: color-mix(in srgb, var(--accent-blue) 45%, var(--border-subtle));
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  font-weight: 500;
}

.freshness-pill[data-state='just-updated'] {
  border-color: color-mix(in srgb, var(--accent-emerald) 55%, var(--border-subtle));
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
  font-weight: 500;
}

.freshness-pill[data-state='stale'] {
  border-color: color-mix(in srgb, var(--accent-amber) 50%, var(--border-subtle));
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
  font-weight: 600;
}

.freshness-pill[data-state='offline'] {
  border-color: color-mix(in srgb, var(--accent-red) 50%, var(--border-subtle));
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-weight: 600;
}

.freshness-dot {
  inline-size: 0.44rem;
  block-size: 0.44rem;
  border-radius: 999px;
  background-color: var(--accent-emerald);
  flex: 0 0 auto;
}

.freshness-pill[data-state='stale'] .freshness-dot {
  background-color: var(--accent-amber);
}

.freshness-pill[data-state='offline'] .freshness-dot {
  background-color: var(--accent-red);
}

.freshness-spinner {
  --size: 0.78rem;
}

.freshness-text {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.freshness-next {
  color: var(--ink-muted);
  font-weight: 400;
}

.freshness-pill[data-state='just-updated'] .freshness-next {
  color: inherit;
  opacity: 0.85;
}

.freshness-text.stale {
  color: inherit;
  font-weight: 600;
}

.rate-gauges {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.rate-chip {
  font-size: 0.75rem;
  color: var(--ink-secondary);
  padding: 0.2rem 0.45rem;
  border-radius: 0.35rem;
  background-color: var(--bg-surface-muted);
  border: 1px solid var(--border-subtle);
}

.header-select,
.header-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2rem;
  padding: 0.25rem 0.625rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}

.header-btn:hover:not([aria-disabled='true']),
.header-select:hover {
  background-color: var(--bg-surface-hover);
}

.header-btn[aria-disabled='true'] {
  opacity: 0.6;
  cursor: wait;
}

.header-kbd {
  padding: 0.04rem 0.3rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
}

.rate-gauges.is-low .rate-chip {
  border-color: var(--accent-amber);
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
}

.refresh-glyph.spinning {
  display: inline-block;
  animation: spin 0.85s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .freshness-pill {
    transition: none;
  }
  .refresh-glyph.spinning {
    animation: none;
  }
}

@media (max-width: 639px) {
  .app-header {
    padding: 0.625rem 0.875rem;
    gap: 0.5rem 0.75rem;
  }
  .header-right {
    width: 100%;
    justify-content: space-between;
  }
  .rate-gauges:not(.is-low) {
    display: none;
  }
  .btn-label {
    display: none;
  }
}
</style>
