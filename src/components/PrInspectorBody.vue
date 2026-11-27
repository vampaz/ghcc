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

      <div class="draft-callout">
        <div class="draft-callout-row">
          <span class="draft-callout-label">Labels</span>
          <LabelPicker
            :pr="pr"
            :repo-labels-state="repoLabelsState"
            :label-state="labelState"
            @load-labels="$emit('load-labels', $event)"
            @retry-load="$emit('retry-load-labels', $event)"
            @update-labels="(target, labels) => $emit('update-labels', target, labels)"
          />
        </div>
        <div v-if="pr.labels.length > 0" class="inspector-labels-list">
          <span
            v-for="label in pr.labels"
            :key="label.name"
            class="pr-label-pill"
            :style="{ '--label-color': `#${label.color}` }"
            :title="label.description ?? label.name"
          >
            <span class="pr-label-dot" aria-hidden="true"></span>
            <span>{{ label.name }}</span>
          </span>
        </div>
        <p v-else class="empty-note">No labels applied.</p>
        <p v-if="labelState.status === 'error'" class="sync-error-note" role="alert">
          {{ labelState.error }}
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
      <section class="detail-section" :aria-labelledby="descriptionHeadingId">
        <h2 :id="descriptionHeadingId" class="detail-heading">Description</h2>
        <PrMarkdownBody
          v-if="inspector.detail.bodyHtml"
          :html="inspector.detail.bodyHtml"
          :pr-url="pr?.url ?? inspector.detail.url"
          :pr-key="pr?.key ?? inspector.detail.key"
          :resolved-theme="resolvedTheme"
          @open-mermaid="$emit('open-mermaid', $event)"
        />
        <p v-else-if="inspector.detail.bodyExcerpt" class="body-excerpt">
          {{ inspector.detail.bodyExcerpt }}
        </p>
        <p v-else class="empty-note">No description provided.</p>
      </section>

      <section class="detail-section" :aria-labelledby="checksHeadingId">
        <div class="detail-heading-row">
          <h2 :id="checksHeadingId" class="detail-heading">
            Checks
            <span class="mono-num detail-count">
              {{ inspector.detail.checks.length }}
              <template v-if="inspector.detail.checksTotalCount > inspector.detail.checks.length">
                / {{ inspector.detail.checksTotalCount }}
              </template>
            </span>
          </h2>
          <div class="detail-heading-actions">
            <button
              v-if="showRerunAllAction"
              type="button"
              class="checks-rerun-btn"
              :class="{
                queued: isRerunAllQueued,
                rerunning: isRerunAllPending,
              }"
              :aria-disabled="isRerunAllBusy ? 'true' : undefined"
              :aria-label="rerunAllAriaLabel"
              @click="onRerunAllClick"
            >
              <progress
                v-if="isRerunAllPending"
                class="loading-spinner"
                aria-label="Re-running failed checks"
              ></progress>
              <CarbonIcon v-else :name="isRerunAllQueued ? 'checkmark' : 'renew'" :size="12" />
              <span>{{ rerunAllButtonText }}</span>
            </button>
            <button
              v-if="checkGroups.length > 1"
              type="button"
              class="checks-toggle-all-btn"
              :aria-expanded="allGroupsExpanded ? 'true' : 'false'"
              @click="toggleAllCheckGroups"
            >
              {{ allGroupsExpanded ? 'Collapse all' : 'Expand all' }}
            </button>
          </div>
        </div>

        <p v-if="rerunState.status === 'queued'" class="rerun-status-note" role="status">
          {{ rerunState.message }}
        </p>

        <p v-if="rerunState.status === 'error'" class="sync-error-note" role="alert">
          {{ rerunState.error }}
        </p>

        <p v-if="inspector.detail.checks.length === 0" class="empty-note">No checks reported.</p>

        <div v-else class="check-groups">
          <details
            v-for="group in checkGroups"
            :key="`${pr?.key ?? 'pr'}-${group.id}`"
            class="check-group"
            :data-bucket="group.bucket"
            :open="openGroupIds.has(group.id)"
            @toggle="onGroupToggle(group.id, $event)"
          >
            <summary class="check-group-summary">
              <span class="check-group-chevron" aria-hidden="true">
                <CarbonIcon name="chevron-down" :size="14" />
              </span>
              <span class="check-badge" :data-bucket="group.bucket">{{ group.bucket }}</span>
              <span class="check-group-label">{{ group.label }}</span>
              <span class="check-group-counts mono-num">
                <span v-if="group.failingCount > 0" class="group-count-fail">
                  {{ group.failingCount }} fail
                </span>
                <span v-if="group.pendingCount > 0" class="group-count-pend">
                  {{ group.pendingCount }} pend
                </span>
                <span v-if="group.passingCount > 0" class="group-count-pass">
                  {{ group.passingCount }} pass
                </span>
              </span>
            </summary>

            <ul role="list" class="detail-list check-group-list">
              <li
                v-for="(item, idx) in group.items"
                :key="`${item.check.kind}-${item.check.name}-${idx}`"
                class="detail-row"
              >
                <span class="check-badge" :data-bucket="item.check.bucket">{{
                  item.check.bucket
                }}</span>
                <span
                  class="detail-name"
                  :title="item.displayName !== item.check.name ? item.check.name : undefined"
                >
                  {{ item.displayName }}
                </span>
                <button
                  v-if="isRerunnableJob(item.check)"
                  type="button"
                  class="check-rerun-btn"
                  :class="{
                    queued: isJobQueued(item.check.checkRunId!),
                    rerunning: isJobRerunning(item.check.checkRunId!),
                  }"
                  :aria-disabled="isJobButtonDisabled(item.check.checkRunId!) ? 'true' : undefined"
                  :aria-label="`Re-run ${item.check.name}`"
                  :title="`Re-run job ${item.check.name}`"
                  @click="onRerunJobClick(item.check.checkRunId!)"
                >
                  <progress
                    v-if="isJobRerunning(item.check.checkRunId!)"
                    class="loading-spinner"
                    aria-label="Re-running job"
                  ></progress>
                  <CarbonIcon
                    v-else
                    :name="isJobQueued(item.check.checkRunId!) ? 'checkmark' : 'renew'"
                    :size="12"
                  />
                  <span>{{ jobRerunLabel(item.check.checkRunId!) }}</span>
                </button>
                <a
                  v-if="item.check.url"
                  :href="item.check.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="detail-link"
                >
                  <span>details</span>
                  <CarbonIcon name="launch" :size="12" />
                </a>
              </li>
            </ul>
          </details>
        </div>
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
import { computed, ref, useId, watch } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import DraftToggle from '@/components/DraftToggle.vue';
import LabelPicker from '@/components/LabelPicker.vue';
import MergeControl from '@/components/MergeControl.vue';
import PrMarkdownBody from '@/components/PrMarkdownBody.vue';
import {
  IDLE_PR_DRAFT_STATE,
  IDLE_PR_LABELS_STATE,
  IDLE_PR_MERGE_STATE,
  IDLE_PR_RERUN_STATE,
  IDLE_PR_SYNC_STATE,
  IDLE_REPO_LABELS_STATE,
  type InspectorState,
  type PrDraftState,
  type PrLabelsState,
  type PrMergeState,
  type PrRerunState,
  type PrSyncState,
  type RepoLabelsState,
} from '@/composables/use-dashboard-state';
import type { ResolvedTheme } from '@/composables/use-theme';
import type { MergeMethod, PrDetailCheck, PrView } from '@/types/pr';
import { type CheckGroup, groupDetailChecks } from '@/utils/check-groups';
import { formatRelativeAge } from '@/utils/format';

interface Props {
  pr: PrView | null;
  inspector: InspectorState;
  nowMs: number;
  resolvedTheme?: ResolvedTheme;
  syncState?: PrSyncState;
  draftState?: PrDraftState;
  mergeState?: PrMergeState;
  repoLabelsState?: RepoLabelsState;
  labelState?: PrLabelsState;
  rerunState?: PrRerunState;
}

const props = withDefaults(defineProps<Props>(), {
  resolvedTheme: 'dark',
  syncState: () => IDLE_PR_SYNC_STATE,
  draftState: () => IDLE_PR_DRAFT_STATE,
  mergeState: () => IDLE_PR_MERGE_STATE,
  repoLabelsState: () => IDLE_REPO_LABELS_STATE,
  labelState: () => IDLE_PR_LABELS_STATE,
  rerunState: () => IDLE_PR_RERUN_STATE,
});

const emit = defineEmits<{
  retry: [pr: PrView];
  sync: [pr: PrView];
  'rerun-checks': [pr: PrView, options?: { jobId?: number; runId?: number }];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
  'request-merge': [pr: PrView, method: MergeMethod];
  'load-labels': [pr: PrView];
  'retry-load-labels': [pr: PrView];
  'update-labels': [pr: PrView, labels: string[]];
  'open-mermaid': [source: string];
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

const descriptionHeadingId = `description-heading-${useId()}`;
const checksHeadingId = `checks-heading-${useId()}`;

const checkGroups = computed<CheckGroup[]>(() => {
  if (props.inspector.status !== 'open') {
    return [];
  }
  return groupDetailChecks(props.inspector.detail.checks);
});

const openGroupIds = ref<Set<string>>(new Set());

watch(
  () => [props.pr?.key ?? null, props.inspector.status === 'open' ? props.inspector.detail : null],
  () => {
    openGroupIds.value = new Set(checkGroups.value.filter((g) => g.defaultOpen).map((g) => g.id));
  },
  { immediate: true },
);

const allGroupsExpanded = computed<boolean>(
  () =>
    checkGroups.value.length > 0 && checkGroups.value.every((g) => openGroupIds.value.has(g.id)),
);

function onGroupToggle(groupId: string, event: Event): void {
  const details = event.target as HTMLDetailsElement | null;
  if (!details) {
    return;
  }
  const next = new Set(openGroupIds.value);
  if (details.open) {
    next.add(groupId);
  } else {
    next.delete(groupId);
  }
  openGroupIds.value = next;
}

function toggleAllCheckGroups(): void {
  if (allGroupsExpanded.value) {
    openGroupIds.value = new Set();
  } else {
    openGroupIds.value = new Set(checkGroups.value.map((g) => g.id));
  }
}

function onSyncClick(): void {
  if (!props.pr || isSyncBusy.value) {
    return;
  }
  emit('sync', props.pr);
}

const hasFailingChecks = computed<boolean>(() => {
  if (props.inspector.status === 'open') {
    return props.inspector.detail.checks.some((check) => check.bucket === 'failing');
  }
  return props.pr?.ci.state === 'failing';
});

const showRerunAllAction = computed<boolean>(
  () => Boolean(props.pr) && (hasFailingChecks.value || props.rerunState.status !== 'idle'),
);

const isRerunAllPending = computed<boolean>(
  () => props.rerunState.status === 'rerunning' && props.rerunState.jobId === null,
);

const isRerunAllQueued = computed<boolean>(
  () => props.rerunState.status === 'queued' && props.rerunState.jobId === null,
);

const isRerunAllBusy = computed<boolean>(
  () => props.rerunState.status === 'rerunning' || isRerunAllQueued.value,
);

const rerunAllButtonText = computed<string>(() => {
  if (isRerunAllPending.value) {
    return 'Re-running';
  }
  if (isRerunAllQueued.value) {
    return 'Queued';
  }
  return 'Re-run failed';
});

const rerunAllAriaLabel = computed<string>(() => {
  if (!props.pr) {
    return rerunAllButtonText.value;
  }
  return `${rerunAllButtonText.value} checks for ${props.pr.key}`;
});

function onRerunAllClick(): void {
  if (!props.pr || isRerunAllBusy.value) {
    return;
  }
  emit('rerun-checks', props.pr);
}

function isRerunnableJob(check: PrDetailCheck): boolean {
  return (
    Boolean(props.pr) &&
    check.kind === 'CheckRun' &&
    check.bucket === 'failing' &&
    typeof check.checkRunId === 'number' &&
    typeof check.workflowRunId === 'number'
  );
}

function isJobRerunning(jobId: number): boolean {
  return props.rerunState.status === 'rerunning' && props.rerunState.jobId === jobId;
}

function isJobQueued(jobId: number): boolean {
  return props.rerunState.status === 'queued' && props.rerunState.jobId === jobId;
}

function isJobButtonDisabled(jobId: number): boolean {
  return props.rerunState.status === 'rerunning' || isJobQueued(jobId);
}

function jobRerunLabel(jobId: number): string {
  if (isJobRerunning(jobId)) {
    return 'Re-running';
  }
  if (isJobQueued(jobId)) {
    return 'Queued';
  }
  return 'Re-run';
}

function onRerunJobClick(jobId: number): void {
  if (!props.pr || isJobButtonDisabled(jobId)) {
    return;
  }
  emit('rerun-checks', props.pr, { jobId });
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

.inspector-labels-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
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

.detail-heading-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.detail-heading-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.checks-rerun-btn,
.check-rerun-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-block-size: 1.5rem;
  padding: 0.15rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px solid var(--accent-amber);
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.checks-rerun-btn:hover:not([aria-disabled='true']),
.check-rerun-btn:hover:not([aria-disabled='true']) {
  background-color: var(--accent-amber);
  color: light-dark(#ffffff, #0b1017);
}

.checks-rerun-btn.queued,
.check-rerun-btn.queued {
  border-color: var(--accent-emerald);
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
}

.checks-rerun-btn[aria-disabled='true'],
.check-rerun-btn[aria-disabled='true'] {
  cursor: default;
  opacity: 0.85;
}

.check-rerun-btn {
  flex: 0 0 auto;
}

.rerun-status-note {
  margin: 0;
  padding: 0.4rem 0.55rem;
  border-radius: 0.35rem;
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.checks-toggle-all-btn {
  min-block-size: 1.5rem;
  padding: 0.15rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.checks-toggle-all-btn:hover {
  border-color: var(--border-strong);
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.check-groups {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.check-group {
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.check-group[data-bucket='failing'] {
  border-color: color-mix(in srgb, var(--accent-red) 45%, var(--border-subtle));
}

.check-group-summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-block-size: 2.15rem;
  padding: 0.38rem 0.55rem;
  border-radius: 0.35rem;
  cursor: pointer;
  user-select: none;
  font-size: 0.8rem;
  transition: background-color 120ms ease;
}

.check-group[open] > .check-group-summary {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.check-group-summary::-webkit-details-marker {
  display: none;
}

.check-group-summary:hover {
  background-color: var(--bg-surface-hover);
}

.check-group-chevron {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-muted);
  rotate: -90deg;
}

.check-group[open] > .check-group-summary > .check-group-chevron {
  rotate: 0deg;
}

@media (prefers-reduced-motion: no-preference) {
  .check-group-chevron {
    transition: rotate 0.18s ease;
  }
}

.check-group-label {
  flex: 1 1 auto;
  min-inline-size: 0;
  font-weight: 600;
  color: var(--ink-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-group-counts {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
}

.group-count-fail {
  color: var(--accent-red);
}

.group-count-pend {
  color: var(--accent-amber);
}

.group-count-pass {
  color: var(--accent-emerald);
}

.check-group::details-content {
  interpolate-size: allow-keywords;
  overflow: clip;
  contain: layout;
}

.check-group:not([open])::details-content {
  block-size: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .check-group::details-content {
    transition: block-size, content-visibility, display;
    transition-duration: 0.2s;
    transition-timing-function: ease-in-out;
    transition-behavior: allow-discrete;
  }
}

.check-group-list {
  padding: 0.25rem 0.45rem 0.45rem;
  border-top: 1px solid var(--border-subtle);
  border-bottom-left-radius: 0.35rem;
  border-bottom-right-radius: 0.35rem;
  background-color: var(--bg-surface);
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
