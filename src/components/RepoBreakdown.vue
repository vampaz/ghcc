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
          :class="{ active: activeRepo === entry.name }"
          :aria-pressed="activeRepo === entry.name"
          @click="$emit('selectRepo', activeRepo === entry.name ? '' : entry.name)"
        >
          <span class="repo-name">{{ entry.shortName }}</span>
          <span class="repo-bar-track" aria-hidden="true">
            <span class="repo-bar-fill" :style="{ width: `${entry.barPct}%` }"></span>
          </span>
          <span class="repo-count mono-num">{{ entry.count }}</span>
          <span class="repo-health" :data-health="entry.health" :title="healthTitle(entry.health)">
            {{ healthGlyph(entry.health) }}
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
}

type RepoHealth = 'failing' | 'pending' | 'ok';

interface RepoEntry {
  name: string;
  shortName: string;
  count: number;
  barPct: number;
  health: RepoHealth;
}

const props = defineProps<Props>();

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
  const sorted = Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  const maxCount = sorted[0]?.[1].length ?? 1;

  return sorted.map(([name, prs]) => {
    let health: RepoHealth = 'ok';
    if (prs.some((p) => p.ci.state === 'failing' || p.merge.state === 'conflicting')) {
      health = 'failing';
    } else if (prs.some((p) => p.ci.state === 'pending')) {
      health = 'pending';
    }
    return {
      name,
      shortName: name.split('/')[1] ?? name,
      count: prs.length,
      barPct: Math.max(12, Math.round((prs.length / maxCount) * 100)),
      health,
    };
  });
});

function healthGlyph(health: RepoHealth): string {
  if (health === 'failing') {
    return '!';
  }
  if (health === 'pending') {
    return '⏳';
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
  return 'All checks passing';
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
  min-height: 2rem;
  padding: 0.3rem 0.45rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.25rem 1.75rem 1.25rem;
  align-items: center;
  gap: 0.45rem;
  text-align: left;
  font-size: 0.8rem;
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
</style>
