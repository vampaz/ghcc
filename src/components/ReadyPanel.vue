<template>
  <section class="rail-card" aria-labelledby="ready-heading">
    <div class="rail-head">
      <h2 id="ready-heading" class="rail-title">Ready to Merge</h2>
      <span class="rail-count mono-num" :class="{ active: pullRequests.length > 0 }">{{
        pullRequests.length
      }}</span>
    </div>

    <p v-if="pullRequests.length === 0" class="rail-empty">No pull requests ready to merge.</p>

    <ul v-else role="list" class="ready-list">
      <li v-for="pr in pullRequests" :key="pr.key" class="ready-item">
        <div class="ready-row" :class="{ selected: selectedKey === pr.key }">
          <button type="button" class="ready-btn" @click="$emit('select', pr)">
            <span class="ready-top">
              <span class="ready-key">
                <span class="ready-repo">{{ compactRepo(pr.repository) }}</span>
                <span class="ready-num mono-num">#{{ pr.number }}</span>
              </span>
              <span v-if="!pr.sources.includes('authored')" class="ready-author">
                @{{ pr.author }}
              </span>
              <span v-else class="ready-status">ready</span>
              <span class="ready-age mono-num">{{
                formatIdleCompact(pr.idleDays, pr.lastCommittedAt, nowMs)
              }}</span>
            </span>
            <span class="ready-title">{{ pr.title }}</span>
            <span v-if="pr.labels.length > 0" class="ready-labels">
              <span
                v-for="label in pr.labels"
                :key="label.name"
                class="pr-label-pill ready-label-pill"
                :style="{ '--label-color': `#${label.color}` }"
                :title="label.description ?? label.name"
              >
                <span class="pr-label-dot" aria-hidden="true"></span>
                <span class="ready-label-name">{{ label.name }}</span>
              </span>
            </span>
          </button>

          <div class="ready-actions">
            <MergeControl
              compact
              :pr="pr"
              :merge-state="getMergeState(pr.key)"
              @request-merge="(target, method) => $emit('request-merge', target, method)"
            />
          </div>
        </div>

        <p v-if="mergeError(pr.key)" class="ready-error" role="alert">
          {{ mergeError(pr.key) }}
        </p>

        <slot name="inline-inspector" :pr="pr" />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import MergeControl from '@/components/MergeControl.vue';
import { IDLE_PR_MERGE_STATE, type PrMergeState } from '@/composables/use-dashboard-state';
import type { MergeMethod, PrView } from '@/types/pr';
import { formatIdleCompact } from '@/utils/format';

interface Props {
  pullRequests: PrView[];
  selectedKey: string | null;
  nowMs: number;
  mergeStates?: Record<string, PrMergeState>;
}

const props = withDefaults(defineProps<Props>(), {
  mergeStates: () => ({}),
});

defineEmits<{
  select: [pr: PrView];
  'request-merge': [pr: PrView, method: MergeMethod];
}>();

function getMergeState(prKey: string): PrMergeState {
  return props.mergeStates[prKey] ?? IDLE_PR_MERGE_STATE;
}

function mergeError(prKey: string): string | null {
  const state = getMergeState(prKey);
  return state.status === 'error' ? state.error : null;
}

function compactRepo(fullName: string): string {
  const parts = fullName.split('/');
  return parts[1] ?? fullName;
}
</script>

<style scoped>
.rail-card {
  container-type: inline-size;
  padding: 0.875rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.rail-title {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.rail-count {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-muted);
}

.rail-count.active {
  color: var(--accent-emerald);
}

.rail-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--ink-muted);
}

.ready-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.ready-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding-inline-end: 0.35rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}

.ready-row:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-subtle);
}

.ready-row.selected {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
}

.ready-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.ready-btn {
  flex: 1 1 auto;
  min-width: 0;
  min-block-size: 2.25rem;
  padding: 0.45rem 0.5rem;
  border-radius: 0.375rem;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.ready-error {
  margin: 0.25rem 0.5rem 0;
  padding: 0.35rem 0.5rem;
  border-radius: 0.35rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.ready-top {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.75rem;
  min-width: 0;
}

.ready-key {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  font-weight: 600;
  color: var(--ink-primary);
}

.ready-repo {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ready-num {
  flex: 0 0 auto;
}

.ready-status {
  flex: 0 0 auto;
  color: var(--accent-emerald);
  font-weight: 600;
}

.ready-author {
  flex: 0 1 auto;
  max-width: 7.5rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-secondary);
  font-weight: 500;
}

.ready-age {
  color: var(--ink-muted);
  flex: 0 0 auto;
}

.ready-title {
  font-size: 0.8rem;
  color: var(--ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ready-labels {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.15rem;
}

.ready-label-pill {
  font-size: 0.65rem;
  padding: 0.04rem 0.4rem;
  max-inline-size: 100%;
  overflow: hidden;
}

.ready-label-name {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

@container (max-width: 24rem) {
  .ready-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
    padding-inline-end: 0;
  }

  .ready-actions {
    padding: 0 0.5rem 0.45rem;
    justify-content: flex-start;
  }
}
</style>
