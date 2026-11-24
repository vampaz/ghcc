<template>
  <div v-if="hasAlerts" class="warning-strip" role="alert">
    <div class="warning-items">
      <div v-if="offlineMessage" class="warning-row" data-severity="error">
        <span class="warning-tag">Offline</span>
        <span class="warning-msg">
          Local ghcc server unreachable ({{ offlineMessage }}). Showing last known snapshot.
        </span>
        <button type="button" class="retry-btn" @click="$emit('retry')">Retry</button>
      </div>

      <div v-if="refreshCooldownNotice" class="warning-row" data-severity="info">
        <span class="warning-tag">Cooldown</span>
        <span class="warning-msg">{{ refreshCooldownNotice }}</span>
      </div>

      <div
        v-for="warning in warnings"
        :key="`${warning.code}-${warning.message}`"
        class="warning-row"
        :data-severity="severityFor(warning.code)"
      >
        <span class="warning-tag">{{ labelFor(warning.code) }}</span>
        <span class="warning-msg">
          {{ warning.message }}
          <template v-if="warning.code === 'rate-limited' && resetIn">
            (resets in {{ resetIn }})
          </template>
        </span>
        <a
          v-if="warning.ssoUrl"
          :href="warning.ssoUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="warning-link"
        >
          Authorize SSO ↗
        </a>
        <button
          v-if="serverState === 'auth-error' || serverState === 'fatal'"
          type="button"
          class="retry-btn"
          @click="$emit('retry')"
        >
          Retry
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RateLimitBucket, SnapshotState, SnapshotWarning, WarningCode } from '@/types/pr';
import { formatResetCountdown } from '@/utils/format';

interface Props {
  serverState?: SnapshotState;
  warnings?: SnapshotWarning[];
  offlineMessage?: string | null;
  refreshCooldownNotice?: string | null;
  graphqlRateLimit?: RateLimitBucket | null;
  nowMs: number;
}

const props = withDefaults(defineProps<Props>(), {
  serverState: undefined,
  warnings: () => [],
  offlineMessage: null,
  refreshCooldownNotice: null,
  graphqlRateLimit: null,
});

defineEmits<{
  retry: [];
}>();

const hasAlerts = computed<boolean>(() => {
  return (
    Boolean(props.offlineMessage) ||
    Boolean(props.refreshCooldownNotice) ||
    props.warnings.length > 0
  );
});

const resetIn = computed<string>(() => {
  if (!props.graphqlRateLimit?.resetAt) {
    return '';
  }
  return formatResetCountdown(props.graphqlRateLimit.resetAt, props.nowMs);
});

function labelFor(code: WarningCode): string {
  switch (code) {
    case 'sso-required':
      return 'SSO Required';
    case 'review-queue-failed':
      return 'Partial Data';
    case 'rate-limited':
      return 'Rate Limited';
    case 'auth-error':
      return 'Auth Error';
    case 'mergeability-cached':
      return 'Cached Merge';
    case 'graphql-partial-error':
      return 'Partial GraphQL';
    case 'refresh-failed':
      return 'Refresh Error';
  }
}

function severityFor(code: WarningCode): 'error' | 'warn' | 'info' {
  if (code === 'auth-error' || code === 'rate-limited') {
    return 'error';
  }
  return 'warn';
}
</script>

<style scoped>
.warning-strip {
  padding: 0.5rem 1.25rem 0;
}

.warning-items {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.warning-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-strong);
  background-color: var(--accent-amber-bg);
  font-size: 0.8125rem;
}

.warning-row[data-severity='error'] {
  background-color: var(--accent-red-bg);
  border-color: var(--accent-red);
}

.warning-row[data-severity='info'] {
  background-color: var(--accent-blue-bg);
  border-color: var(--accent-blue);
}

.warning-tag {
  font-weight: 700;
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--accent-amber);
}

.warning-row[data-severity='error'] .warning-tag {
  color: var(--accent-red);
}

.warning-row[data-severity='info'] .warning-tag {
  color: var(--accent-blue);
}

.warning-msg {
  flex: 1 1 14rem;
  color: var(--ink-primary);
}

.warning-link,
.retry-btn {
  min-height: 1.75rem;
  padding: 0.2rem 0.6rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

@media (max-width: 639px) {
  .warning-strip {
    padding: 0.5rem 0.875rem 0;
  }
}
</style>
