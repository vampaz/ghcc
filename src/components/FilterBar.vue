<template>
  <section class="filter-bar" aria-label="Pull request filters">
    <div class="filter-group" role="group" aria-label="Queue ownership">
      <button
        v-for="opt in viewOptions"
        :key="opt.value"
        type="button"
        class="seg-btn"
        :class="{ active: view === opt.value }"
        :aria-pressed="view === opt.value"
        @click="$emit('update:view', opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>

    <div class="control-item">
      <label for="repo-filter" class="visually-hidden">Filter by repository</label>
      <select id="repo-filter" class="filter-select" :value="repo" @change="onRepoChange">
        <option value="">All repositories ({{ totalCount }})</option>
        <option v-for="entry in repoOptions" :key="entry.name" :value="entry.name">
          {{ entry.name }} ({{ entry.count }})
        </option>
      </select>
    </div>

    <div class="control-item search-wrap">
      <label for="pr-search" class="visually-hidden">Search pull requests</label>
      <input
        id="pr-search"
        ref="searchInputRef"
        type="search"
        class="search-input"
        placeholder="Search PRs, branches, blockers (/)"
        :value="q"
        @beforeinput="onBeforeInput"
        @input="onQueryInput"
      />
    </div>

    <button
      type="button"
      class="draft-toggle"
      :class="{ active: drafts }"
      :aria-pressed="drafts"
      @click="$emit('update:drafts', !drafts)"
    >
      <span class="check-box" aria-hidden="true">{{ drafts ? '✓' : '' }}</span>
      <span>Drafts ({{ draftCount }})</span>
    </button>

    <button v-if="bucket" type="button" class="bucket-chip" @click="$emit('update:bucket', '')">
      <span>bucket: {{ bucket }}</span>
      <span aria-hidden="true">×</span>
    </button>

    <button v-if="hasActiveFilters" type="button" class="clear-btn" @click="$emit('clear')">
      Clear
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BucketFilter, ViewFilter } from '@/composables/use-url-state';

interface RepoOption {
  name: string;
  count: number;
}

interface Props {
  view: ViewFilter;
  bucket: BucketFilter;
  q: string;
  repo: string;
  drafts: boolean;
  repoOptions: RepoOption[];
  totalCount: number;
  draftCount: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:view': [value: ViewFilter];
  'update:bucket': [value: BucketFilter];
  'update:q': [value: string];
  'update:repo': [value: string];
  'update:drafts': [value: boolean];
  clear: [];
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);
let suppressSlashUntil = 0;

const viewOptions: Array<{ value: ViewFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'review', label: 'To Review' },
];

const hasActiveFilters = computed<boolean>(() => {
  return (
    props.view !== 'all' ||
    props.bucket !== '' ||
    props.q.trim() !== '' ||
    props.repo !== '' ||
    props.drafts
  );
});

function onRepoChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  emit('update:repo', select.value);
}

function onBeforeInput(event: Event): void {
  const inputEvent = event as InputEvent;
  if (performance.now() <= suppressSlashUntil && inputEvent.data === '/') {
    inputEvent.preventDefault();
    suppressSlashUntil = 0;
  }
}

function onQueryInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (performance.now() <= suppressSlashUntil && input.value === `${props.q}/`) {
    input.value = props.q;
    suppressSlashUntil = 0;
    return;
  }
  suppressSlashUntil = 0;
  emit('update:q', input.value);
}

function focusSearch(options: { suppressSlash?: boolean } = {}): void {
  if (options.suppressSlash) {
    suppressSlashUntil = performance.now() + 150;
  }
  searchInputRef.value?.focus();
}

defineExpose({ focusSearch });
</script>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.625rem;
}

.filter-group {
  display: inline-flex;
  border-radius: 0.4rem;
  border: 1px solid var(--border-strong);
  overflow: hidden;
  background-color: var(--bg-surface);
}

.seg-btn {
  min-height: 2rem;
  padding: 0.25rem 0.7rem;
  border: 0;
  border-right: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}

.seg-btn:last-child {
  border-right: 0;
}

.seg-btn.active {
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  font-weight: 600;
}

.control-item {
  min-width: 0;
}

.search-wrap {
  flex: 1 1 13rem;
}

.filter-select,
.search-input,
.draft-toggle,
.bucket-chip,
.clear-btn {
  min-height: 2rem;
  padding: 0.25rem 0.625rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.8125rem;
}

.search-input {
  width: 100%;
}

.draft-toggle,
.bucket-chip,
.clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-weight: 500;
}

.draft-toggle.active {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.check-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  border-radius: 0.2rem;
  border: 1px solid var(--border-strong);
  font-size: 0.7rem;
  line-height: 1;
}

.bucket-chip {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.clear-btn {
  color: var(--ink-secondary);
}
</style>
