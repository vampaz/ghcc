<template>
  <section class="action-queue" aria-labelledby="action-queue">
    <div class="section-head">
      <h1 id="action-queue" tabindex="-1" class="section-title">{{ headingLabel }}</h1>
      <span class="section-count mono-num">{{ pullRequests.length }}</span>
    </div>

    <div class="queue-scroll app-scroll">
      <div v-if="isLoading" class="empty-state">Loading pull request snapshot from GitHub...</div>

      <div
        v-else-if="pullRequests.length === 0"
        class="empty-state"
        :class="{ 'inbox-zero': isInboxZero }"
      >
        <div v-if="isInboxZero" class="inbox-zero-head">
          <CarbonIcon name="checkmark-filled" :size="18" class="inbox-zero-icon" />
          <p class="empty-title">{{ emptyTitle }}</p>
        </div>
        <p v-else class="empty-title">{{ emptyTitle }}</p>
        <p class="empty-hint">{{ emptyHint }}</p>
        <div v-if="showEmptyActions" class="empty-actions">
          <button
            v-if="snoozedCount > 0 && !showSnoozed"
            type="button"
            class="empty-action-btn"
            @click="$emit('show-snoozed')"
          >
            Show {{ snoozedCount }} snoozed
          </button>
          <button
            v-if="readyCount > 0 && activeBucket !== 'ready'"
            type="button"
            class="empty-action-btn"
            @click="$emit('select-bucket', 'ready')"
          >
            View {{ readyCount }} ready to merge
          </button>
          <button
            v-if="waitingCount > 0 && activeBucket !== 'waiting'"
            type="button"
            class="empty-action-btn"
            @click="$emit('select-bucket', 'waiting')"
          >
            View {{ waitingCount }} waiting
          </button>
        </div>
      </div>

      <ul v-else role="list" class="card-list">
        <PrCard
          v-for="pr in pullRequests"
          :key="pr.key"
          :pr="pr"
          :is-selected="selectedKey === pr.key"
          :now-ms="nowMs"
          :sync-state="syncStates[pr.key]"
          :draft-state="draftStates[pr.key]"
          :merge-state="mergeStates[pr.key]"
          :repo-labels-state="repoLabelsStates[pr.repository]"
          :label-state="labelStates[pr.key]"
          :rerun-state="rerunStates[pr.key]"
          :triage-state="triageStates[pr.key]"
          @select="$emit('select', $event)"
          @sync="$emit('sync', $event)"
          @rerun-checks="$emit('rerun-checks', $event)"
          @toggle-draft="(target, nextDraft) => $emit('toggle-draft', target, nextDraft)"
          @request-merge="(target, method) => $emit('request-merge', target, method)"
          @load-labels="$emit('load-labels', $event)"
          @retry-load-labels="$emit('retry-load-labels', $event)"
          @update-labels="(target, labels) => $emit('update-labels', target, labels)"
          @toggle-pin="$emit('toggle-pin', $event)"
          @snooze="(target, condition) => $emit('snooze', target, condition)"
          @unsnooze="$emit('unsnooze', $event)"
        >
          <template #inline-inspector>
            <slot name="inline-inspector" :pr="pr" />
          </template>
        </PrCard>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import PrCard from '@/components/PrCard.vue';
import type {
  PrDraftState,
  PrLabelsState,
  PrMergeState,
  PrRerunState,
  PrSyncState,
  PrTriageState,
  RepoLabelsState,
} from '@/composables/use-dashboard-state';
import type { BucketFilter } from '@/composables/use-url-state';
import type { MergeMethod, PrView, SnoozeCondition } from '@/types/pr';

interface Props {
  pullRequests: PrView[];
  selectedKey: string | null;
  nowMs: number;
  isLoading: boolean;
  activeBucket: BucketFilter;
  hasFilters: boolean;
  hasSearchQuery?: boolean;
  showSnoozed?: boolean;
  snoozedCount?: number;
  readyCount?: number;
  waitingCount?: number;
  syncStates?: Record<string, PrSyncState>;
  draftStates?: Record<string, PrDraftState>;
  mergeStates?: Record<string, PrMergeState>;
  repoLabelsStates?: Record<string, RepoLabelsState>;
  labelStates?: Record<string, PrLabelsState>;
  rerunStates?: Record<string, PrRerunState>;
  triageStates?: Record<string, PrTriageState>;
}

const props = withDefaults(defineProps<Props>(), {
  hasSearchQuery: false,
  showSnoozed: false,
  snoozedCount: 0,
  readyCount: 0,
  waitingCount: 0,
  syncStates: () => ({}),
  draftStates: () => ({}),
  mergeStates: () => ({}),
  repoLabelsStates: () => ({}),
  labelStates: () => ({}),
  rerunStates: () => ({}),
  triageStates: () => ({}),
});

defineEmits<{
  select: [pr: PrView];
  sync: [pr: PrView];
  'rerun-checks': [pr: PrView];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
  'request-merge': [pr: PrView, method: MergeMethod];
  'load-labels': [pr: PrView];
  'retry-load-labels': [pr: PrView];
  'update-labels': [pr: PrView, labels: string[]];
  'toggle-pin': [pr: PrView];
  snooze: [pr: PrView, condition: SnoozeCondition];
  unsnooze: [pr: PrView];
  'show-snoozed': [];
  'select-bucket': [bucket: BucketFilter];
}>();

const isInboxZero = computed<boolean>(
  () =>
    !props.hasSearchQuery &&
    (props.activeBucket === 'needs-me' || !props.hasFilters || props.snoozedCount > 0),
);

const showEmptyActions = computed<boolean>(
  () =>
    !props.hasSearchQuery &&
    ((props.snoozedCount > 0 && !props.showSnoozed) ||
      (props.readyCount > 0 && props.activeBucket !== 'ready') ||
      (props.waitingCount > 0 && props.activeBucket !== 'waiting')),
);

const headingLabel = computed<string>(() => {
  switch (props.activeBucket) {
    case 'needs-me':
      return 'Action Queue · Needs You';
    case 'ready':
      return 'Action Queue · Ready to Merge';
    case 'waiting':
      return 'Filtered Queue · Waiting on Others';
    case 'draft':
      return 'Filtered Queue · Drafts';
    case 'ci-failing':
      return 'Filtered Queue · Failing CI';
    default:
      return 'Action Queue';
  }
});

const emptyTitle = computed<string>(() => {
  if (isInboxZero.value) {
    return props.activeBucket === 'needs-me'
      ? 'Inbox Zero — nothing needs your action.'
      : 'Inbox Zero — action queue is clear.';
  }
  return props.hasFilters ? 'No pull requests match the active filters.' : 'Action queue is clear.';
});

const emptyHint = computed<string>(() => {
  if (isInboxZero.value) {
    return props.snoozedCount > 0 && !props.showSnoozed
      ? `${props.snoozedCount} pull ${props.snoozedCount === 1 ? 'request is' : 'requests are'} snoozed and will wake automatically when conditions change.`
      : 'You are all caught up right now.';
  }
  return props.hasFilters
    ? 'Clear or adjust filters to inspect other pull requests.'
    : 'Nothing needs your immediate action right now.';
});
</script>

<style scoped>
.action-queue {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  min-inline-size: 0;
  min-block-size: 0;
}

.section-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.queue-scroll {
  flex: 1 1 auto;
  min-block-size: 0;
  padding-block-end: 0.75rem;
  padding-inline-end: 0.25rem;
}

@media (max-width: 1023px) {
  .queue-scroll {
    overflow: visible;
    scrollbar-gutter: auto;
    padding-block-end: 0;
    padding-inline-end: 0;
  }
}

.section-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.section-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--ink-muted);
}

.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.empty-state {
  padding: 1.5rem 1.25rem;
  border-radius: 0.5rem;
  border: 1px dashed var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
}

.empty-state.inbox-zero {
  border-style: solid;
  border-color: color-mix(in srgb, var(--accent-emerald) 45%, var(--border-subtle));
  background-color: color-mix(in srgb, var(--accent-emerald-bg) 45%, var(--bg-surface));
}

.inbox-zero-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.inbox-zero-icon {
  color: var(--accent-emerald);
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.75rem;
}

.empty-action-btn {
  min-block-size: 1.9rem;
  padding: 0.2rem 0.65rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.empty-action-btn:hover {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.empty-title {
  margin: 0;
  font-weight: 600;
  color: var(--ink-primary);
}

.empty-hint {
  margin: 0.3rem 0 0;
  font-size: 0.8125rem;
}
</style>
