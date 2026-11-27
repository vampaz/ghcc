<template>
  <div class="dashboard-shell">
    <a href="#action-queue" class="skip-link visually-hidden">Skip to action queue</a>

    <AppHeader
      :viewer-login="snapshot?.viewer.login"
      :fetched-at="snapshot?.fetchedAt"
      :now-ms="nowMs"
      :next-refresh-at-ms="nextRefreshAtMs"
      :recently-updated="recentlyUpdated"
      :is-stale="isStale"
      :client-state="clientState"
      :server-state="snapshot?.state"
      :poll-interval-ms="pollIntervalMs"
      :resolved-theme="resolvedTheme"
      :rate-limit="snapshot?.rateLimit"
      @refresh="fetchSnapshot(true)"
      @toggle-theme="toggleTheme"
      @update-poll-interval="setPollIntervalMs"
      @open-palette="openPalette"
    />

    <WarningStrip
      :server-state="snapshot?.state"
      :warnings="snapshot?.warnings"
      :offline-message="offlineMessage"
      :refresh-cooldown-notice="refreshCooldownNotice"
      :graphql-rate-limit="snapshot?.rateLimit.graphql"
      :now-ms="nowMs"
      @retry="fetchSnapshot(true)"
    />

    <CiOutageBanner
      :outages="ciOutages"
      :dismissed-signatures="dismissedOutageSignatures"
      @filter-outage="onFilterOutage"
      @dismiss="onDismissOutage"
    />

    <main class="dashboard-main">
      <div class="dashboard-controls">
        <KpiStrip
          :pull-requests="activeScopedPulls"
          :active-bucket="bucket"
          :now-ms="nowMs"
          :waiting-includes-team="view === 'team'"
          :snoozed-needs-me-count="snoozedNeedsMeCount"
          @select-bucket="onSelectBucket"
        />

        <FilterBar
          ref="filterBarRef"
          :view="view"
          :bucket="bucket"
          :q="q"
          :repo-selection="repoSelection"
          :pull-requests="ownershipFilteredPulls"
          :drafts="drafts"
          :draft-count="draftPullRequests.length"
          :snoozed="snoozed"
          :snoozed-count="snoozedPullRequests.length"
          :stale-only="staleOnly"
          :saved-presets="savedPresets"
          :presets-saving="presetsSaving"
          :presets-error="presetsError"
          @update:view="view = $event"
          @update:bucket="bucket = $event"
          @update:q="q = $event"
          @toggle-repo="onToggleRepo"
          @toggle-all="onToggleAllRepos"
          @update:drafts="drafts = $event"
          @update:snoozed="snoozed = $event"
          @update:stale-only="staleOnly = $event"
          @apply-preset="onApplyPreset"
          @save-preset="onSavePreset"
          @delete-preset="onDeletePreset"
          @clear="resetFilters"
        />
      </div>

      <div class="dashboard-grid" :class="{ 'single-column': !showWaitingRail }">
        <ActionQueue
          :pull-requests="primaryQueuePulls"
          :selected-key="activeKey"
          :checked-keys="checkedKeys"
          :now-ms="nowMs"
          :is-loading="clientState === 'initializing' && !snapshot"
          :active-bucket="bucket"
          :has-filters="hasActiveFilters"
          :has-search-query="q.trim().length > 0"
          :show-snoozed="snoozed"
          :snoozed-count="snoozedPullRequests.length"
          :ready-count="readyPullRequests.length"
          :waiting-count="waitingPullRequests.length"
          :sync-states="syncStates"
          :draft-states="draftStates"
          :merge-states="mergeStates"
          :repo-labels-states="repoLabelsStates"
          :label-states="labelStates"
          :rerun-states="rerunStates"
          :triage-states="triageStates"
          :shared-ci-by-key="sharedCiByKey"
          @select="onSelectPr"
          @toggle-check="onToggleCheck"
          @sync="syncPullRequest"
          @rerun-checks="rerunPullChecks"
          @toggle-draft="togglePullDraft"
          @request-merge="openMergeConfirm"
          @load-labels="onLoadLabels"
          @retry-load-labels="onRetryLoadLabels"
          @update-labels="updatePullLabels"
          @toggle-pin="onTogglePin"
          @snooze="onSnoozePr"
          @unsnooze="onUnsnoozePr"
          @show-snoozed="snoozed = true"
          @select-bucket="onSelectBucket"
        >
          <template #inline-inspector="{ pr }">
            <PrInspector
              v-if="!isDesktop && inspector.key === pr.key"
              mode="inline"
              :pr="pr"
              :inspector="inspector"
              :now-ms="nowMs"
              :viewer-login="snapshot?.viewer.login"
              :resolved-theme="resolvedTheme"
              :sync-state="syncStates[pr.key]"
              :draft-state="draftStates[pr.key]"
              :merge-state="mergeStates[pr.key]"
              :repo-labels-state="repoLabelsStates[pr.repository]"
              :label-state="labelStates[pr.key]"
              :rerun-state="rerunStates[pr.key]"
              :check-summary-states="checkSummaryStates"
              :triage-state="triageStates[pr.key]"
              :review-submit-state="reviewSubmitStates[pr.key]"
              :thread-action-states="threadActionStates"
              :repo-reviewers-state="repoReviewersStates[pr.repository]"
              :pr-reviewers-state="prReviewersStates[pr.key]"
              :flaky-checks="flakyChecks"
              @close="closeInspector"
              @retry="openInspector"
              @sync="syncPullRequest"
              @rerun-checks="rerunPullChecks"
              @load-check-summary="loadCheckSummary"
              @toggle-pin="onTogglePin"
              @snooze="onSnoozePr"
              @unsnooze="onUnsnoozePr"
              @submit-review="submitPullReview"
              @reply-thread="replyToPullThread"
              @resolve-thread="togglePullThreadResolved"
              @load-reviewers="onLoadReviewers"
              @retry-load-reviewers="onRetryLoadReviewers"
              @update-reviewers="updatePullReviewers"
              @toggle-draft="togglePullDraft"
              @request-merge="openMergeConfirm"
              @load-labels="onLoadLabels"
              @retry-load-labels="onRetryLoadLabels"
              @update-labels="updatePullLabels"
              @open-mermaid="openMermaidFullscreen(pr, $event)"
            />
          </template>
        </ActionQueue>

        <aside
          v-if="showWaitingRail"
          class="context-rail app-scroll"
          aria-label="Ready and waiting queues"
        >
          <ReadyPanel
            :pull-requests="readyPullRequests"
            :selected-key="activeKey"
            :now-ms="nowMs"
            :merge-states="mergeStates"
            @select="onSelectPr"
            @request-merge="openMergeConfirm"
          >
            <template #inline-inspector="{ pr }">
              <PrInspector
                v-if="!isDesktop && inspector.key === pr.key"
                mode="inline"
                :pr="pr"
                :inspector="inspector"
                :now-ms="nowMs"
                :viewer-login="snapshot?.viewer.login"
                :resolved-theme="resolvedTheme"
                :sync-state="syncStates[pr.key]"
                :draft-state="draftStates[pr.key]"
                :merge-state="mergeStates[pr.key]"
                :repo-labels-state="repoLabelsStates[pr.repository]"
                :label-state="labelStates[pr.key]"
                :rerun-state="rerunStates[pr.key]"
                :check-summary-states="checkSummaryStates"
                :triage-state="triageStates[pr.key]"
                :review-submit-state="reviewSubmitStates[pr.key]"
                :thread-action-states="threadActionStates"
                :repo-reviewers-state="repoReviewersStates[pr.repository]"
                :pr-reviewers-state="prReviewersStates[pr.key]"
                :flaky-checks="flakyChecks"
                @close="closeInspector"
                @retry="openInspector"
                @sync="syncPullRequest"
                @rerun-checks="rerunPullChecks"
                @load-check-summary="loadCheckSummary"
                @toggle-pin="onTogglePin"
                @snooze="onSnoozePr"
                @unsnooze="onUnsnoozePr"
                @submit-review="submitPullReview"
                @reply-thread="replyToPullThread"
                @resolve-thread="togglePullThreadResolved"
                @load-reviewers="onLoadReviewers"
                @retry-load-reviewers="onRetryLoadReviewers"
                @update-reviewers="updatePullReviewers"
                @toggle-draft="togglePullDraft"
                @request-merge="openMergeConfirm"
                @load-labels="onLoadLabels"
                @retry-load-labels="onRetryLoadLabels"
                @update-labels="updatePullLabels"
                @open-mermaid="openMermaidFullscreen(pr, $event)"
              />
            </template>
          </ReadyPanel>

          <WaitingPanel
            :pull-requests="waitingPullRequests"
            :selected-key="activeKey"
            :now-ms="nowMs"
            :sync-states="syncStates"
            :draft-states="draftStates"
            @select="onSelectPr"
            @sync="syncPullRequest"
            @toggle-draft="togglePullDraft"
          >
            <template #inline-inspector="{ pr }">
              <PrInspector
                v-if="!isDesktop && inspector.key === pr.key"
                mode="inline"
                :pr="pr"
                :inspector="inspector"
                :now-ms="nowMs"
                :viewer-login="snapshot?.viewer.login"
                :resolved-theme="resolvedTheme"
                :sync-state="syncStates[pr.key]"
                :draft-state="draftStates[pr.key]"
                :merge-state="mergeStates[pr.key]"
                :repo-labels-state="repoLabelsStates[pr.repository]"
                :label-state="labelStates[pr.key]"
                :rerun-state="rerunStates[pr.key]"
                :check-summary-states="checkSummaryStates"
                :triage-state="triageStates[pr.key]"
                :review-submit-state="reviewSubmitStates[pr.key]"
                :thread-action-states="threadActionStates"
                :repo-reviewers-state="repoReviewersStates[pr.repository]"
                :pr-reviewers-state="prReviewersStates[pr.key]"
                :flaky-checks="flakyChecks"
                @close="closeInspector"
                @retry="openInspector"
                @sync="syncPullRequest"
                @rerun-checks="rerunPullChecks"
                @load-check-summary="loadCheckSummary"
                @toggle-pin="onTogglePin"
                @snooze="onSnoozePr"
                @unsnooze="onUnsnoozePr"
                @submit-review="submitPullReview"
                @reply-thread="replyToPullThread"
                @resolve-thread="togglePullThreadResolved"
                @load-reviewers="onLoadReviewers"
                @retry-load-reviewers="onRetryLoadReviewers"
                @update-reviewers="updatePullReviewers"
                @toggle-draft="togglePullDraft"
                @request-merge="openMergeConfirm"
                @load-labels="onLoadLabels"
                @retry-load-labels="onRetryLoadLabels"
                @update-labels="updatePullLabels"
                @open-mermaid="openMermaidFullscreen(pr, $event)"
              />
            </template>
          </WaitingPanel>
        </aside>
      </div>
    </main>

    <BulkActionBar
      :selected-pulls="selectedBulkPulls"
      :visible-count="primaryQueuePulls.length"
      :bulk-state="bulkState"
      @select-all-visible="selectAllVisible"
      @clear-selection="clearBulkSelection"
      @bulk-sync="runBulkSync(selectedBulkPulls)"
      @bulk-rerun="runBulkRerun(selectedBulkPulls)"
      @bulk-pin="runBulkPin(selectedBulkPulls)"
      @bulk-snooze="runBulkSnooze(selectedBulkPulls)"
      @bulk-draft="runBulkDraft(selectedBulkPulls, $event)"
      @cancel-bulk="cancelBulkAction"
      @dismiss-bulk="dismissBulkAction"
    />

    <footer class="app-footer">
      <div class="app-footer-inner">
        <div class="shortcut-bar" aria-label="Keyboard shortcuts">
          <span><kbd>⌘K</kbd> commands</span>
          <span><kbd>j</kbd>/<kbd>k</kbd> navigate</span>
          <span><kbd>Enter</kbd> inspect</span>
          <span><kbd>x</kbd> select</span>
          <span><kbd>o</kbd> open on GitHub</span>
          <span><kbd>p</kbd> pin</span>
          <span><kbd>z</kbd> snooze</span>
          <span><kbd>/</kbd> search</span>
          <span><kbd>r</kbd> refresh</span>
          <span><kbd>Esc</kbd> close / clear</span>
        </div>
        <span class="footer-summary mono-num">
          {{ primaryQueuePulls.length }} shown · {{ allPullRequests.length }} open
        </span>
      </div>
    </footer>

    <PrInspector
      v-if="isDesktop"
      mode="dialog"
      :pr="selectedPr"
      :inspector="inspector"
      :now-ms="nowMs"
      :viewer-login="snapshot?.viewer.login"
      :resolved-theme="resolvedTheme"
      :sync-state="selectedPr ? syncStates[selectedPr.key] : undefined"
      :draft-state="selectedPr ? draftStates[selectedPr.key] : undefined"
      :merge-state="selectedPr ? mergeStates[selectedPr.key] : undefined"
      :repo-labels-state="selectedPr ? repoLabelsStates[selectedPr.repository] : undefined"
      :label-state="selectedPr ? labelStates[selectedPr.key] : undefined"
      :rerun-state="selectedPr ? rerunStates[selectedPr.key] : undefined"
      :check-summary-states="checkSummaryStates"
      :triage-state="selectedPr ? triageStates[selectedPr.key] : undefined"
      :review-submit-state="selectedPr ? reviewSubmitStates[selectedPr.key] : undefined"
      :thread-action-states="threadActionStates"
      :repo-reviewers-state="selectedPr ? repoReviewersStates[selectedPr.repository] : undefined"
      :pr-reviewers-state="selectedPr ? prReviewersStates[selectedPr.key] : undefined"
      :flaky-checks="flakyChecks"
      @close="closeInspector"
      @retry="openInspector"
      @sync="syncPullRequest"
      @rerun-checks="rerunPullChecks"
      @load-check-summary="loadCheckSummary"
      @toggle-pin="onTogglePin"
      @snooze="onSnoozePr"
      @unsnooze="onUnsnoozePr"
      @submit-review="submitPullReview"
      @reply-thread="replyToPullThread"
      @resolve-thread="togglePullThreadResolved"
      @load-reviewers="onLoadReviewers"
      @retry-load-reviewers="onRetryLoadReviewers"
      @update-reviewers="updatePullReviewers"
      @toggle-draft="togglePullDraft"
      @request-merge="openMergeConfirm"
      @load-labels="onLoadLabels"
      @retry-load-labels="onRetryLoadLabels"
      @update-labels="updatePullLabels"
      @open-mermaid="openMermaidFullscreen(selectedPr, $event)"
    />

    <MergeConfirmDialog
      :open="mergeConfirm.status === 'open'"
      :pr="mergeConfirm.status === 'open' ? mergeConfirm.pr : null"
      :initial-method="mergeConfirm.status === 'open' ? mergeConfirm.mergeMethod : 'squash'"
      :merge-state="mergeConfirm.status === 'open' ? mergeStates[mergeConfirm.pr.key] : undefined"
      @close="closeMergeConfirm"
      @confirm="onConfirmMerge"
    />

    <MermaidFullscreenDialog
      :open="mermaidFullscreen.status === 'open'"
      :title="mermaidFullscreen.status === 'open' ? mermaidFullscreen.title : 'Mermaid diagram'"
      :source="mermaidFullscreen.status === 'open' ? mermaidFullscreen.source : ''"
      :resolved-theme="resolvedTheme"
      @close="closeMermaidFullscreen"
    />

    <CommandPaletteDialog :open="paletteOpen" :commands="paletteCommands" @close="closePalette" />

    <div class="visually-hidden" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ActionQueue from '@/components/ActionQueue.vue';
import AppHeader from '@/components/AppHeader.vue';
import BulkActionBar from '@/components/BulkActionBar.vue';
import CiOutageBanner from '@/components/CiOutageBanner.vue';
import CommandPaletteDialog from '@/components/CommandPaletteDialog.vue';
import FilterBar from '@/components/FilterBar.vue';
import KpiStrip from '@/components/KpiStrip.vue';
import MergeConfirmDialog from '@/components/MergeConfirmDialog.vue';
import MermaidFullscreenDialog from '@/components/MermaidFullscreenDialog.vue';
import PrInspector from '@/components/PrInspector.vue';
import ReadyPanel from '@/components/ReadyPanel.vue';
import WaitingPanel from '@/components/WaitingPanel.vue';
import WarningStrip from '@/components/WarningStrip.vue';
import { useDashboardState } from '@/composables/use-dashboard-state';
import { useTheme } from '@/composables/use-theme';
import {
  type BucketFilter,
  toggleAllReposSelection,
  toggleRepoInSelection,
  useUrlState,
} from '@/composables/use-url-state';
import type {
  CiOutageAlert,
  FlakyCheckSummary,
  MergeMethod,
  PrView,
  SavedFilterPreset,
  SnoozeCondition,
} from '@/types/pr';
import { IDLE_BULK_ACTION_STATE, runBulkAction, type BulkActionState } from '@/utils/bulk-runner';
import type { PaletteCommand } from '@/utils/command-palette';
import {
  BUILT_IN_PRESETS,
  dashboardFiltersToPresetFilters,
  presetFiltersToDashboardFilters,
} from '@/utils/presets';
import { isPrReadyToMerge } from '@/utils/ready-to-merge';
import { isPrPinned, isPrSnoozed } from '@/utils/triage';

type MergeConfirmState =
  | { status: 'closed' }
  | { status: 'open'; pr: PrView; mergeMethod: MergeMethod };

type MermaidFullscreenState =
  | { status: 'closed' }
  | { status: 'open'; title: string; source: string };

const {
  clientState,
  snapshot,
  nowMs,
  nextRefreshAtMs,
  recentlyUpdated,
  pollIntervalMs,
  isStale,
  offlineMessage,
  refreshCooldownNotice,
  announcement,
  inspector,
  syncStates,
  draftStates,
  mergeStates,
  repoLabelsStates,
  labelStates,
  rerunStates,
  checkSummaryStates,
  triageStates,
  reviewSubmitStates,
  threadActionStates,
  repoReviewersStates,
  prReviewersStates,
  savedPresets,
  presetsSaving,
  presetsError,
  fetchSnapshot,
  syncPullRequest,
  rerunPullChecks,
  loadCheckSummary,
  updatePullTriage,
  submitPullReview,
  replyToPullThread,
  togglePullThreadResolved,
  loadRepoReviewers,
  updatePullReviewers,
  saveFilterPreset,
  deleteFilterPreset,
  togglePullDraft,
  mergePullRequest,
  loadRepoLabels,
  updatePullLabels,
  openInspector,
  closeInspector,
  setPollIntervalMs,
} = useDashboardState();

function onLoadLabels(pr: PrView): void {
  void loadRepoLabels(pr.owner, pr.repo, false);
}

function onRetryLoadLabels(pr: PrView): void {
  void loadRepoLabels(pr.owner, pr.repo, true);
}

function onTogglePin(pr: PrView): void {
  void updatePullTriage(pr, isPrPinned(pr) ? 'unpin' : 'pin');
}

function onSnoozePr(pr: PrView, condition: SnoozeCondition): void {
  void updatePullTriage(pr, 'snooze', condition);
}

function onUnsnoozePr(pr: PrView): void {
  void updatePullTriage(pr, 'unsnooze');
}

function onLoadReviewers(pr: PrView): void {
  void loadRepoReviewers(pr.owner, pr.repo, false);
}

function onRetryLoadReviewers(pr: PrView): void {
  void loadRepoReviewers(pr.owner, pr.repo, true);
}

const mergeConfirm = ref<MergeConfirmState>({ status: 'closed' });
const mermaidFullscreen = ref<MermaidFullscreenState>({ status: 'closed' });

function openMermaidFullscreen(pr: PrView | null, source: string): void {
  const label = pr ? `${pr.key} · ${pr.title}` : 'Mermaid diagram';
  mermaidFullscreen.value = { status: 'open', title: label, source };
}

function closeMermaidFullscreen(): void {
  mermaidFullscreen.value = { status: 'closed' };
}

function openMergeConfirm(pr: PrView, mergeMethod: MergeMethod): void {
  mergeConfirm.value = { status: 'open', pr, mergeMethod };
}

function closeMergeConfirm(): void {
  mergeConfirm.value = { status: 'closed' };
}

async function onConfirmMerge(pr: PrView, mergeMethod: MergeMethod): Promise<void> {
  const merged = await mergePullRequest(pr, mergeMethod);
  if (merged) {
    closeMergeConfirm();
  }
}

const { resolvedTheme, toggleTheme } = useTheme();
const { view, bucket, q, repoSelection, drafts, snoozed, staleOnly, applyFilters, resetFilters } =
  useUrlState();

const paletteOpen = ref<boolean>(false);
const checkedKeys = ref<Set<string>>(new Set());
const lastCheckedKey = ref<string | null>(null);
const bulkState = ref<BulkActionState>(IDLE_BULK_ACTION_STATE);
let bulkCancelled = false;

function openPalette(): void {
  paletteOpen.value = true;
}

function closePalette(): void {
  paletteOpen.value = false;
}

function onApplyPreset(filters: SavedFilterPreset['filters']): void {
  applyFilters(presetFiltersToDashboardFilters(filters));
}

function onSavePreset(name: string): void {
  const filters = dashboardFiltersToPresetFilters({
    view: view.value,
    bucket: bucket.value,
    q: q.value,
    repoSelection: repoSelection.value,
    drafts: drafts.value,
    snoozed: snoozed.value,
    staleOnly: staleOnly.value,
  });
  void saveFilterPreset(name, filters);
}

function onDeletePreset(id: string): void {
  void deleteFilterPreset(id);
}

const filterBarRef = ref<InstanceType<typeof FilterBar> | null>(null);
const cursorKey = ref<string | null>(null);
const isDesktop = ref<boolean>(true);

const allPullRequests = computed<PrView[]>(() => snapshot.value?.pullRequests ?? []);
const ciOutages = computed<CiOutageAlert[]>(() => snapshot.value?.ciOutages ?? []);
const flakyChecks = computed<FlakyCheckSummary[]>(() => snapshot.value?.flakyChecks ?? []);
const dismissedOutageSignatures = ref<Set<string>>(new Set());

const sharedCiByKey = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {};
  for (const outage of ciOutages.value) {
    for (const key of outage.affectedPrKeys) {
      const existing = map[key];
      if (existing) {
        if (!existing.includes(outage.checkName)) {
          existing.push(outage.checkName);
        }
      } else {
        map[key] = [outage.checkName];
      }
    }
  }
  return map;
});

function onDismissOutage(signature: string): void {
  const next = new Set(dismissedOutageSignatures.value);
  next.add(signature);
  dismissedOutageSignatures.value = next;
}

function onFilterOutage(outage: CiOutageAlert): void {
  applyFilters({
    view: 'all',
    bucket: 'ci-failing',
    q: outage.checkName,
    repoSelection: { mode: 'subset', repos: [outage.repository] },
    drafts: false,
    snoozed: false,
    staleOnly: false,
  });
}

function matchesOwnership(pr: PrView): boolean {
  if (view.value === 'mine') {
    return pr.sources.includes('authored');
  }
  if (view.value === 'review') {
    return pr.sources.includes('review-requested');
  }
  if (view.value === 'team') {
    return !pr.sources.includes('authored');
  }
  return true;
}

function matchesSearchAndRepo(pr: PrView): boolean {
  if (repoSelection.value.mode === 'none') {
    return false;
  }
  if (repoSelection.value.mode === 'subset' && !repoSelection.value.repos.includes(pr.repository)) {
    return false;
  }
  const query = q.value.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return (
    pr.key.toLowerCase().includes(query) ||
    pr.title.toLowerCase().includes(query) ||
    pr.blockerSummary.toLowerCase().includes(query) ||
    pr.headRefName.toLowerCase().includes(query) ||
    pr.author.toLowerCase().includes(query) ||
    pr.labels.some((label) => label.name.toLowerCase().includes(query)) ||
    pr.ci.failing.some((check) => check.name.toLowerCase().includes(query))
  );
}

function onToggleRepo(repoName: string, allRepos: string[]): void {
  repoSelection.value = toggleRepoInSelection(repoSelection.value, repoName, allRepos);
}

function onToggleAllRepos(allRepos: string[]): void {
  repoSelection.value = toggleAllReposSelection(repoSelection.value, allRepos);
}

const ownershipFilteredPulls = computed<PrView[]>(() =>
  allPullRequests.value.filter(matchesOwnership),
);

const filteredBasePulls = computed<PrView[]>(() =>
  ownershipFilteredPulls.value.filter(matchesSearchAndRepo),
);

const scopedPulls = computed<PrView[]>(() =>
  drafts.value
    ? filteredBasePulls.value
    : filteredBasePulls.value.filter((pr) => pr.bucket !== 'draft'),
);

const snoozedPullRequests = computed<PrView[]>(() => scopedPulls.value.filter(isPrSnoozed));

const snoozedNeedsMeCount = computed<number>(
  () => scopedPulls.value.filter((pr) => pr.bucket === 'needs-me' && isPrSnoozed(pr)).length,
);

const activeScopedPulls = computed<PrView[]>(() =>
  scopedPulls.value.filter((pr) => !isPrSnoozed(pr)),
);

const visibleScopedPulls = computed<PrView[]>(() =>
  snoozed.value ? scopedPulls.value : activeScopedPulls.value,
);

const primaryQueuePulls = computed<PrView[]>(() => {
  const baseForBucket = snoozed.value
    ? filteredBasePulls.value
    : filteredBasePulls.value.filter((pr) => !isPrSnoozed(pr));
  let result: PrView[];
  if (bucket.value === 'ci-failing') {
    result = visibleScopedPulls.value.filter((pr) => pr.ci.state === 'failing');
  } else if (bucket.value === 'waiting') {
    result = baseForBucket.filter(
      (pr) => pr.bucket === 'waiting' && (view.value === 'team' || pr.sources.includes('authored')),
    );
  } else if (bucket.value) {
    result = baseForBucket.filter((pr) => pr.bucket === bucket.value);
  } else {
    result = visibleScopedPulls.value;
  }
  return staleOnly.value ? result.filter((pr) => pr.idleDays > 3) : result;
});

watch(allPullRequests, (nextPulls) => {
  if (checkedKeys.value.size === 0) {
    return;
  }
  const openSet = new Set(nextPulls.map((pr) => pr.key));
  const kept = new Set<string>();
  for (const key of checkedKeys.value) {
    if (openSet.has(key)) {
      kept.add(key);
    }
  }
  if (kept.size !== checkedKeys.value.size) {
    checkedKeys.value = kept;
  }
});

const selectedBulkPulls = computed<PrView[]>(() =>
  allPullRequests.value.filter((pr) => checkedKeys.value.has(pr.key)),
);

function onToggleCheck(pr: PrView, shiftKey: boolean): void {
  if (bulkState.value.status === 'done') {
    bulkState.value = IDLE_BULK_ACTION_STATE;
  }
  const next = new Set(checkedKeys.value);
  if (shiftKey && lastCheckedKey.value) {
    const list = primaryQueuePulls.value;
    const fromIdx = list.findIndex((p) => p.key === lastCheckedKey.value);
    const toIdx = list.findIndex((p) => p.key === pr.key);
    if (fromIdx >= 0 && toIdx >= 0) {
      const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      for (let i = start; i <= end; i++) {
        next.add(list[i]!.key);
      }
      checkedKeys.value = next;
      lastCheckedKey.value = pr.key;
      return;
    }
  }
  if (next.has(pr.key)) {
    next.delete(pr.key);
  } else {
    next.add(pr.key);
  }
  checkedKeys.value = next;
  lastCheckedKey.value = pr.key;
}

function selectAllVisible(): void {
  if (bulkState.value.status === 'done') {
    bulkState.value = IDLE_BULK_ACTION_STATE;
  }
  checkedKeys.value = new Set(primaryQueuePulls.value.map((pr) => pr.key));
}

function clearBulkSelection(): void {
  checkedKeys.value = new Set();
  lastCheckedKey.value = null;
}

function cancelBulkAction(): void {
  bulkCancelled = true;
}

function dismissBulkAction(): void {
  bulkState.value = IDLE_BULK_ACTION_STATE;
}

async function runBulkSync(targets: PrView[]): Promise<void> {
  const eligible = targets.filter((pr) => pr.merge.state === 'behind');
  if (eligible.length === 0 || bulkState.value.status === 'running') {
    return;
  }
  bulkCancelled = false;
  await runBulkAction({
    actionLabel: 'Syncing branches',
    items: eligible,
    concurrency: 2,
    isCancelled: () => bulkCancelled,
    onUpdate: (st) => {
      bulkState.value = st;
    },
    execute: async (pr) => {
      await syncPullRequest(pr);
      const st = syncStates.value[pr.key];
      if (st?.status === 'error') {
        return { ok: false, error: st.error, fatal: /rate limit|401|unauthorized/i.test(st.error) };
      }
      return { ok: true };
    },
  });
  clearBulkSelection();
}

async function runBulkRerun(targets: PrView[]): Promise<void> {
  const eligible = targets.filter((pr) => pr.ci.state === 'failing');
  if (eligible.length === 0 || bulkState.value.status === 'running') {
    return;
  }
  bulkCancelled = false;
  await runBulkAction({
    actionLabel: 'Re-running failed CI',
    items: eligible,
    concurrency: 2,
    isCancelled: () => bulkCancelled,
    onUpdate: (st) => {
      bulkState.value = st;
    },
    execute: async (pr) => {
      const ok = await rerunPullChecks(pr);
      const st = rerunStates.value[pr.key];
      if (!ok) {
        const err = st?.status === 'error' ? st.error : 'Failed to re-run CI';
        return { ok: false, error: err, fatal: /rate limit|401|unauthorized/i.test(err) };
      }
      return { ok: true };
    },
  });
  clearBulkSelection();
}

async function runBulkPin(targets: PrView[]): Promise<void> {
  if (targets.length === 0 || bulkState.value.status === 'running') {
    return;
  }
  bulkCancelled = false;
  await runBulkAction({
    actionLabel: 'Pinning PRs',
    items: targets,
    concurrency: 2,
    isCancelled: () => bulkCancelled,
    onUpdate: (st) => {
      bulkState.value = st;
    },
    execute: async (pr) => {
      const ok = await updatePullTriage(pr, 'pin');
      const st = triageStates.value[pr.key];
      return ok ? { ok: true } : { ok: false, error: st?.status === 'error' ? st.error : 'Failed' };
    },
  });
  clearBulkSelection();
}

async function runBulkSnooze(targets: PrView[]): Promise<void> {
  if (targets.length === 0 || bulkState.value.status === 'running') {
    return;
  }
  bulkCancelled = false;
  await runBulkAction({
    actionLabel: 'Snoozing PRs',
    items: targets,
    concurrency: 2,
    isCancelled: () => bulkCancelled,
    onUpdate: (st) => {
      bulkState.value = st;
    },
    execute: async (pr) => {
      const condition: SnoozeCondition = pr.headRefOid
        ? { kind: 'until-push', headRefOid: pr.headRefOid }
        : { kind: 'until-time', untilIso: new Date(Date.now() + 2 * 60 * 60_000).toISOString() };
      const ok = await updatePullTriage(pr, 'snooze', condition);
      const st = triageStates.value[pr.key];
      return ok ? { ok: true } : { ok: false, error: st?.status === 'error' ? st.error : 'Failed' };
    },
  });
  clearBulkSelection();
}

async function runBulkDraft(targets: PrView[], targetDraft: boolean): Promise<void> {
  const eligible = targets.filter((pr) => pr.isDraft !== targetDraft);
  if (eligible.length === 0 || bulkState.value.status === 'running') {
    return;
  }
  bulkCancelled = false;
  await runBulkAction({
    actionLabel: targetDraft ? 'Marking as draft' : 'Marking ready for review',
    items: eligible,
    concurrency: 2,
    isCancelled: () => bulkCancelled,
    onUpdate: (st) => {
      bulkState.value = st;
    },
    execute: async (pr) => {
      await togglePullDraft(pr, targetDraft);
      const st = draftStates.value[pr.key];
      if (st?.status === 'error') {
        return { ok: false, error: st.error, fatal: /rate limit|401|unauthorized/i.test(st.error) };
      }
      return { ok: true };
    },
  });
  clearBulkSelection();
}

const readyPullRequests = computed<PrView[]>(() =>
  filteredBasePulls.value.filter(
    (pr) => isPrReadyToMerge(pr) && (snoozed.value || !isPrSnoozed(pr)),
  ),
);

const waitingPullRequests = computed<PrView[]>(() =>
  filteredBasePulls.value.filter(
    (pr) =>
      pr.bucket === 'waiting' &&
      pr.sources.includes('authored') &&
      (snoozed.value || !isPrSnoozed(pr)),
  ),
);

const draftPullRequests = computed<PrView[]>(() =>
  filteredBasePulls.value.filter((pr) => pr.bucket === 'draft'),
);

const showWaitingRail = computed<boolean>(() => bucket.value === '' && view.value !== 'team');

const hasActiveFilters = computed<boolean>(() => {
  return (
    view.value !== 'all' ||
    bucket.value !== '' ||
    q.value.trim() !== '' ||
    repoSelection.value.mode !== 'all' ||
    drafts.value ||
    snoozed.value ||
    staleOnly.value
  );
});

const focusedOrSelectedPr = computed<PrView | null>(() => {
  if (!activeKey.value) {
    return null;
  }
  return allPullRequests.value.find((p) => p.key === activeKey.value) ?? null;
});

const paletteCommands = computed<PaletteCommand[]>(() => {
  const commands: PaletteCommand[] = [];
  const activePr = focusedOrSelectedPr.value;

  if (activePr) {
    commands.push({
      id: `active:inspect:${activePr.key}`,
      category: 'Active PR',
      title: `Inspect ${activePr.key}`,
      subtitle: activePr.title,
      shortcut: 'Enter',
      run: () => onSelectPr(activePr),
    });
    if (activePr.merge.state === 'behind') {
      commands.push({
        id: `active:sync:${activePr.key}`,
        category: 'Active PR',
        title: `Sync ${activePr.key} with ${activePr.baseRefName}`,
        subtitle: activePr.title,
        run: () => {
          void syncPullRequest(activePr);
        },
      });
    }
    if (activePr.ci.state === 'failing') {
      commands.push({
        id: `active:rerun:${activePr.key}`,
        category: 'Active PR',
        title: `Re-run failed CI on ${activePr.key}`,
        subtitle: activePr.title,
        run: () => {
          void rerunPullChecks(activePr);
        },
      });
    }
    if (!activePr.isDraft) {
      commands.push({
        id: `active:merge:${activePr.key}`,
        category: 'Active PR',
        title: `Squash and merge ${activePr.key}`,
        subtitle: 'Opens confirmation dialog',
        run: () => openMergeConfirm(activePr, 'squash'),
      });
    }
    commands.push({
      id: `active:draft:${activePr.key}`,
      category: 'Active PR',
      title: activePr.isDraft
        ? `Mark ${activePr.key} ready for review`
        : `Convert ${activePr.key} to draft`,
      run: () => {
        void togglePullDraft(activePr, !activePr.isDraft);
      },
    });
    commands.push({
      id: `active:pin:${activePr.key}`,
      category: 'Active PR',
      title: isPrPinned(activePr) ? `Unpin ${activePr.key}` : `Pin ${activePr.key} to top`,
      shortcut: 'p',
      run: () => onTogglePin(activePr),
    });
    commands.push({
      id: `active:snooze:${activePr.key}`,
      category: 'Active PR',
      title: isPrSnoozed(activePr)
        ? `Unsnooze ${activePr.key}`
        : `Snooze ${activePr.key} until next push`,
      shortcut: 'z',
      run: () => {
        if (isPrSnoozed(activePr)) {
          onUnsnoozePr(activePr);
        } else {
          const cond: SnoozeCondition = activePr.headRefOid
            ? { kind: 'until-push', headRefOid: activePr.headRefOid }
            : {
                kind: 'until-time',
                untilIso: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
              };
          onSnoozePr(activePr, cond);
        }
      },
    });
    commands.push({
      id: `active:open:${activePr.key}`,
      category: 'Active PR',
      title: `Open ${activePr.key} on GitHub`,
      shortcut: 'o',
      run: () => {
        window.open(activePr.url, '_blank', 'noopener,noreferrer');
      },
    });
  }

  for (const preset of BUILT_IN_PRESETS) {
    commands.push({
      id: `preset:${preset.id}`,
      category: 'Presets',
      title: preset.name,
      subtitle: preset.description,
      run: () => onApplyPreset(preset.filters),
    });
  }
  for (const preset of savedPresets.value) {
    commands.push({
      id: `preset:saved:${preset.id}`,
      category: 'Presets',
      title: preset.name,
      subtitle: 'Saved view',
      run: () => onApplyPreset(preset.filters),
    });
  }

  const visibleBehind = primaryQueuePulls.value.filter((pr) => pr.merge.state === 'behind');
  const visibleFailing = primaryQueuePulls.value.filter((pr) => pr.ci.state === 'failing');
  if (primaryQueuePulls.value.length > 0) {
    commands.push({
      id: 'bulk:select-all',
      category: 'Bulk Actions',
      title: `Select all visible PRs (${primaryQueuePulls.value.length})`,
      run: selectAllVisible,
    });
  }
  if (visibleBehind.length > 0) {
    commands.push({
      id: 'bulk:sync-visible',
      category: 'Bulk Actions',
      title: `Sync all behind PRs in view (${visibleBehind.length})`,
      run: () => {
        void runBulkSync(visibleBehind);
      },
    });
  }
  if (visibleFailing.length > 0) {
    commands.push({
      id: 'bulk:rerun-visible',
      category: 'Bulk Actions',
      title: `Re-run all failing CI in view (${visibleFailing.length})`,
      run: () => {
        void runBulkRerun(visibleFailing);
      },
    });
  }
  if (checkedKeys.value.size > 0) {
    commands.push({
      id: 'bulk:clear-selection',
      category: 'Bulk Actions',
      title: `Clear selection (${checkedKeys.value.size})`,
      run: clearBulkSelection,
    });
  }

  commands.push(
    {
      id: 'app:refresh',
      category: 'App',
      title: 'Force refresh from GitHub',
      shortcut: 'r',
      run: () => {
        void fetchSnapshot(true);
      },
    },
    {
      id: 'app:theme',
      category: 'App',
      title: resolvedTheme.value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      run: toggleTheme,
    },
    {
      id: 'app:drafts',
      category: 'App',
      title: drafts.value ? 'Hide draft PRs' : 'Include draft PRs',
      run: () => {
        drafts.value = !drafts.value;
      },
    },
    {
      id: 'app:snoozed',
      category: 'App',
      title: snoozed.value ? 'Hide snoozed PRs' : 'Show snoozed PRs',
      run: () => {
        snoozed.value = !snoozed.value;
      },
    },
    {
      id: 'app:reset-filters',
      category: 'App',
      title: 'Reset all filters',
      shortcut: 'Esc',
      run: resetFilters,
    },
  );

  for (const pr of allPullRequests.value) {
    commands.push({
      id: `pr:${pr.key}`,
      category: 'Pull Requests',
      title: `${pr.key} · ${pr.title}`,
      subtitle: `@${pr.author} · ${pr.blockerSummary}`,
      keywords: `${pr.headRefName} ${pr.labels.map((l) => l.name).join(' ')}`,
      run: () => onSelectPr(pr),
    });
  }

  return commands;
});

const activeKey = computed<string | null>(() => inspector.value.key ?? cursorKey.value);

const selectedPr = computed<PrView | null>(() => {
  if (!inspector.value.key) {
    return null;
  }
  return allPullRequests.value.find((p) => p.key === inspector.value.key) ?? null;
});

function onSelectBucket(next: BucketFilter): void {
  bucket.value = next;
}

function onSelectPr(pr: PrView): void {
  cursorKey.value = pr.key;
  if (!isDesktop.value && inspector.value.key === pr.key) {
    closeInspector();
    return;
  }
  void openInspector(pr);
}

function focusCardByIndex(index: number): void {
  const list = primaryQueuePulls.value;
  const item = list[index];
  if (!item) {
    return;
  }
  cursorKey.value = item.key;
  const trigger = document.querySelector<HTMLButtonElement>(
    `[data-pr-key="${CSS.escape(item.key)}"]`,
  );
  trigger?.focus();
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const PROTECTED_INSPECTOR_SELECTOR =
  '.inspector-dialog, .pr-card, .ready-item, .waiting-item, .merge-confirm-dialog, .mermaid-fullscreen-dialog, .command-palette-dialog, .merge-menu-popover, .label-picker-popover, .snooze-picker-popover, .reviewer-picker-popover, .preset-picker-popover, .bulk-action-bar, .refresh-btn';
let lastPointerDownProtected = false;

function isProtectedInspectorTarget(target: EventTarget | null): boolean {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest(PROTECTED_INSPECTOR_SELECTOR));
}

function onGlobalPointerdown(event: PointerEvent): void {
  lastPointerDownProtected = isProtectedInspectorTarget(event.target);
}

function onGlobalClick(event: MouseEvent): void {
  const startedInProtected = lastPointerDownProtected;
  lastPointerDownProtected = false;
  if (
    !isDesktop.value ||
    inspector.value.status === 'closed' ||
    mergeConfirm.value.status === 'open' ||
    mermaidFullscreen.value.status === 'open' ||
    startedInProtected
  ) {
    return;
  }
  if (!isProtectedInspectorTarget(event.target)) {
    closeInspector();
  }
}

function hasOpenPopover(): boolean {
  try {
    if (document.querySelector('[popover]:popover-open')) {
      return true;
    }
  } catch {
    // Selector unsupported in older/test DOM engines
  }
  return Boolean(document.querySelector('[popover].fallback-open'));
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 'k' &&
    mergeConfirm.value.status !== 'open' &&
    mermaidFullscreen.value.status !== 'open'
  ) {
    event.preventDefault();
    paletteOpen.value = !paletteOpen.value;
    return;
  }

  if (
    paletteOpen.value ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    mergeConfirm.value.status === 'open' ||
    mermaidFullscreen.value.status === 'open'
  ) {
    return;
  }

  if (event.key === 'Escape') {
    if (hasOpenPopover()) {
      return;
    }
    if (inspector.value.status !== 'closed') {
      closeInspector();
      return;
    }
    if (checkedKeys.value.size > 0) {
      clearBulkSelection();
      return;
    }
    if (event.target instanceof HTMLInputElement && event.target.id === 'pr-search') {
      if (q.value !== '') {
        q.value = '';
      } else {
        event.target.blur();
      }
      return;
    }
    if (hasActiveFilters.value) {
      resetFilters();
    }
    return;
  }

  if (isEditableElement(event.target)) {
    return;
  }

  if (event.key === '/') {
    event.preventDefault();
    filterBarRef.value?.focusSearch({ suppressSlash: true });
    return;
  }

  if (event.key === 'r') {
    event.preventDefault();
    void fetchSnapshot(true);
    return;
  }

  const queue = primaryQueuePulls.value;
  if (event.key === 'j' || event.key === 'k') {
    if (queue.length === 0) {
      return;
    }
    event.preventDefault();
    const focusedKey =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.prKey
        : undefined;
    const currentKey = focusedKey ?? cursorKey.value;
    const currentIdx = currentKey ? queue.findIndex((p) => p.key === currentKey) : -1;
    const nextIdx =
      event.key === 'j'
        ? currentIdx < 0
          ? 0
          : Math.min(queue.length - 1, currentIdx + 1)
        : currentIdx <= 0
          ? 0
          : currentIdx - 1;
    focusCardByIndex(nextIdx);
    return;
  }

  if (event.key === 'o') {
    const key =
      (document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.prKey
        : undefined) ?? activeKey.value;
    const targetPr = allPullRequests.value.find((p) => p.key === key);
    if (targetPr) {
      event.preventDefault();
      window.open(targetPr.url, '_blank', 'noopener,noreferrer');
    }
    return;
  }

  if (event.key === 'p' || event.key === 'z' || event.key === 'x') {
    const key =
      (document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.prKey
        : undefined) ?? activeKey.value;
    const targetPr = allPullRequests.value.find((p) => p.key === key);
    if (!targetPr) {
      return;
    }
    event.preventDefault();
    if (event.key === 'x') {
      onToggleCheck(targetPr, event.shiftKey);
      return;
    }
    if (event.key === 'p') {
      onTogglePin(targetPr);
      return;
    }
    if (isPrSnoozed(targetPr)) {
      onUnsnoozePr(targetPr);
      return;
    }
    const trigger = document.querySelector<HTMLButtonElement>(
      `[data-snooze-trigger="${CSS.escape(targetPr.key)}"]`,
    );
    trigger?.click();
  }
}

let desktopQuery: MediaQueryList | null = null;

function updateViewportMode(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  isDesktop.value = window.matchMedia('(min-width: 768px)').matches;
}

onMounted(() => {
  updateViewportMode();
  if (typeof window.matchMedia === 'function') {
    desktopQuery = window.matchMedia('(min-width: 768px)');
    desktopQuery.addEventListener('change', updateViewportMode);
  }
  window.addEventListener('keydown', onGlobalKeydown);
  document.addEventListener('pointerdown', onGlobalPointerdown, { capture: true });
  document.addEventListener('click', onGlobalClick, { capture: true });
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onGlobalKeydown);
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', onGlobalPointerdown, { capture: true });
    document.removeEventListener('click', onGlobalClick, { capture: true });
  }
  if (desktopQuery) {
    desktopQuery.removeEventListener('change', updateViewportMode);
  }
});
</script>

<style scoped>
.dashboard-shell {
  block-size: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: clip;
}

.dashboard-shell > :deep(header),
.dashboard-shell > :deep(.warning-strip),
.app-footer {
  flex: 0 0 auto;
}

.dashboard-main {
  flex: 1 1 auto;
  min-block-size: 0;
  inline-size: 100%;
  max-inline-size: 90rem;
  margin-inline: auto;
  padding: 0.875rem 1.25rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  overflow: clip;
}

.dashboard-controls {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.dashboard-grid {
  flex: 1 1 auto;
  min-block-size: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(18rem, 1fr);
  grid-template-rows: minmax(0, 1fr);
  align-items: stretch;
  gap: 1rem;
  overflow: clip;
}

.dashboard-grid.single-column {
  grid-template-columns: minmax(0, 1fr);
}

.context-rail {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  min-inline-size: 0;
  min-block-size: 0;
  padding-block-end: 0.75rem;
  padding-inline-end: 0.25rem;
}

.app-footer {
  border-top: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  padding: 0.5rem 1.25rem;
}

.app-footer-inner {
  inline-size: 100%;
  max-inline-size: 90rem;
  margin-inline: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 1rem;
  font-size: 0.75rem;
  color: var(--ink-muted);
}

.shortcut-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 1rem;
}

.shortcut-bar kbd {
  padding: 0.05rem 0.32rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-secondary);
  font-family: var(--font-mono);
  font-size: 0.7rem;
}

.footer-summary {
  margin-inline-start: auto;
  color: var(--ink-secondary);
  font-size: 0.75rem;
}

@media (max-width: 1023px) {
  .dashboard-grid {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-block-end: 0.75rem;
  }

  .context-rail {
    overflow: visible;
    scrollbar-gutter: auto;
    padding-block-end: 0;
    padding-inline-end: 0;
  }
}

@media (max-width: 767px) {
  .dashboard-main {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.75rem 0.875rem 1rem;
  }

  .dashboard-grid {
    flex: 0 0 auto;
    overflow: visible;
    padding-block-end: 0;
  }

  .app-footer {
    padding: 0.45rem 0.875rem;
  }

  .shortcut-bar {
    display: none;
  }
}

@media (pointer: coarse) {
  .shortcut-bar {
    display: none;
  }
}
</style>
