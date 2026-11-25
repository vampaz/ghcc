<template>
  <section class="rail-card" aria-labelledby="repos-heading">
    <header class="rail-head">
      <div class="rail-head-left">
        <label
          v-if="entries.length > 0"
          for="toggle-all-repos"
          class="repo-all-label"
          :title="allSelected ? 'Uncheck all repositories' : 'Select all repositories'"
        >
          <input
            id="toggle-all-repos"
            type="checkbox"
            class="repo-checkbox"
            :checked="allSelected"
            :indeterminate.prop="someSelected"
            aria-label="Toggle all repositories"
            @change="$emit('toggleAll', allRepoNames)"
          />
          <span class="repo-checkbox-indicator" aria-hidden="true"></span>
        </label>
        <h2 id="repos-heading" class="rail-title">By Repository</h2>
      </div>
      <span class="rail-count mono-num">
        {{ selectedCount < entries.length ? `${selectedCount}/${entries.length}` : entries.length }}
      </span>
    </header>

    <p v-if="entries.length === 0" class="rail-empty">No open repositories.</p>

    <div v-else role="group" aria-labelledby="repos-heading" class="repo-list">
      <label
        v-for="entry in entries"
        :key="entry.name"
        :for="repoInputId(entry.name)"
        class="repo-row"
        :class="{
          active: isRepoChecked(entry.name) && repoSelection.mode === 'subset',
          unchecked: !isRepoChecked(entry.name),
          'drafts-only': entry.displayCount === 0,
        }"
        :title="repoRowTitle(entry)"
      >
        <input
          :id="repoInputId(entry.name)"
          type="checkbox"
          class="repo-checkbox"
          :checked="isRepoChecked(entry.name)"
          @change="$emit('toggleRepo', entry.name, allRepoNames)"
        />
        <span class="repo-checkbox-indicator" aria-hidden="true"></span>
        <span class="repo-name">{{ entry.shortName }}</span>
        <span class="repo-bar-track" aria-hidden="true">
          <span class="repo-bar-fill" :style="{ width: `${entry.barPct}%` }"></span>
        </span>
        <span class="repo-count mono-num">
          {{ entry.displayCount }}
          <span v-if="!includeDrafts && entry.draftCount > 0" class="repo-draft-note">
            +{{ entry.draftCount }}d
          </span>
        </span>
        <span class="repo-health" :data-health="entry.health" :title="healthTitle(entry.health)">
          <span aria-hidden="true">{{ healthGlyph(entry.health) }}</span>
          <span class="visually-hidden">{{ healthTitle(entry.health) }}</span>
        </span>
      </label>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RepoSelection } from '@/composables/use-url-state';
import type { PrView } from '@/types/pr';

interface Props {
  pullRequests: PrView[];
  repoSelection: RepoSelection;
  includeDrafts?: boolean;
}

type RepoHealth = 'failing' | 'pending' | 'ok' | 'muted';

interface RepoEntry {
  name: string;
  shortName: string;
  activeCount: number;
  draftCount: number;
  displayCount: number;
  barPct: number;
  health: RepoHealth;
}

const props = withDefaults(defineProps<Props>(), {
  includeDrafts: false,
});

defineEmits<{
  toggleRepo: [repo: string, allRepos: string[]];
  toggleAll: [allRepos: string[]];
}>();

const entries = computed<RepoEntry[]>(() => {
  const map = new Map<string, PrView[]>();
  for (const pr of props.pullRequests) {
    const list = map.get(pr.repository) ?? [];
    list.push(pr);
    map.set(pr.repository, list);
  }

  const raw = Array.from(map.entries()).map(([name, prs]) => {
    const activePrs = prs.filter((p) => p.bucket !== 'draft');
    const draftCount = prs.length - activePrs.length;
    const scopedPrs = props.includeDrafts ? prs : activePrs;
    let health: RepoHealth = scopedPrs.length === 0 ? 'muted' : 'ok';
    if (scopedPrs.some((p) => p.ci.state === 'failing' || p.merge.state === 'conflicting')) {
      health = 'failing';
    } else if (scopedPrs.some((p) => p.ci.state === 'pending')) {
      health = 'pending';
    }
    return {
      name,
      shortName: name.split('/')[1] ?? name,
      activeCount: activePrs.length,
      draftCount,
      displayCount: scopedPrs.length,
      health,
    };
  });

  raw.sort(
    (a, b) =>
      b.displayCount - a.displayCount ||
      b.draftCount - a.draftCount ||
      a.name.localeCompare(b.name),
  );

  const maxCount = Math.max(1, ...raw.map((entry) => entry.displayCount));

  return raw.map((entry) => ({
    ...entry,
    barPct:
      entry.displayCount === 0
        ? 0
        : Math.max(12, Math.round((entry.displayCount / maxCount) * 100)),
  }));
});

const allRepoNames = computed<string[]>(() => entries.value.map((entry) => entry.name));

function isRepoChecked(repoName: string): boolean {
  if (props.repoSelection.mode === 'all') {
    return true;
  }
  if (props.repoSelection.mode === 'none') {
    return false;
  }
  return props.repoSelection.repos.includes(repoName);
}

const selectedCount = computed<number>(() => {
  return entries.value.filter((entry) => isRepoChecked(entry.name)).length;
});

const allSelected = computed<boolean>(
  () => entries.value.length > 0 && selectedCount.value === entries.value.length,
);

const someSelected = computed<boolean>(
  () => selectedCount.value > 0 && selectedCount.value < entries.value.length,
);

function repoInputId(name: string): string {
  return `repo-check-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function repoRowTitle(entry: RepoEntry): string {
  const activeLabel = `${entry.activeCount} active`;
  if (entry.draftCount > 0) {
    return `${entry.name}: ${activeLabel}, ${entry.draftCount} draft`;
  }
  return `${entry.name}: ${activeLabel}`;
}

function healthGlyph(health: RepoHealth): string {
  if (health === 'failing') {
    return '!';
  }
  if (health === 'pending') {
    return '⏳';
  }
  if (health === 'muted') {
    return '–';
  }
  return '✓';
}

function healthTitle(health: RepoHealth): string {
  if (health === 'failing') {
    return 'Has failing CI or conflict';
  }
  if (health === 'pending') {
    return 'Checks pending';
  }
  if (health === 'muted') {
    return 'Only draft pull requests';
  }
  return 'All active checks passing';
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
  padding-inline-start: 0.25rem;
}

.rail-head-left {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-inline-size: 0;
}

.repo-all-label {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 1.5rem;
  min-inline-size: 1.5rem;
  cursor: pointer;
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

.repo-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.repo-row {
  position: relative;
  inline-size: 100%;
  min-block-size: 2rem;
  padding: 0.3rem 0.45rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  user-select: none;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 3.5rem auto 1.25rem;
  align-items: center;
  gap: 0.45rem;
  text-align: left;
  font-size: 0.8rem;
}

.repo-row.drafts-only {
  color: var(--ink-muted);
}

.repo-row.unchecked {
  opacity: 0.55;
}

.repo-row:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-subtle);
}

.repo-row.active {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
}

.repo-checkbox {
  inline-size: 0.95rem;
  block-size: 0.95rem;
  margin: 0;
  accent-color: var(--accent-blue);
  cursor: pointer;
}

.repo-checkbox-indicator {
  display: none;
}

@supports not (accent-color: auto) {
  .repo-checkbox {
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

  .repo-checkbox-indicator {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 0.95rem;
    block-size: 0.95rem;
    border-radius: 0.2rem;
    border: 1.5px solid var(--border-strong);
    background-color: var(--bg-surface);
  }

  .repo-checkbox:focus-visible + .repo-checkbox-indicator {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .repo-checkbox:checked + .repo-checkbox-indicator,
  .repo-checkbox:indeterminate + .repo-checkbox-indicator {
    border-color: var(--accent-blue);
    background-color: var(--accent-blue);
  }

  .repo-checkbox:checked + .repo-checkbox-indicator::after {
    content: '✓';
    color: #ffffff;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1;
  }

  .repo-checkbox:indeterminate + .repo-checkbox-indicator::after {
    content: '−';
    color: #ffffff;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1;
  }
}

.repo-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.repo-bar-track {
  height: 0.375rem;
  border-radius: 999px;
  overflow: hidden;
  background-color: var(--bg-surface-muted);
}

.repo-bar-fill {
  display: block;
  height: 100%;
  background-color: var(--accent-blue);
}

.repo-count {
  text-align: right;
  color: var(--ink-secondary);
  font-size: 0.75rem;
  white-space: nowrap;
}

.repo-draft-note {
  color: var(--ink-muted);
  font-size: 0.7rem;
}

.repo-health {
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--accent-emerald);
}

.repo-health[data-health='failing'] {
  color: var(--accent-red);
}

.repo-health[data-health='pending'] {
  color: var(--accent-blue);
}

.repo-health[data-health='muted'] {
  color: var(--ink-muted);
}
</style>
