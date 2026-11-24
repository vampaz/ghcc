<template>
  <section class="rail-card" aria-labelledby="drafts-heading">
    <h2 id="drafts-heading" class="drafts-heading">
      <button
        type="button"
        class="drafts-toggle"
        :aria-expanded="expanded"
        aria-controls="drafts-list"
        @click="$emit('toggle')"
      >
        <span class="rail-title">Drafts</span>
        <span class="drafts-meta">
          <span class="rail-count mono-num">{{ pullRequests.length }}</span>
          <span class="expand-label">{{ expanded ? 'hide' : 'expand' }}</span>
        </span>
      </button>
    </h2>

    <div v-if="expanded" id="drafts-list" class="drafts-body">
      <p v-if="pullRequests.length === 0" class="rail-empty">No draft pull requests.</p>

      <ul v-else role="list" class="drafts-list">
        <li v-for="pr in pullRequests" :key="pr.key">
          <button
            type="button"
            class="draft-btn"
            :class="{ selected: selectedKey === pr.key }"
            @click="$emit('select', pr)"
          >
            <span class="draft-top">
              <span class="draft-key mono-num"
                >{{ compactRepo(pr.repository) }}#{{ pr.number }}</span
              >
              <span class="draft-age mono-num">{{
                formatIdleCompact(pr.idleDays, pr.lastCommittedAt, nowMs)
              }}</span>
            </span>
            <span class="draft-title">{{ pr.title }}</span>
            <span class="draft-summary">{{ pr.blockerSummary }}</span>
          </button>
          <slot name="inline-inspector" :pr="pr" />
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PrView } from '@/types/pr';
import { formatIdleCompact } from '@/utils/format';

interface Props {
  pullRequests: PrView[];
  expanded: boolean;
  selectedKey: string | null;
  nowMs: number;
}

defineProps<Props>();

defineEmits<{
  toggle: [];
  select: [pr: PrView];
}>();

function compactRepo(fullName: string): string {
  const parts = fullName.split('/');
  return parts[1] ?? fullName;
}
</script>

<style scoped>
.rail-card {
  padding: 0.65rem 0.875rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.drafts-heading {
  margin: 0;
}

.drafts-toggle {
  width: 100%;
  min-height: 2rem;
  padding: 0.25rem 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.rail-title {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.drafts-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.rail-count {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-muted);
}

.expand-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent-blue);
}

.rail-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--ink-muted);
}

.drafts-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.draft-btn {
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

.draft-btn:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-subtle);
}

.draft-btn.selected {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
}

.draft-top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.draft-key {
  font-weight: 600;
}

.draft-age {
  color: var(--ink-muted);
}

.draft-title {
  font-size: 0.8125rem;
  color: var(--ink-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-summary {
  font-size: 0.75rem;
  color: var(--ink-secondary);
}
</style>
