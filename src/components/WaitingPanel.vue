<template>
  <section class="rail-card" aria-labelledby="waiting-heading">
    <header class="rail-head">
      <h2 id="waiting-heading" class="rail-title">Waiting on Others</h2>
      <span class="rail-count mono-num">{{ pullRequests.length }}</span>
    </header>

    <p v-if="pullRequests.length === 0" class="rail-empty">
      No pull requests waiting on reviewers or CI.
    </p>

    <ul v-else role="list" class="waiting-list">
      <li v-for="pr in pullRequests" :key="pr.key" class="waiting-item">
        <button
          type="button"
          class="waiting-btn"
          :class="{ selected: selectedKey === pr.key }"
          @click="$emit('select', pr)"
        >
          <span class="waiting-top">
            <span class="waiting-key">
              <span class="waiting-repo">{{ compactRepo(pr.repository) }}</span>
              <span class="waiting-num mono-num">#{{ pr.number }}</span>
            </span>
            <span class="waiting-who">{{ waitingReason(pr) }}</span>
            <span class="waiting-age mono-num">{{
              formatIdleCompact(pr.idleDays, pr.lastCommittedAt, nowMs)
            }}</span>
          </span>
          <span class="waiting-title">{{ pr.title }}</span>
        </button>
        <slot name="inline-inspector" :pr="pr" />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { PrView } from '@/types/pr';
import { formatIdleCompact } from '@/utils/format';

interface Props {
  pullRequests: PrView[];
  selectedKey: string | null;
  nowMs: number;
}

defineProps<Props>();

defineEmits<{
  select: [pr: PrView];
}>();

function compactRepo(fullName: string): string {
  const parts = fullName.split('/');
  return parts[1] ?? fullName;
}

function waitingReason(pr: PrView): string {
  if (pr.mergeQueue) {
    return `queue #${pr.mergeQueue.position}`;
  }
  if (pr.autoMerge) {
    return 'auto-merge';
  }
  if (pr.ci.state === 'pending') {
    return `CI (${pr.ci.pending})`;
  }
  if (pr.review.pending.length > 0) {
    const first = pr.review.pending[0]!;
    return first.startsWith('@') ? first : `@${first}`;
  }
  if (pr.review.decision === 'required') {
    return 'review req';
  }
  return pr.merge.state === 'unknown' ? 'merge ?' : 'blocked';
}
</script>

<style scoped>
.rail-card {
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

.rail-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--ink-muted);
}

.waiting-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.waiting-btn {
  width: 100%;
  min-height: 2.25rem;
  padding: 0.45rem 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.waiting-btn:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-subtle);
}

.waiting-btn.selected {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
}

.waiting-top {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.75rem;
  min-width: 0;
}

.waiting-key {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  font-weight: 600;
  color: var(--ink-primary);
}

.waiting-repo {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.waiting-num {
  flex: 0 0 auto;
}

.waiting-who {
  flex: 0 1 auto;
  max-width: 7.5rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent-amber);
  font-weight: 500;
}

.waiting-age {
  color: var(--ink-muted);
  flex: 0 0 auto;
}

.waiting-title {
  font-size: 0.8rem;
  color: var(--ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
