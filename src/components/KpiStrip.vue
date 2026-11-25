<template>
  <section class="kpi-strip" aria-label="Pull request summary metrics">
    <button
      type="button"
      class="kpi-tile"
      :class="{ active: activeBucket === 'needs-me' }"
      :aria-pressed="activeBucket === 'needs-me'"
      @click="$emit('selectBucket', activeBucket === 'needs-me' ? '' : 'needs-me')"
    >
      <span class="kpi-label">Needs You</span>
      <span class="kpi-main">
        <span class="kpi-value mono-num" data-tone="warn">{{ needsMeCount }}</span>
        <span class="kpi-sub tabular">{{ needsCiOrConflict }} CI/conf · {{ needsReview }} rev</span>
      </span>
    </button>

    <button
      type="button"
      class="kpi-tile"
      :class="{ active: activeBucket === 'ready' }"
      :aria-pressed="activeBucket === 'ready'"
      @click="$emit('selectBucket', activeBucket === 'ready' ? '' : 'ready')"
    >
      <span class="kpi-label">Ready to Merge</span>
      <span class="kpi-main">
        <span class="kpi-value mono-num" data-tone="ok">{{ readyCount }}</span>
        <span class="kpi-sub">{{ readyCount > 0 ? 'merge now' : 'none ready' }}</span>
      </span>
    </button>

    <button
      type="button"
      class="kpi-tile"
      :class="{ active: activeBucket === 'waiting' }"
      :aria-pressed="activeBucket === 'waiting'"
      @click="$emit('selectBucket', activeBucket === 'waiting' ? '' : 'waiting')"
    >
      <span class="kpi-label">Waiting on Others</span>
      <span class="kpi-main">
        <span class="kpi-value mono-num">{{ waitingCount }}</span>
        <span class="kpi-sub tabular">
          {{ waitingCount > 0 ? `oldest ${oldestWaitingLabel}` : 'none waiting' }}
        </span>
      </span>
    </button>

    <button
      type="button"
      class="kpi-tile"
      :class="{ active: activeBucket === 'ci-failing' }"
      :aria-pressed="activeBucket === 'ci-failing'"
      @click="$emit('selectBucket', activeBucket === 'ci-failing' ? '' : 'ci-failing')"
    >
      <span class="kpi-label">CI Health</span>
      <span class="kpi-main kpi-health-col">
        <span class="kpi-health-top">
          <span class="kpi-value mono-num" :data-tone="ciStats.failing > 0 ? 'err' : 'ok'">
            {{ ciStats.passPct }}%
          </span>
          <span class="kpi-sub tabular">
            {{ ciStats.failing }} fail · {{ ciStats.pending }} pend
          </span>
        </span>
        <span class="ci-bar" aria-hidden="true">
          <span class="seg-pass" :style="{ width: `${ciStats.passPct}%` }"></span>
          <span class="seg-pend" :style="{ width: `${ciStats.pendPct}%` }"></span>
          <span class="seg-fail" :style="{ width: `${ciStats.failPct}%` }"></span>
        </span>
      </span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BucketFilter } from '@/composables/use-url-state';
import type { PrView } from '@/types/pr';
import { formatIdleCompact } from '@/utils/format';

interface Props {
  pullRequests: PrView[];
  activeBucket: BucketFilter;
  nowMs?: number;
  waitingIncludesTeam?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  nowMs: () => Date.now(),
  waitingIncludesTeam: false,
});

defineEmits<{
  selectBucket: [bucket: BucketFilter];
}>();

const needsMePrs = computed<PrView[]>(() =>
  props.pullRequests.filter((pr) => pr.bucket === 'needs-me'),
);

const needsMeCount = computed<number>(() => needsMePrs.value.length);

const needsCiOrConflict = computed<number>(
  () =>
    needsMePrs.value.filter(
      (pr) =>
        pr.sources.includes('authored') &&
        (pr.ci.state === 'failing' || pr.merge.state === 'conflicting'),
    ).length,
);

const needsReview = computed<number>(
  () => needsMePrs.value.filter((pr) => pr.sources.includes('review-requested')).length,
);

const readyCount = computed<number>(
  () => props.pullRequests.filter((pr) => pr.bucket === 'ready').length,
);

const waitingPrs = computed<PrView[]>(() =>
  props.pullRequests.filter(
    (pr) =>
      pr.bucket === 'waiting' && (props.waitingIncludesTeam || pr.sources.includes('authored')),
  ),
);

const waitingCount = computed<number>(() => waitingPrs.value.length);

const oldestWaitingLabel = computed<string>(() => {
  let oldest: PrView | null = null;
  let oldestCommitTs = Infinity;
  for (const pr of waitingPrs.value) {
    const ts = Date.parse(pr.lastCommittedAt);
    const effectiveTs = Number.isFinite(ts) ? ts : props.nowMs - pr.idleDays * 24 * 60 * 60 * 1000;
    if (!oldest || effectiveTs < oldestCommitTs) {
      oldest = pr;
      oldestCommitTs = effectiveTs;
    }
  }
  if (!oldest) {
    return '0m';
  }
  return formatIdleCompact(oldest.idleDays, oldest.lastCommittedAt, props.nowMs).replace(
    / idle$/,
    '',
  );
});

const ciStats = computed(() => {
  const withCi = props.pullRequests.filter((pr) => pr.ci.state !== 'none');
  if (withCi.length === 0) {
    return { failing: 0, pending: 0, passPct: 100, pendPct: 0, failPct: 0 };
  }
  let passing = 0;
  let failing = 0;
  let pending = 0;
  for (const pr of withCi) {
    if (pr.ci.state === 'passing') {
      passing++;
    } else if (pr.ci.state === 'failing') {
      failing++;
    } else if (pr.ci.state === 'pending') {
      pending++;
    }
  }
  const total = withCi.length;
  const passPct = Math.round((passing / total) * 100);
  const failPct = Math.round((failing / total) * 100);
  const pendPct = Math.max(0, 100 - passPct - failPct);
  return { failing, pending, passPct, pendPct, failPct };
});
</script>

<style scoped>
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.kpi-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem;
  min-height: 4.5rem;
  padding: 0.75rem 0.875rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.kpi-tile:hover {
  border-color: var(--border-strong);
  background-color: var(--bg-surface-hover);
}

.kpi-tile.active {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
}

.kpi-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.kpi-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
}

.kpi-health-col {
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}

.kpi-health-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.kpi-value {
  font-size: 1.375rem;
  font-weight: 700;
  line-height: 1.1;
}

.kpi-value[data-tone='warn'] {
  color: var(--accent-amber);
}

.kpi-value[data-tone='ok'] {
  color: var(--accent-emerald);
}

.kpi-value[data-tone='err'] {
  color: var(--accent-red);
}

.kpi-sub {
  font-size: 0.75rem;
  color: var(--ink-secondary);
  white-space: nowrap;
}

.ci-bar {
  display: flex;
  width: 100%;
  height: 0.375rem;
  border-radius: 999px;
  overflow: hidden;
  background-color: var(--bg-surface-muted);
}

.seg-pass {
  background-color: var(--accent-emerald);
}

.seg-pend {
  background-color: var(--accent-blue);
}

.seg-fail {
  background-color: var(--accent-red);
}

@media (max-width: 1023px) {
  .kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 479px) {
  .kpi-strip {
    grid-template-columns: 1fr;
  }
}
</style>
