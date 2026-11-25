<template>
  <li
    class="pr-card"
    :class="{
      selected: isSelected,
      'stale-warm': pr.idleDays > 3 && pr.idleDays <= 7,
      'stale-hot': pr.idleDays > 7,
    }"
    :data-accent="edgeTone"
  >
    <div class="pr-card-body">
      <button
        type="button"
        class="pr-card-trigger"
        :data-pr-key="pr.key"
        :aria-expanded="isSelected"
        @click="$emit('select', pr)"
      >
        <span class="pr-top-row">
          <span class="pr-key mono-num">{{ pr.key }}</span>
          <span class="pr-tags">
            <span v-if="!pr.sources.includes('authored')" class="tag" data-tone="muted">
              @{{ pr.author }}
            </span>
            <span
              v-if="pr.idleDays > 3"
              class="tag"
              data-tone="stale"
              :title="`No commits for ${pr.idleDays} days`"
            >
              stale
            </span>
            <span v-if="reviewBadge" class="tag" data-tone="amber">{{ reviewBadge }}</span>
            <span v-else-if="pr.bucket === 'ready'" class="tag" data-tone="ok">ready</span>
            <span v-else-if="pr.mergeQueue" class="tag" data-tone="blue">
              queue #{{ pr.mergeQueue.position }}
            </span>
            <span v-else-if="pr.autoMerge" class="tag" data-tone="blue">auto-merge</span>
            <span v-else-if="pr.isDraft" class="tag" data-tone="muted">draft</span>

            <span
              v-if="pr.merge.state === 'unknown'"
              class="tag mono-num"
              data-tone="muted"
              title="GitHub computes mergeability lazily; ghcc will re-probe within rate caps."
            >
              merge ?
            </span>
          </span>
        </span>

        <span class="pr-title">{{ pr.title }}</span>

        <span class="pr-summary">{{ pr.blockerSummary }}</span>

        <span class="pr-metrics-row">
          <span class="ci-mini" :title="ciTooltip">
            <span class="ci-mini-track" aria-hidden="true">
              <span class="ci-pass" :style="{ width: `${ciWidths.pass}%` }"></span>
              <span class="ci-pend" :style="{ width: `${ciWidths.pend}%` }"></span>
              <span class="ci-fail" :style="{ width: `${ciWidths.fail}%` }"></span>
            </span>
            <span v-if="pr.ci.hiddenCount > 0" class="ci-cap-note mono-num">
              +{{ pr.ci.hiddenCount }}
            </span>
          </span>

          <span class="diff-stats mono-num">
            <span class="diff-add">+{{ pr.size.additions }}</span>
            <span class="diff-del">−{{ pr.size.deletions }}</span>
            <span class="diff-bar" aria-hidden="true">
              <span class="diff-bar-add" :style="{ width: `${diffWidths.add}%` }"></span>
              <span class="diff-bar-del" :style="{ width: `${diffWidths.del}%` }"></span>
            </span>
            <span class="diff-files">{{ pr.size.files }}f</span>
            <span class="idle-age">{{
              formatIdleCompact(pr.idleDays, pr.lastCommittedAt, nowMs)
            }}</span>
          </span>
        </span>
      </button>

      <div class="pr-card-actions">
        <DraftToggle
          :pr-key="pr.key"
          :is-draft="pr.isDraft"
          :draft-state="draftState"
          @toggle="$emit('toggle-draft', pr, $event)"
        />

        <button
          v-if="showSyncButton"
          type="button"
          class="sync-btn"
          :class="{
            synced: syncState.status === 'synced',
            syncing: syncState.status === 'syncing',
          }"
          :aria-disabled="isSyncBusy ? 'true' : undefined"
          :aria-label="syncAriaLabel"
          :title="`Merge ${pr.baseRefName} into ${pr.headRefName}`"
          @click="onSyncClick"
        >
          <progress
            v-if="syncState.status === 'syncing'"
            class="loading-spinner"
            aria-label="Syncing branch"
          ></progress>
          <span>{{ syncButtonText }}</span>
        </button>

        <a
          :href="pr.url"
          target="_blank"
          rel="noopener noreferrer"
          class="external-link"
          :aria-label="`Open ${pr.key} on GitHub`"
          title="Open on GitHub (o)"
        >
          ↗
        </a>
      </div>
    </div>

    <p v-if="draftState.status === 'error'" class="sync-error" role="alert">
      {{ draftState.error }}
    </p>

    <p v-if="syncState.status === 'error'" class="sync-error" role="alert">
      {{ syncState.error }}
    </p>

    <slot name="inline-inspector" />
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import DraftToggle from '@/components/DraftToggle.vue';
import {
  IDLE_PR_DRAFT_STATE,
  IDLE_PR_SYNC_STATE,
  type PrDraftState,
  type PrSyncState,
} from '@/composables/use-dashboard-state';
import type { PrView } from '@/types/pr';
import { formatIdleCompact } from '@/utils/format';

interface Props {
  pr: PrView;
  isSelected: boolean;
  nowMs: number;
  syncState?: PrSyncState;
  draftState?: PrDraftState;
}

const props = withDefaults(defineProps<Props>(), {
  syncState: () => IDLE_PR_SYNC_STATE,
  draftState: () => IDLE_PR_DRAFT_STATE,
});

const emit = defineEmits<{
  select: [pr: PrView];
  sync: [pr: PrView];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
}>();

const showSyncButton = computed<boolean>(
  () => props.pr.merge.state === 'behind' || props.syncState.status !== 'idle',
);

const isSyncBusy = computed<boolean>(
  () => props.syncState.status === 'syncing' || props.syncState.status === 'synced',
);

const syncButtonText = computed<string>(() => {
  if (props.syncState.status === 'syncing') {
    return 'Syncing';
  }
  if (props.syncState.status === 'synced') {
    return 'Synced';
  }
  return 'Sync';
});

const syncAriaLabel = computed<string>(() => {
  return `${syncButtonText.value} ${props.pr.key} with ${props.pr.baseRefName}`;
});

function onSyncClick(): void {
  if (isSyncBusy.value) {
    return;
  }
  emit('sync', props.pr);
}

const edgeTone = computed<'red' | 'amber' | 'emerald' | 'muted'>(() => {
  if (props.pr.isDraft && props.pr.bucket === 'draft') {
    return 'muted';
  }
  if (props.pr.ci.state === 'failing' || props.pr.merge.state === 'conflicting') {
    return 'red';
  }
  if (props.pr.bucket === 'ready') {
    return 'emerald';
  }
  if (props.pr.bucket === 'needs-me') {
    return 'amber';
  }
  return 'muted';
});

const reviewBadge = computed<string | null>(() => {
  if (!props.pr.sources.includes('review-requested')) {
    return null;
  }
  return props.pr.review.requestKind === 'team' ? 'team review' : 'review';
});

const ciWidths = computed(() => {
  const { passing, failing, pending, state } = props.pr.ci;
  const total = passing + failing.length + pending;
  if (total === 0) {
    if (state === 'failing') {
      return { pass: 0, pend: 0, fail: 100 };
    }
    if (state === 'pending') {
      return { pass: 0, pend: 100, fail: 0 };
    }
    return { pass: 0, pend: 0, fail: 0 };
  }
  const pass = Math.round((passing / total) * 100);
  const fail = Math.round((failing.length / total) * 100);
  const pend = Math.max(0, 100 - pass - fail);
  return { pass, pend, fail };
});

const ciTooltip = computed<string>(() => {
  const { passing, failing, pending, hiddenCount, state } = props.pr.ci;
  if (state === 'none') {
    return 'No CI checks';
  }
  const shown = passing + failing.length + pending;
  const total = shown + hiddenCount;
  const base = `${passing} passing, ${failing.length} failing, ${pending} pending`;
  return hiddenCount > 0 ? `${base} (showing ${shown} of ${total} checks)` : base;
});

const diffWidths = computed(() => {
  const total = props.pr.size.additions + props.pr.size.deletions;
  if (total === 0) {
    return { add: 50, del: 50 };
  }
  const add = Math.round((props.pr.size.additions / total) * 100);
  return { add, del: 100 - add };
});
</script>

<style scoped>
.pr-card {
  position: relative;
  container-type: inline-size;
  border-radius: 0.5rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.pr-card[data-accent='red'] {
  border-left-color: var(--accent-red);
}

.pr-card[data-accent='amber'] {
  border-left-color: var(--accent-amber);
}

.pr-card[data-accent='emerald'] {
  border-left-color: var(--accent-emerald);
}

.pr-card[data-accent='muted'] {
  border-left-color: var(--border-strong);
}

.pr-card.stale-warm {
  background-color: var(--bg-stale-warm);
}

.pr-card.stale-hot {
  background-color: var(--bg-stale-hot);
}

.pr-card:hover {
  background-color: var(--bg-surface-hover);
}

.pr-card.stale-warm:hover {
  background-color: color-mix(in srgb, var(--bg-stale-warm) 92%, var(--ink-primary) 8%);
}

.pr-card.stale-hot:hover {
  background-color: color-mix(in srgb, var(--bg-stale-hot) 92%, var(--ink-primary) 8%);
}

.pr-card.selected {
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 1px var(--accent-blue);
}

.pr-card-body {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
}

.pr-card-trigger {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
  padding: 0.75rem 0.875rem;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 0.375rem;
}

.pr-top-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 0.5rem;
}

.pr-key {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

.pr-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.tag {
  padding: 0.08rem 0.42rem;
  border-radius: 0.3rem;
  font-size: 0.7rem;
  font-weight: 600;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-secondary);
}

.tag[data-tone='stale'] {
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
  border-color: color-mix(in srgb, var(--accent-amber) 45%, transparent);
}

.tag[data-tone='amber'] {
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
  border-color: var(--accent-amber);
}

.tag[data-tone='ok'] {
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
  border-color: var(--accent-emerald);
}

.tag[data-tone='blue'] {
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  border-color: var(--accent-blue);
}

.pr-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--ink-primary);
  overflow-wrap: anywhere;
}

.pr-summary {
  font-size: 0.8125rem;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

.pr-metrics-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 0.75rem;
  margin-top: 0.15rem;
}

.ci-mini {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.ci-mini-track {
  display: flex;
  width: 4.5rem;
  height: 0.375rem;
  border-radius: 999px;
  overflow: hidden;
  background-color: var(--bg-surface-muted);
}

.ci-pass {
  background-color: var(--accent-emerald);
}

.ci-pend {
  background-color: var(--accent-blue);
}

.ci-fail {
  background-color: var(--accent-red);
}

.ci-cap-note {
  font-size: 0.7rem;
  color: var(--ink-muted);
}

.diff-stats {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
}

.diff-add {
  color: var(--accent-emerald);
}

.diff-del {
  color: var(--accent-red);
}

.diff-bar {
  display: inline-flex;
  width: 2.25rem;
  height: 0.32rem;
  border-radius: 999px;
  overflow: hidden;
  background-color: var(--bg-surface-muted);
}

.diff-bar-add {
  background-color: var(--accent-emerald);
}

.diff-bar-del {
  background-color: var(--accent-red);
}

.diff-files,
.idle-age {
  color: var(--ink-muted);
}

.pr-card-actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
  padding: 0 0.875rem 0.625rem;
}

@container (min-width: 28rem) {
  .pr-card-body {
    flex-direction: row;
    align-items: flex-start;
    gap: 0.375rem;
  }

  .pr-card-trigger {
    padding: 0.75rem 0.5rem 0.75rem 0.875rem;
  }

  .pr-card-actions {
    display: inline-flex;
    padding: 0;
    margin: 0.625rem 0.625rem 0 0;
  }
}

.sync-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-block-size: 2rem;
  min-inline-size: 2rem;
  padding: 0.25rem 0.6rem;
  border-radius: 0.375rem;
  border: 1px solid var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.sync-btn:hover:not([aria-disabled='true']) {
  background-color: var(--accent-blue);
  color: #ffffff;
}

.sync-btn.synced {
  border-color: var(--accent-emerald);
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
}

.sync-btn[aria-disabled='true'] {
  cursor: default;
  opacity: 0.85;
}

.sync-error {
  margin: 0 0.875rem 0.65rem;
  padding: 0.4rem 0.6rem;
  border-radius: 0.35rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.external-link {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 2rem;
  min-inline-size: 2rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-secondary);
  font-size: 0.85rem;
  text-decoration: none;
}

.external-link:hover {
  color: var(--ink-primary);
  border-color: var(--border-strong);
}
</style>
