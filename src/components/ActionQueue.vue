<template>
  <section class="action-queue" aria-labelledby="action-queue">
    <div class="section-head">
      <h1 id="action-queue" tabindex="-1" class="section-title">{{ headingLabel }}</h1>
      <span class="section-count mono-num">{{ pullRequests.length }}</span>
    </div>

    <div class="queue-scroll app-scroll">
      <div v-if="isLoading" class="empty-state">Loading pull request snapshot from GitHub...</div>

      <div
        v-else-if="pullRequests.length === 0"
        class="empty-state"
        :class="{ 'inbox-zero': isInboxZero }"
      >
        <div v-if="isInboxZero" class="inbox-zero-head">
          <CarbonIcon name="checkmark-filled" :size="18" class="inbox-zero-icon" />
          <p class="empty-title">{{ emptyTitle }}</p>
        </div>
        <p v-else class="empty-title">{{ emptyTitle }}</p>
        <p class="empty-hint">{{ emptyHint }}</p>
        <div v-if="showEmptyActions" class="empty-actions">
          <button
            v-if="snoozedCount > 0 && !showSnoozed"
            type="button"
            class="empty-action-btn"
            @click="$emit('show-snoozed')"
          >
            Show {{ snoozedCount }} snoozed
          </button>
          <button
            v-if="readyCount > 0 && activeBucket !== 'ready'"
            type="button"
            class="empty-action-btn"
            @click="$emit('select-bucket', 'ready')"
          >
            View {{ readyCount }} ready to merge
          </button>
          <button
            v-if="waitingCount > 0 && activeBucket !== 'waiting'"
            type="button"
            class="empty-action-btn"
            @click="$emit('select-bucket', 'waiting')"
          >
            View {{ waitingCount }} waiting
          </button>
        </div>
      </div>

      <div v-else-if="groupByMission && missionGroups.length > 0" class="mission-groups">
        <section
          v-for="group in missionGroups"
          :key="group.mission.id"
          class="mission-group-card"
          :aria-label="`Mission ${group.mission.label}`"
        >
          <header class="mission-group-head">
            <div class="mission-group-title-row">
              <CarbonIcon name="branch" :size="14" class="mission-group-icon" />
              <h2 class="mission-group-title mono-num">{{ group.mission.label }}</h2>
              <span v-if="group.mission.hasCrossRepo" class="mission-pill" data-tone="blue">
                cross-repo
              </span>
              <span v-if="group.mission.hasStack" class="mission-pill" data-tone="amber"
                >stack</span
              >
            </div>
            <span class="mission-progress mono-num">
              {{ group.mission.readyCount }}/{{ group.mission.totalCount }} ready
            </span>
          </header>

          <p v-if="group.mission.dependencyNotes.length > 0" class="mission-dep-note">
            {{ group.mission.dependencyNotes.join(' · ') }}
          </p>

          <ul role="list" class="card-list">
            <PrCard
              v-for="pr in group.pullRequests"
              :key="pr.key"
              :pr="pr"
              :is-selected="selectedKey === pr.key"
              :is-checked="checkedKeys.has(pr.key)"
              :selection-mode="checkedKeys.size > 0"
              :now-ms="nowMs"
              :sync-state="syncStates[pr.key]"
              :draft-state="draftStates[pr.key]"
              :merge-state="mergeStates[pr.key]"
              :repo-labels-state="repoLabelsStates[pr.repository]"
              :label-state="labelStates[pr.key]"
              :rerun-state="rerunStates[pr.key]"
              :triage-state="triageStates[pr.key]"
              :shared-ci-checks="sharedCiByKey[pr.key]"
              @select="$emit('select', $event)"
              @toggle-check="(target, shiftKey) => $emit('toggle-check', target, shiftKey)"
              @sync="$emit('sync', $event)"
              @rerun-checks="$emit('rerun-checks', $event)"
              @toggle-draft="(target, nextDraft) => $emit('toggle-draft', target, nextDraft)"
              @request-merge="(target, method) => $emit('request-merge', target, method)"
              @load-labels="$emit('load-labels', $event)"
              @retry-load-labels="$emit('retry-load-labels', $event)"
              @update-labels="(target, labels) => $emit('update-labels', target, labels)"
              @toggle-pin="$emit('toggle-pin', $event)"
              @snooze="(target, condition) => $emit('snooze', target, condition)"
              @unsnooze="$emit('unsnooze', $event)"
            >
              <template #inline-inspector>
                <slot name="inline-inspector" :pr="pr" />
              </template>
            </PrCard>
          </ul>
        </section>

        <section v-if="ungroupedPulls.length > 0" class="ungrouped-section">
          <div class="ungrouped-head">
            <h2 class="ungrouped-title">Standalone Pull Requests</h2>
            <span class="section-count mono-num">{{ ungroupedPulls.length }}</span>
          </div>
          <ul role="list" class="card-list">
            <PrCard
              v-for="pr in ungroupedPulls"
              :key="pr.key"
              :pr="pr"
              :is-selected="selectedKey === pr.key"
              :is-checked="checkedKeys.has(pr.key)"
              :selection-mode="checkedKeys.size > 0"
              :now-ms="nowMs"
              :sync-state="syncStates[pr.key]"
              :draft-state="draftStates[pr.key]"
              :merge-state="mergeStates[pr.key]"
              :repo-labels-state="repoLabelsStates[pr.repository]"
              :label-state="labelStates[pr.key]"
              :rerun-state="rerunStates[pr.key]"
              :triage-state="triageStates[pr.key]"
              :shared-ci-checks="sharedCiByKey[pr.key]"
              @select="$emit('select', $event)"
              @toggle-check="(target, shiftKey) => $emit('toggle-check', target, shiftKey)"
              @sync="$emit('sync', $event)"
              @rerun-checks="$emit('rerun-checks', $event)"
              @toggle-draft="(target, nextDraft) => $emit('toggle-draft', target, nextDraft)"
              @request-merge="(target, method) => $emit('request-merge', target, method)"
              @load-labels="$emit('load-labels', $event)"
              @retry-load-labels="$emit('retry-load-labels', $event)"
              @update-labels="(target, labels) => $emit('update-labels', target, labels)"
              @toggle-pin="$emit('toggle-pin', $event)"
              @snooze="(target, condition) => $emit('snooze', target, condition)"
              @unsnooze="$emit('unsnooze', $event)"
            >
              <template #inline-inspector>
                <slot name="inline-inspector" :pr="pr" />
              </template>
            </PrCard>
          </ul>
        </section>
      </div>

      <ul v-else role="list" class="card-list">
        <PrCard
          v-for="pr in pullRequests"
          :key="pr.key"
          :pr="pr"
          :is-selected="selectedKey === pr.key"
          :is-checked="checkedKeys.has(pr.key)"
          :selection-mode="checkedKeys.size > 0"
          :now-ms="nowMs"
          :sync-state="syncStates[pr.key]"
          :draft-state="draftStates[pr.key]"
          :merge-state="mergeStates[pr.key]"
          :repo-labels-state="repoLabelsStates[pr.repository]"
          :label-state="labelStates[pr.key]"
          :rerun-state="rerunStates[pr.key]"
          :triage-state="triageStates[pr.key]"
          :shared-ci-checks="sharedCiByKey[pr.key]"
          @select="$emit('select', $event)"
          @toggle-check="(target, shiftKey) => $emit('toggle-check', target, shiftKey)"
          @sync="$emit('sync', $event)"
          @rerun-checks="$emit('rerun-checks', $event)"
          @toggle-draft="(target, nextDraft) => $emit('toggle-draft', target, nextDraft)"
          @request-merge="(target, method) => $emit('request-merge', target, method)"
          @load-labels="$emit('load-labels', $event)"
          @retry-load-labels="$emit('retry-load-labels', $event)"
          @update-labels="(target, labels) => $emit('update-labels', target, labels)"
          @toggle-pin="$emit('toggle-pin', $event)"
          @snooze="(target, condition) => $emit('snooze', target, condition)"
          @unsnooze="$emit('unsnooze', $event)"
        >
          <template #inline-inspector>
            <slot name="inline-inspector" :pr="pr" />
          </template>
        </PrCard>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import PrCard from '@/components/PrCard.vue';
import type {
  PrDraftState,
  PrLabelsState,
  PrMergeState,
  PrRerunState,
  PrSyncState,
  PrTriageState,
  RepoLabelsState,
} from '@/composables/use-dashboard-state';
import type { BucketFilter } from '@/composables/use-url-state';
import type { MergeMethod, PrView, SnapshotMission, SnoozeCondition } from '@/types/pr';

interface Props {
  pullRequests: PrView[];
  selectedKey: string | null;
  checkedKeys?: ReadonlySet<string>;
  nowMs: number;
  isLoading: boolean;
  activeBucket: BucketFilter;
  hasFilters: boolean;
  hasSearchQuery?: boolean;
  showSnoozed?: boolean;
  snoozedCount?: number;
  readyCount?: number;
  waitingCount?: number;
  groupByMission?: boolean;
  missions?: SnapshotMission[];
  syncStates?: Record<string, PrSyncState>;
  draftStates?: Record<string, PrDraftState>;
  mergeStates?: Record<string, PrMergeState>;
  repoLabelsStates?: Record<string, RepoLabelsState>;
  labelStates?: Record<string, PrLabelsState>;
  rerunStates?: Record<string, PrRerunState>;
  triageStates?: Record<string, PrTriageState>;
  sharedCiByKey?: Record<string, string[]>;
}

const props = withDefaults(defineProps<Props>(), {
  checkedKeys: () => new Set<string>(),
  hasSearchQuery: false,
  showSnoozed: false,
  snoozedCount: 0,
  readyCount: 0,
  waitingCount: 0,
  groupByMission: false,
  missions: () => [],
  syncStates: () => ({}),
  draftStates: () => ({}),
  mergeStates: () => ({}),
  repoLabelsStates: () => ({}),
  labelStates: () => ({}),
  rerunStates: () => ({}),
  triageStates: () => ({}),
  sharedCiByKey: () => ({}),
});

defineEmits<{
  select: [pr: PrView];
  'toggle-check': [pr: PrView, shiftKey: boolean];
  sync: [pr: PrView];
  'rerun-checks': [pr: PrView];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
  'request-merge': [pr: PrView, method: MergeMethod];
  'load-labels': [pr: PrView];
  'retry-load-labels': [pr: PrView];
  'update-labels': [pr: PrView, labels: string[]];
  'toggle-pin': [pr: PrView];
  snooze: [pr: PrView, condition: SnoozeCondition];
  unsnooze: [pr: PrView];
  'show-snoozed': [];
  'select-bucket': [bucket: BucketFilter];
}>();

const isInboxZero = computed<boolean>(
  () =>
    !props.hasSearchQuery &&
    (props.activeBucket === 'needs-me' || !props.hasFilters || props.snoozedCount > 0),
);

const missionGroups = computed<Array<{ mission: SnapshotMission; pullRequests: PrView[] }>>(() => {
  if (!props.groupByMission || props.missions.length === 0) {
    return [];
  }
  const byKey = new Map(props.pullRequests.map((pr) => [pr.key, pr]));
  const groups: Array<{ mission: SnapshotMission; pullRequests: PrView[] }> = [];
  for (const mission of props.missions) {
    const visible = mission.prKeys
      .map((key) => byKey.get(key))
      .filter((pr): pr is PrView => Boolean(pr));
    if (visible.length > 0) {
      groups.push({ mission, pullRequests: visible });
    }
  }
  return groups;
});

const ungroupedPulls = computed<PrView[]>(() => {
  if (!props.groupByMission || missionGroups.value.length === 0) {
    return props.pullRequests;
  }
  const groupedKeys = new Set<string>();
  for (const group of missionGroups.value) {
    for (const pr of group.pullRequests) {
      groupedKeys.add(pr.key);
    }
  }
  return props.pullRequests.filter((pr) => !groupedKeys.has(pr.key));
});

const showEmptyActions = computed<boolean>(
  () =>
    !props.hasSearchQuery &&
    ((props.snoozedCount > 0 && !props.showSnoozed) ||
      (props.readyCount > 0 && props.activeBucket !== 'ready') ||
      (props.waitingCount > 0 && props.activeBucket !== 'waiting')),
);

const headingLabel = computed<string>(() => {
  switch (props.activeBucket) {
    case 'needs-me':
      return 'Action Queue · Needs You';
    case 'ready':
      return 'Action Queue · Ready to Merge';
    case 'waiting':
      return 'Filtered Queue · Waiting on Others';
    case 'draft':
      return 'Filtered Queue · Drafts';
    case 'ci-failing':
      return 'Filtered Queue · Failing CI';
    default:
      return 'Action Queue';
  }
});

const emptyTitle = computed<string>(() => {
  if (isInboxZero.value) {
    return props.activeBucket === 'needs-me'
      ? 'Inbox Zero — nothing needs your action.'
      : 'Inbox Zero — action queue is clear.';
  }
  return props.hasFilters ? 'No pull requests match the active filters.' : 'Action queue is clear.';
});

const emptyHint = computed<string>(() => {
  if (isInboxZero.value) {
    return props.snoozedCount > 0 && !props.showSnoozed
      ? `${props.snoozedCount} pull ${props.snoozedCount === 1 ? 'request is' : 'requests are'} snoozed and will wake automatically when conditions change.`
      : 'You are all caught up right now.';
  }
  return props.hasFilters
    ? 'Clear or adjust filters to inspect other pull requests.'
    : 'Nothing needs your immediate action right now.';
});
</script>

<style scoped>
.action-queue {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  min-inline-size: 0;
  min-block-size: 0;
}

.section-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.queue-scroll {
  flex: 1 1 auto;
  min-block-size: 0;
  padding-block-end: 0.75rem;
  padding-inline-end: 0.25rem;
}

@media (max-width: 1023px) {
  .queue-scroll {
    overflow: visible;
    scrollbar-gutter: auto;
    padding-block-end: 0;
    padding-inline-end: 0;
  }
}

.section-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.section-count {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--ink-muted);
}

.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.empty-state {
  padding: 1.5rem 1.25rem;
  border-radius: 0.5rem;
  border: 1px dashed var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
}

.empty-state.inbox-zero {
  border-style: solid;
  border-color: color-mix(in srgb, var(--accent-emerald) 45%, var(--border-subtle));
  background-color: color-mix(in srgb, var(--accent-emerald-bg) 45%, var(--bg-surface));
}

.inbox-zero-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.inbox-zero-icon {
  color: var(--accent-emerald);
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.75rem;
}

.empty-action-btn {
  min-block-size: 1.9rem;
  padding: 0.2rem 0.65rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.empty-action-btn:hover {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.empty-title {
  margin: 0;
  font-weight: 600;
  color: var(--ink-primary);
}

.empty-hint {
  margin: 0.3rem 0 0;
  font-size: 0.8125rem;
}

.mission-groups {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.mission-group-card {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.65rem;
  border-radius: 0.6rem;
  border: 1px solid color-mix(in srgb, var(--accent-blue) 40%, var(--border-subtle));
  background-color: color-mix(in srgb, var(--accent-blue-bg) 22%, var(--bg-surface-muted));
}

.mission-group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 0.65rem;
  padding: 0 0.15rem;
}

.mission-group-title-row {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.mission-group-icon {
  color: var(--accent-blue);
}

.mission-group-title {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--ink-primary);
}

.mission-pill {
  padding: 0.06rem 0.4rem;
  border-radius: 0.3rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid var(--border-subtle);
}

.mission-pill[data-tone='blue'] {
  border-color: color-mix(in srgb, var(--accent-blue) 50%, transparent);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.mission-pill[data-tone='amber'] {
  border-color: color-mix(in srgb, var(--accent-amber) 50%, transparent);
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
}

.mission-progress {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--ink-secondary);
}

.mission-dep-note {
  margin: 0;
  padding: 0.3rem 0.5rem;
  border-radius: 0.35rem;
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
  font-size: 0.75rem;
  font-weight: 500;
}

.ungrouped-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ungrouped-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 0.25rem;
}

.ungrouped-title {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
</style>
