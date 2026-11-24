<template>
  <header class="app-header">
    <div class="header-left">
      <div class="brand-group">
        <span class="brand-mark mono-num" aria-hidden="true">&gt;_</span>
        <span class="brand-name">ghcc</span>
      </div>

      <span class="status-pill" :data-tone="statusTone">
        <span class="status-dot" aria-hidden="true"></span>
        <span>{{ viewerLogin ? `@${viewerLogin}` : 'connecting' }}</span>
      </span>

      <span class="freshness-text tabular" :class="{ stale: isStale }">
        <template v-if="clientState === 'refreshing'">refreshing...</template>
        <template v-else-if="fetchedAt">
          updated {{ formatRelativeAge(fetchedAt, nowMs) }}
          <span v-if="isStale" class="stale-badge">(stale)</span>
        </template>
        <template v-else>initializing...</template>
      </span>
    </div>

    <div class="header-right">
      <div class="rate-gauges" aria-label="GitHub API rate limits">
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
        class="header-btn"
        :aria-label="themeButtonLabel"
        @click="$emit('toggleTheme')"
      >
        <span aria-hidden="true">{{ resolvedTheme === 'dark' ? '☀' : '☾' }}</span>
        <span class="btn-label">{{ resolvedTheme === 'dark' ? 'Light' : 'Dark' }}</span>
      </button>

      <button
        type="button"
        class="header-btn refresh-btn"
        :disabled="clientState === 'refreshing'"
        aria-keyshortcuts="r"
        @click="$emit('refresh')"
      >
        <span
          class="refresh-glyph"
          :class="{ spinning: clientState === 'refreshing' }"
          aria-hidden="true"
          >↻</span
        >
        <span>Refresh</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ClientUiState } from '@/composables/use-dashboard-state';
import type { ResolvedTheme } from '@/composables/use-theme';
import type { RateLimitBucket, SnapshotState } from '@/types/pr';
import { formatRelativeAge } from '@/utils/format';

interface Props {
  viewerLogin?: string;
  fetchedAt?: string;
  nowMs: number;
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
  serverState: undefined,
  rateLimit: undefined,
});

const emit = defineEmits<{
  refresh: [];
  toggleTheme: [];
  updatePollInterval: [ms: number];
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

const themeButtonLabel = computed<string>(() => {
  return props.resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
});

function onPollChange(event: Event): void {
  const target = event.target as HTMLSelectElement;
  emit('updatePollInterval', Number(target.value));
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

.freshness-text {
  font-size: 0.8125rem;
  color: var(--ink-secondary);
}

.freshness-text.stale {
  color: var(--accent-amber);
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

.header-btn:hover:not(:disabled),
.header-select:hover {
  background-color: var(--bg-surface-hover);
}

.header-btn:disabled {
  opacity: 0.6;
  cursor: wait;
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
  .refresh-glyph.spinning {
    animation: none;
  }
}

@media (max-width: 639px) {
  .app-header {
    padding: 0.625rem 0.875rem;
  }
  .btn-label {
    display: none;
  }
}
</style>
