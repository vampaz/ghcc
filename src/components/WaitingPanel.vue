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
        <div class="waiting-row" :class="{ selected: selectedKey === pr.key }">
          <button type="button" class="waiting-btn" @click="$emit('select', pr)">
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

          <div class="waiting-actions">
            <DraftToggle
              compact
              :pr-key="pr.key"
              :is-draft="pr.isDraft"
              :draft-state="getDraftState(pr.key)"
              @toggle="$emit('toggle-draft', pr, $event)"
            />

            <button
              v-if="showSyncButton(pr)"
              type="button"
              class="waiting-sync-btn"
              :class="{
                synced: getSyncState(pr.key).status === 'synced',
                syncing: getSyncState(pr.key).status === 'syncing',
              }"
              :aria-disabled="isSyncBusy(pr.key) ? 'true' : undefined"
              :aria-label="syncAriaLabel(pr)"
              :title="`Merge ${pr.baseRefName} into ${pr.headRefName}`"
              @click="onSyncClick(pr)"
            >
              <progress
                v-if="getSyncState(pr.key).status === 'syncing'"
                class="loading-spinner"
                aria-label="Syncing branch"
              ></progress>
              <CarbonIcon
                v-else
                :name="getSyncState(pr.key).status === 'synced' ? 'checkmark' : 'renew'"
                :size="12"
              />
              <span>{{ syncButtonText(pr.key) }}</span>
            </button>
          </div>
        </div>

        <p v-if="draftError(pr.key)" class="waiting-sync-error" role="alert">
          {{ draftError(pr.key) }}
        </p>

        <p v-if="syncError(pr.key)" class="waiting-sync-error" role="alert">
          {{ syncError(pr.key) }}
        </p>

        <slot name="inline-inspector" :pr="pr" />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import CarbonIcon from '@/components/CarbonIcon.vue';
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
  pullRequests: PrView[];
  selectedKey: string | null;
  nowMs: number;
  syncStates?: Record<string, PrSyncState>;
  draftStates?: Record<string, PrDraftState>;
}

const props = withDefaults(defineProps<Props>(), {
  syncStates: () => ({}),
  draftStates: () => ({}),
});

const emit = defineEmits<{
  select: [pr: PrView];
  sync: [pr: PrView];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
}>();

function getDraftState(prKey: string): PrDraftState {
  return props.draftStates[prKey] ?? IDLE_PR_DRAFT_STATE;
}

function draftError(prKey: string): string | null {
  const state = getDraftState(prKey);
  return state.status === 'error' ? state.error : null;
}

function getSyncState(prKey: string): PrSyncState {
  return props.syncStates[prKey] ?? IDLE_PR_SYNC_STATE;
}

function showSyncButton(pr: PrView): boolean {
  return pr.merge.state === 'behind' || getSyncState(pr.key).status !== 'idle';
}

function isSyncBusy(prKey: string): boolean {
  const status = getSyncState(prKey).status;
  return status === 'syncing' || status === 'synced';
}

function syncButtonText(prKey: string): string {
  const status = getSyncState(prKey).status;
  if (status === 'syncing') {
    return 'Syncing';
  }
  if (status === 'synced') {
    return 'Synced';
  }
  return 'Sync';
}

function syncAriaLabel(pr: PrView): string {
  return `${syncButtonText(pr.key)} ${pr.key} with ${pr.baseRefName}`;
}

function syncError(prKey: string): string | null {
  const state = getSyncState(prKey);
  return state.status === 'error' ? state.error : null;
}

function onSyncClick(pr: PrView): void {
  if (isSyncBusy(pr.key)) {
    return;
  }
  emit('sync', pr);
}

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
  if (pr.merge.state === 'behind') {
    return 'behind';
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

.waiting-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding-inline-end: 0.35rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}

.waiting-row:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-subtle);
}

.waiting-row.selected {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
}

.waiting-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.waiting-btn {
  flex: 1 1 auto;
  min-width: 0;
  min-block-size: 2.25rem;
  padding: 0.45rem 0.5rem;
  border-radius: 0.375rem;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.waiting-sync-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-block-size: 1.85rem;
  min-inline-size: 2rem;
  padding: 0.2rem 0.5rem;
  border-radius: 0.35rem;
  border: 1px solid var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.waiting-sync-btn:hover:not([aria-disabled='true']) {
  background-color: var(--accent-blue);
  color: #ffffff;
}

.waiting-sync-btn.synced {
  border-color: var(--accent-emerald);
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
}

.waiting-sync-btn[aria-disabled='true'] {
  cursor: default;
  opacity: 0.85;
}

.waiting-sync-error {
  margin: 0.25rem 0.5rem 0;
  padding: 0.35rem 0.5rem;
  border-radius: 0.35rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
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
