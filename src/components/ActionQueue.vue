<template>
  <section class="action-queue" aria-labelledby="action-queue">
    <div class="section-head">
      <h1 id="action-queue" tabindex="-1" class="section-title">{{ headingLabel }}</h1>
      <span class="section-count mono-num">{{ pullRequests.length }}</span>
    </div>

    <div class="queue-scroll app-scroll">
      <div v-if="isLoading" class="empty-state">Loading pull request snapshot from GitHub...</div>

      <div v-else-if="pullRequests.length === 0" class="empty-state">
        <p class="empty-title">{{ emptyTitle }}</p>
        <p class="empty-hint">{{ emptyHint }}</p>
      </div>

      <ul v-else role="list" class="card-list">
        <PrCard
          v-for="pr in pullRequests"
          :key="pr.key"
          :pr="pr"
          :is-selected="selectedKey === pr.key"
          :now-ms="nowMs"
          :sync-state="syncStates[pr.key]"
          @select="$emit('select', $event)"
          @sync="$emit('sync', $event)"
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
import PrCard from '@/components/PrCard.vue';
import type { PrSyncState } from '@/composables/use-dashboard-state';
import type { BucketFilter } from '@/composables/use-url-state';
import type { PrView } from '@/types/pr';

interface Props {
  pullRequests: PrView[];
  selectedKey: string | null;
  nowMs: number;
  isLoading: boolean;
  activeBucket: BucketFilter;
  hasFilters: boolean;
  syncStates?: Record<string, PrSyncState>;
}

const props = withDefaults(defineProps<Props>(), {
  syncStates: () => ({}),
});

defineEmits<{
  select: [pr: PrView];
  sync: [pr: PrView];
}>();

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
  return props.hasFilters ? 'No pull requests match the active filters.' : 'Action queue is clear.';
});

const emptyHint = computed<string>(() => {
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
