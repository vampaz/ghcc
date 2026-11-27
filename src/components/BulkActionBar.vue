<template>
  <aside
    v-if="selectedPulls.length > 0 || bulkState.status !== 'idle'"
    class="bulk-action-bar"
    aria-label="Bulk pull request actions"
  >
    <div class="bulk-bar-inner">
      <div v-if="bulkState.status === 'running'" class="bulk-progress-row" role="status">
        <progress class="loading-spinner" aria-label="Running bulk action"></progress>
        <span class="bulk-status-text mono-num">
          {{ bulkState.actionLabel }}: {{ bulkState.completed }} / {{ bulkState.total }}
        </span>
        <button type="button" class="bulk-btn bulk-cancel-btn" @click="$emit('cancel-bulk')">
          Cancel
        </button>
      </div>

      <div v-else-if="bulkState.status === 'done'" class="bulk-done-row" role="status">
        <span class="bulk-status-text">
          {{ bulkState.actionLabel }}:
          <strong class="mono-num">{{ bulkState.succeeded.length }}</strong> succeeded<template
            v-if="bulkState.failed.length > 0"
          >
            , <strong class="bulk-fail-count mono-num">{{ bulkState.failed.length }}</strong> failed
          </template>
          <template v-if="bulkState.cancelled"> (cancelled)</template>
        </span>
        <span v-if="bulkState.failed.length > 0" class="bulk-fail-preview">
          {{ bulkState.failed[0]!.key }}: {{ bulkState.failed[0]!.error }}
        </span>
        <button type="button" class="bulk-btn" @click="$emit('dismiss-bulk')">Dismiss</button>
      </div>

      <template v-else>
        <div class="bulk-selection-meta">
          <span class="bulk-count mono-num">{{ selectedPulls.length }} selected</span>
          <button
            v-if="selectedPulls.length < visibleCount"
            type="button"
            class="bulk-link-btn"
            @click="$emit('select-all-visible')"
          >
            Select all {{ visibleCount }}
          </button>
          <button type="button" class="bulk-link-btn" @click="$emit('clear-selection')">
            Clear
          </button>
        </div>

        <div class="bulk-actions-group">
          <button
            v-if="behindCount > 0"
            type="button"
            class="bulk-btn bulk-btn-blue"
            @click="$emit('bulk-sync')"
          >
            <CarbonIcon name="renew" :size="13" />
            <span>Sync behind ({{ behindCount }})</span>
          </button>

          <button
            v-if="failingCount > 0"
            type="button"
            class="bulk-btn bulk-btn-amber"
            @click="$emit('bulk-rerun')"
          >
            <CarbonIcon name="renew" :size="13" />
            <span>Re-run CI ({{ failingCount }})</span>
          </button>

          <button type="button" class="bulk-btn" @click="$emit('bulk-pin')">
            <CarbonIcon name="pin" :size="13" />
            <span>Pin</span>
          </button>

          <button type="button" class="bulk-btn" @click="$emit('bulk-snooze')">
            <CarbonIcon name="time" :size="13" />
            <span>Snooze</span>
          </button>

          <button
            v-if="readyForDraftCount > 0"
            type="button"
            class="bulk-btn"
            @click="$emit('bulk-draft', true)"
          >
            Mark Draft ({{ readyForDraftCount }})
          </button>

          <button
            v-if="draftCount > 0"
            type="button"
            class="bulk-btn"
            @click="$emit('bulk-draft', false)"
          >
            Mark Ready ({{ draftCount }})
          </button>
        </div>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import type { PrView } from '@/types/pr';
import { IDLE_BULK_ACTION_STATE, type BulkActionState } from '@/utils/bulk-runner';

interface Props {
  selectedPulls: PrView[];
  visibleCount: number;
  bulkState?: BulkActionState;
}

const props = withDefaults(defineProps<Props>(), {
  bulkState: () => IDLE_BULK_ACTION_STATE,
});

defineEmits<{
  'select-all-visible': [];
  'clear-selection': [];
  'bulk-sync': [];
  'bulk-rerun': [];
  'bulk-pin': [];
  'bulk-snooze': [];
  'bulk-draft': [targetDraft: boolean];
  'cancel-bulk': [];
  'dismiss-bulk': [];
}>();

const behindCount = computed<number>(
  () => props.selectedPulls.filter((pr) => pr.merge.state === 'behind').length,
);
const failingCount = computed<number>(
  () => props.selectedPulls.filter((pr) => pr.ci.state === 'failing').length,
);
const draftCount = computed<number>(() => props.selectedPulls.filter((pr) => pr.isDraft).length);
const readyForDraftCount = computed<number>(() => props.selectedPulls.length - draftCount.value);
</script>

<style scoped>
.bulk-action-bar {
  flex: 0 0 auto;
  border-top: 1px solid var(--accent-blue);
  background-color: color-mix(in srgb, var(--accent-blue-bg) 55%, var(--bg-surface));
  padding: 0.5rem 1.25rem;
}

.bulk-bar-inner {
  inline-size: 100%;
  max-inline-size: 90rem;
  margin-inline: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 0.85rem;
}

.bulk-selection-meta,
.bulk-actions-group,
.bulk-progress-row,
.bulk-done-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.bulk-count {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--accent-blue);
}

.bulk-link-btn {
  padding: 0.1rem 0.35rem;
  border: 0;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.76rem;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

.bulk-link-btn:hover {
  color: var(--ink-primary);
}

.bulk-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-block-size: 1.85rem;
  padding: 0.2rem 0.6rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
}

.bulk-btn:hover {
  background-color: var(--bg-surface-hover);
}

.bulk-btn-blue {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.bulk-btn-amber {
  border-color: var(--accent-amber);
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
}

.bulk-cancel-btn {
  border-color: var(--accent-red);
  color: var(--accent-red);
}

.bulk-status-text {
  font-size: 0.8rem;
  color: var(--ink-primary);
}

.bulk-fail-count {
  color: var(--accent-red);
}

.bulk-fail-preview {
  font-size: 0.75rem;
  color: var(--accent-red);
  overflow-wrap: anywhere;
}
</style>
