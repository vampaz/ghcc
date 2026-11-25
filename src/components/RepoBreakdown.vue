<template>
  <section class="rail-card" aria-labelledby="repos-heading">
    <header class="rail-head">
      <h2 id="repos-heading" class="rail-title">By Repository</h2>
      <span class="rail-count mono-num">{{ entries.length }}</span>
    </header>

    <p v-if="entries.length === 0" class="rail-empty">No open repositories.</p>

    <ul v-else role="list" class="repo-list">
      <li v-for="entry in entries" :key="entry.name">
        <button
          type="button"
          class="repo-row"
          :class="{ active: activeRepo === entry.name, 'drafts-only': entry.displayCount === 0 }"
          :aria-pressed="activeRepo === entry.name"
          :title="repoRowTitle(entry)"
          @click="$emit('selectRepo', activeRepo === entry.name ? '' : entry.name)"
        >
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
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PrView } from '@/types/pr';

interface Props {
  pullRequests: PrView[];
  activeRepo: string;
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
  selectRepo: [repo: string];
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
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.repo-row {
  width: 100%;
  min-block-size: 2rem;
  padding: 0.3rem 0.45rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 3.5rem auto 1.25rem;
  align-items: center;
  gap: 0.45rem;
  text-align: left;
  font-size: 0.8rem;
}

.repo-row.drafts-only {
  color: var(--ink-muted);
}

.repo-row:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-subtle);
}

.repo-row.active {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
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
