<template>
  <div class="inspector-body">
    <div v-if="pr" class="inspector-meta">
      <p class="summary-callout">{{ pr.blockerSummary }}</p>
      <div class="branch-line mono-num">
        <span>{{ pr.headRefName }}</span>
        <CarbonIcon name="arrow-right" :size="12" />
        <span>{{ pr.baseRefName }}</span>
        <span class="meta-sep">·</span>
        <span>by @{{ pr.author }}</span>
      </div>

      <div v-if="!pr.isDraft" class="draft-callout">
        <div class="draft-callout-row">
          <span class="draft-callout-label">Merge pull request</span>
          <MergeControl
            :pr="pr"
            :merge-state="mergeState"
            @request-merge="(target, method) => $emit('request-merge', target, method)"
          />
        </div>
        <p v-if="mergeState.status === 'error'" class="sync-error-note" role="alert">
          {{ mergeState.error }}
        </p>
      </div>

      <div class="draft-callout">
        <div class="draft-callout-row">
          <span class="draft-callout-label">Pull request status</span>
          <DraftToggle
            :pr-key="pr.key"
            :is-draft="pr.isDraft"
            :draft-state="draftState"
            @toggle="$emit('toggle-draft', pr, $event)"
          />
        </div>
        <p v-if="draftState.status === 'error'" class="sync-error-note" role="alert">
          {{ draftState.error }}
        </p>
      </div>

      <div v-if="showSyncAction" class="sync-callout">
        <div class="sync-callout-row">
          <button
            type="button"
            class="sync-action-btn"
            :class="{
              synced: syncState.status === 'synced',
              syncing: syncState.status === 'syncing',
            }"
            :aria-disabled="isSyncBusy ? 'true' : undefined"
            :aria-label="syncAriaLabel"
            @click="onSyncClick"
          >
            <progress
              v-if="syncState.status === 'syncing'"
              class="loading-spinner"
              aria-label="Syncing branch"
            ></progress>
            <CarbonIcon
              v-else
              :name="syncState.status === 'synced' ? 'checkmark' : 'renew'"
              :size="14"
            />
            <span>{{ syncButtonText }}</span>
          </button>
          <span class="sync-hint">Merges {{ pr.baseRefName }} into {{ pr.headRefName }}</span>
        </div>
        <p v-if="syncState.status === 'error'" class="sync-error-note" role="alert">
          {{ syncState.error }}
        </p>
      </div>
    </div>

    <div v-if="inspector.status === 'loading'" class="state-box">
      Loading checks, reviewers, and timeline...
    </div>

    <div v-else-if="inspector.status === 'error'" class="state-box error-box" role="alert">
      <p>{{ inspector.error }}</p>
      <button v-if="pr" type="button" class="retry-btn" @click="$emit('retry', pr)">Retry</button>
    </div>

    <template v-else-if="inspector.status === 'open'">
      <p v-if="inspector.detail.bodyExcerpt" class="body-excerpt">
        {{ inspector.detail.bodyExcerpt }}
      </p>

      <section class="detail-section" aria-label="Checks">
        <h2 class="detail-heading">
          Checks
          <span class="mono-num detail-count">
            {{ inspector.detail.checks.length }}
            <template v-if="inspector.detail.checksTotalCount > inspector.detail.checks.length">
              / {{ inspector.detail.checksTotalCount }}
            </template>
          </span>
        </h2>
        <p v-if="inspector.detail.checks.length === 0" class="empty-note">No checks reported.</p>
        <ul v-else role="list" class="detail-list">
          <li
            v-for="chk in inspector.detail.checks"
            :key="`${chk.kind}-${chk.name}`"
            class="detail-row"
          >
            <span class="check-badge" :data-bucket="chk.bucket">{{ chk.bucket }}</span>
            <span class="detail-name">{{ chk.name }}</span>
            <a
              v-if="chk.url"
              :href="chk.url"
              target="_blank"
              rel="noopener noreferrer"
              class="detail-link"
            >
              <span>details</span>
              <CarbonIcon name="launch" :size="12" />
            </a>
          </li>
        </ul>
      </section>

      <section class="detail-section" aria-label="Reviewers">
        <h2 class="detail-heading">
          Reviewers
          <span class="mono-num detail-count">{{ inspector.detail.reviewers.length }}</span>
        </h2>
        <p v-if="inspector.detail.reviewers.length === 0" class="empty-note">No reviewers yet.</p>
        <ul v-else role="list" class="detail-list">
          <li
            v-for="rev in inspector.detail.reviewers"
            :key="`${rev.kind}-${rev.login}`"
            class="detail-row"
          >
            <span class="rev-state" :data-state="rev.state">{{ rev.state }}</span>
            <span class="detail-name">
              {{ rev.kind === 'team' ? rev.login : `@${rev.login}` }}
              <span v-if="rev.asCodeOwner" class="codeowner-note">code owner</span>
            </span>
          </li>
        </ul>
      </section>

      <section class="detail-section" aria-label="Recent timeline">
        <h2 class="detail-heading">Recent Timeline (Last 5)</h2>
        <p v-if="inspector.detail.timeline.length === 0" class="empty-note">No timeline events.</p>
        <ul v-else role="list" class="detail-list">
          <li v-for="item in inspector.detail.timeline" :key="item.id" class="timeline-row">
            <div class="timeline-top">
              <span class="timeline-actor">@{{ item.actor }}</span>
              <span class="timeline-age mono-num">{{
                formatRelativeAge(item.createdAt, nowMs)
              }}</span>
            </div>
            <div class="timeline-summary">{{ item.summary }}</div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import DraftToggle from '@/components/DraftToggle.vue';
import MergeControl from '@/components/MergeControl.vue';
import {
  IDLE_PR_DRAFT_STATE,
  IDLE_PR_MERGE_STATE,
  IDLE_PR_SYNC_STATE,
  type InspectorState,
  type PrDraftState,
  type PrMergeState,
  type PrSyncState,
} from '@/composables/use-dashboard-state';
import type { MergeMethod, PrView } from '@/types/pr';
import { formatRelativeAge } from '@/utils/format';

interface Props {
  pr: PrView | null;
  inspector: InspectorState;
  nowMs: number;
  syncState?: PrSyncState;
  draftState?: PrDraftState;
  mergeState?: PrMergeState;
}

const props = withDefaults(defineProps<Props>(), {
  syncState: () => IDLE_PR_SYNC_STATE,
  draftState: () => IDLE_PR_DRAFT_STATE,
  mergeState: () => IDLE_PR_MERGE_STATE,
});

const emit = defineEmits<{
  retry: [pr: PrView];
  sync: [pr: PrView];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
  'request-merge': [pr: PrView, method: MergeMethod];
}>();

const showSyncAction = computed<boolean>(
  () =>
    Boolean(props.pr) && (props.pr?.merge.state === 'behind' || props.syncState.status !== 'idle'),
);

const isSyncBusy = computed<boolean>(
  () => props.syncState.status === 'syncing' || props.syncState.status === 'synced',
);

const syncButtonText = computed<string>(() => {
  const base = props.pr?.baseRefName ?? 'base';
  if (props.syncState.status === 'syncing') {
    return `Syncing with ${base}`;
  }
  if (props.syncState.status === 'synced') {
    return `Synced with ${base}`;
  }
  return `Sync with ${base}`;
});

const syncAriaLabel = computed<string>(() => {
  if (!props.pr) {
    return syncButtonText.value;
  }
  return `${syncButtonText.value} for ${props.pr.key}`;
});

function onSyncClick(): void {
  if (!props.pr || isSyncBusy.value) {
    return;
  }
  emit('sync', props.pr);
}
</script>

<style scoped>
.inspector-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.inspector-meta {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.summary-callout {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: 0.4rem;
  background-color: var(--bg-surface-muted);
  font-size: 0.875rem;
  font-weight: 500;
}

.branch-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

.draft-callout {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.15rem;
  padding: 0.45rem 0.65rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.draft-callout-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 0.75rem;
}

.draft-callout-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-secondary);
}

.sync-callout {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.15rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.sync-callout-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.sync-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-block-size: 2rem;
  min-inline-size: 2rem;
  padding: 0.25rem 0.7rem;
  border-radius: 0.375rem;
  border: 1px solid var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.sync-action-btn:hover:not([aria-disabled='true']) {
  background-color: var(--accent-blue);
  color: #ffffff;
}

.sync-action-btn.synced {
  border-color: var(--accent-emerald);
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
}

.sync-action-btn[aria-disabled='true'] {
  cursor: default;
  opacity: 0.85;
}

.sync-hint {
  font-size: 0.75rem;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

.sync-error-note {
  margin: 0;
  padding: 0.4rem 0.55rem;
  border-radius: 0.35rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.body-excerpt {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--ink-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.state-box {
  padding: 1rem;
  border-radius: 0.4rem;
  background-color: var(--bg-surface-muted);
  font-size: 0.8125rem;
  color: var(--ink-secondary);
}

.error-box {
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}

.retry-btn {
  min-height: 2rem;
  padding: 0.25rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  cursor: pointer;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.detail-heading {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-secondary);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.detail-count {
  color: var(--ink-muted);
}

.empty-note {
  margin: 0;
  font-size: 0.8rem;
  color: var(--ink-muted);
}

.detail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.35rem;
  background-color: var(--bg-surface-muted);
  font-size: 0.8rem;
}

.check-badge,
.rev-state {
  flex: 0 0 auto;
  padding: 0.08rem 0.35rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
}

.check-badge[data-bucket='passing'],
.rev-state[data-state='APPROVED'] {
  color: var(--accent-emerald);
}

.check-badge[data-bucket='failing'],
.rev-state[data-state='CHANGES_REQUESTED'] {
  color: var(--accent-red);
}

.check-badge[data-bucket='pending'],
.rev-state[data-state='PENDING'] {
  color: var(--accent-amber);
}

.detail-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.codeowner-note {
  margin-left: 0.35rem;
  font-size: 0.7rem;
  color: var(--ink-muted);
}

.detail-link {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--accent-blue);
  text-decoration: none;
  font-size: 0.75rem;
  font-weight: 500;
}

.timeline-row {
  padding: 0.45rem 0.55rem;
  border-radius: 0.35rem;
  background-color: var(--bg-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.timeline-top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.timeline-actor {
  font-weight: 600;
}

.timeline-age {
  color: var(--ink-muted);
}

.timeline-summary {
  font-size: 0.8rem;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}
</style>
