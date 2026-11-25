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

    <label for="include-drafts" class="drafts-checkbox" :class="{ active: drafts }">
      <input
        id="include-drafts"
        type="checkbox"
        class="drafts-checkbox-input"
        :checked="drafts"
        @change="onDraftsChange"
      />
      <span class="drafts-checkbox-label">
        Include drafts
        <span class="drafts-count mono-num">({{ draftCount }})</span>
      </span>
    </label>

    <div class="control-item search-wrap">
      <label for="pr-search" class="visually-hidden">Search pull requests</label>
      <input
        id="pr-search"
        ref="searchInputRef"
        type="search"
        class="search-input"
        placeholder="Search PRs, branches, blockers"
        :value="q"
        @beforeinput="onBeforeInput"
        @input="onQueryInput"
      />
      <kbd v-if="!q" class="search-kbd" aria-hidden="true">/</kbd>
    </div>

    <button
      v-if="repoChipLabel"
      type="button"
      class="filter-chip repo-chip"
      :title="repoChipTitle"
      :aria-label="`Clear repository filter (${repoChipLabel})`"
      @click="$emit('clearRepos')"
    >
      <span>{{ repoChipLabel }}</span>
      <span aria-hidden="true">×</span>
    </button>

    <button
      v-if="bucket"
      type="button"
      class="filter-chip bucket-chip"
      :aria-label="`Clear ${bucketLabel} filter`"
      @click="$emit('update:bucket', '')"
    >
      <span>{{ bucketLabel }}</span>
      <span aria-hidden="true">×</span>
    </button>

    <button v-if="hasActiveFilters" type="button" class="clear-btn" @click="$emit('clear')">
      Clear
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BucketFilter, RepoSelection, ViewFilter } from '@/composables/use-url-state';

interface Props {
  view: ViewFilter;
  bucket: BucketFilter;
  q: string;
  repoSelection: RepoSelection;
  drafts: boolean;
  draftCount: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:view': [value: ViewFilter];
  'update:bucket': [value: BucketFilter];
  'update:q': [value: string];
  clearRepos: [];
  'update:drafts': [value: boolean];
  clear: [];
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);
let suppressSlashUntil = 0;

const viewOptions: Array<{ value: ViewFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'review', label: 'To Review' },
  { value: 'team', label: 'Team' },
];

const bucketLabel = computed<string>(() => {
  switch (props.bucket) {
    case 'needs-me':
      return 'Needs You';
    case 'ready':
      return 'Ready to Merge';
    case 'waiting':
      return 'Waiting on Others';
    case 'ci-failing':
      return 'Failing CI';
    case 'draft':
      return 'Drafts';
    default:
      return '';
  }
});

const repoChipLabel = computed<string>(() => {
  if (props.repoSelection.mode === 'all') {
    return '';
  }
  if (props.repoSelection.mode === 'none') {
    return 'No repos';
  }
  if (props.repoSelection.repos.length === 1) {
    return compactRepo(props.repoSelection.repos[0]!);
  }
  return `${props.repoSelection.repos.length} repos`;
});

const repoChipTitle = computed<string | undefined>(() => {
  if (props.repoSelection.mode === 'subset') {
    return props.repoSelection.repos.join(', ');
  }
  return undefined;
});

const hasActiveFilters = computed<boolean>(() => {
  return (
    props.view !== 'all' ||
    props.bucket !== '' ||
    props.q.trim() !== '' ||
    props.repoSelection.mode !== 'all' ||
    props.drafts
  );
});

function onDraftsChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  emit('update:drafts', input.checked);
}

function compactRepo(fullName: string): string {
  const parts = fullName.split('/');
  return parts[1] ?? fullName;
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
  min-block-size: 2rem;
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

.drafts-checkbox {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-block-size: 2rem;
  padding: 0.25rem 0.65rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.drafts-checkbox:hover {
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.drafts-checkbox.active {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  font-weight: 600;
}

.drafts-checkbox-input {
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  accent-color: var(--accent-blue);
  cursor: pointer;
}

.drafts-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.drafts-count {
  font-size: 0.75rem;
  color: var(--ink-muted);
}

.drafts-checkbox.active .drafts-count {
  color: inherit;
}

@supports not (accent-color: auto) {
  .drafts-checkbox-input {
    position: absolute;
    clip-path: inset(50%);
    overflow: hidden;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    white-space: nowrap;
  }

  .drafts-checkbox-label {
    position: relative;
    padding-inline-start: 1.35rem;
  }

  .drafts-checkbox-label::before {
    content: '';
    position: absolute;
    inset-inline-start: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 0.2rem;
    border: 1.5px solid var(--border-strong);
    background-color: var(--bg-surface);
  }

  .drafts-checkbox-input:focus-visible + .drafts-checkbox-label::before {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .drafts-checkbox-input:checked + .drafts-checkbox-label::before {
    border-color: var(--accent-blue);
    background-color: var(--accent-blue);
  }

  .drafts-checkbox-input:checked + .drafts-checkbox-label::after {
    content: '✓';
    position: absolute;
    inset-inline-start: 0.15rem;
    top: 50%;
    transform: translateY(-50%);
    color: #ffffff;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1;
  }
}

.control-item {
  min-width: 0;
}

.search-wrap {
  position: relative;
  flex: 1 1 13rem;
}

.search-input,
.filter-chip,
.clear-btn {
  min-block-size: 2rem;
  padding: 0.25rem 0.625rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.8125rem;
}

.search-input {
  width: 100%;
  padding-inline-end: 2rem;
}

.search-kbd {
  position: absolute;
  inset-inline-end: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  padding: 0.05rem 0.35rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  line-height: 1.25;
}

.filter-chip,
.clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-weight: 500;
}

.filter-chip {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.clear-btn {
  color: var(--ink-secondary);
}

@media (max-width: 639px), (pointer: coarse) {
  .search-input {
    padding-inline-end: 0.625rem;
  }

  .search-kbd {
    display: none;
  }
}
</style>
