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

    <main class="dashboard-main">
      <div class="dashboard-controls">
        <KpiStrip
          :pull-requests="scopedPulls"
          :active-bucket="bucket"
          :now-ms="nowMs"
          :waiting-includes-team="view === 'team'"
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
          @update:view="view = $event"
          @update:bucket="bucket = $event"
          @update:q="q = $event"
          @toggle-repo="onToggleRepo"
          @toggle-all="onToggleAllRepos"
          @update:drafts="drafts = $event"
          @clear="resetFilters"
        />
      </div>

      <div class="dashboard-grid" :class="{ 'single-column': !showWaitingRail }">
        <ActionQueue
          :pull-requests="primaryQueuePulls"
          :selected-key="activeKey"
          :now-ms="nowMs"
          :is-loading="clientState === 'initializing' && !snapshot"
          :active-bucket="bucket"
          :has-filters="hasActiveFilters"
          :sync-states="syncStates"
          :draft-states="draftStates"
          :merge-states="mergeStates"
          :repo-labels-states="repoLabelsStates"
          :label-states="labelStates"
          :rerun-states="rerunStates"
          @select="onSelectPr"
          @sync="syncPullRequest"
          @rerun-checks="rerunPullChecks"
          @toggle-draft="togglePullDraft"
          @request-merge="openMergeConfirm"
          @load-labels="onLoadLabels"
          @retry-load-labels="onRetryLoadLabels"
          @update-labels="updatePullLabels"
        >
          <template #inline-inspector="{ pr }">
            <PrInspector
              v-if="!isDesktop && inspector.key === pr.key"
              mode="inline"
              :pr="pr"
              :inspector="inspector"
              :now-ms="nowMs"
              :resolved-theme="resolvedTheme"
              :sync-state="syncStates[pr.key]"
              :draft-state="draftStates[pr.key]"
              :merge-state="mergeStates[pr.key]"
              :repo-labels-state="repoLabelsStates[pr.repository]"
              :label-state="labelStates[pr.key]"
              :rerun-state="rerunStates[pr.key]"
              :check-summary-states="checkSummaryStates"
              @close="closeInspector"
              @retry="openInspector"
              @sync="syncPullRequest"
              @rerun-checks="rerunPullChecks"
              @load-check-summary="loadCheckSummary"
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
                :resolved-theme="resolvedTheme"
                :sync-state="syncStates[pr.key]"
                :draft-state="draftStates[pr.key]"
                :merge-state="mergeStates[pr.key]"
                :repo-labels-state="repoLabelsStates[pr.repository]"
                :label-state="labelStates[pr.key]"
                :rerun-state="rerunStates[pr.key]"
                :check-summary-states="checkSummaryStates"
                @close="closeInspector"
                @retry="openInspector"
                @sync="syncPullRequest"
                @rerun-checks="rerunPullChecks"
                @load-check-summary="loadCheckSummary"
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
                :resolved-theme="resolvedTheme"
                :sync-state="syncStates[pr.key]"
                :draft-state="draftStates[pr.key]"
                :merge-state="mergeStates[pr.key]"
                :repo-labels-state="repoLabelsStates[pr.repository]"
                :label-state="labelStates[pr.key]"
                :rerun-state="rerunStates[pr.key]"
                :check-summary-states="checkSummaryStates"
                @close="closeInspector"
                @retry="openInspector"
                @sync="syncPullRequest"
                @rerun-checks="rerunPullChecks"
                @load-check-summary="loadCheckSummary"
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

    <footer class="app-footer">
      <div class="app-footer-inner">
        <div class="shortcut-bar" aria-label="Keyboard shortcuts">
          <span><kbd>j</kbd>/<kbd>k</kbd> navigate</span>
          <span><kbd>Enter</kbd> inspect</span>
          <span><kbd>o</kbd> open on GitHub</span>
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
      :resolved-theme="resolvedTheme"
      :sync-state="selectedPr ? syncStates[selectedPr.key] : undefined"
      :draft-state="selectedPr ? draftStates[selectedPr.key] : undefined"
      :merge-state="selectedPr ? mergeStates[selectedPr.key] : undefined"
      :repo-labels-state="selectedPr ? repoLabelsStates[selectedPr.repository] : undefined"
      :label-state="selectedPr ? labelStates[selectedPr.key] : undefined"
      :rerun-state="selectedPr ? rerunStates[selectedPr.key] : undefined"
      :check-summary-states="checkSummaryStates"
      @close="closeInspector"
      @retry="openInspector"
      @sync="syncPullRequest"
      @rerun-checks="rerunPullChecks"
      @load-check-summary="loadCheckSummary"
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

    <div class="visually-hidden" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ActionQueue from '@/components/ActionQueue.vue';
import AppHeader from '@/components/AppHeader.vue';
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
import type { MergeMethod, PrView } from '@/types/pr';
import { isPrReadyToMerge } from '@/utils/ready-to-merge';

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
  fetchSnapshot,
  syncPullRequest,
  rerunPullChecks,
  loadCheckSummary,
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
const { view, bucket, q, repoSelection, drafts, resetFilters } = useUrlState();

const filterBarRef = ref<InstanceType<typeof FilterBar> | null>(null);
const cursorKey = ref<string | null>(null);
const isDesktop = ref<boolean>(true);

const allPullRequests = computed<PrView[]>(() => snapshot.value?.pullRequests ?? []);

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
    pr.labels.some((label) => label.name.toLowerCase().includes(query))
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

const primaryQueuePulls = computed<PrView[]>(() => {
  if (bucket.value === 'ci-failing') {
    return scopedPulls.value.filter((pr) => pr.ci.state === 'failing');
  }
  if (bucket.value === 'waiting') {
    return filteredBasePulls.value.filter(
      (pr) => pr.bucket === 'waiting' && (view.value === 'team' || pr.sources.includes('authored')),
    );
  }
  if (bucket.value) {
    return filteredBasePulls.value.filter((pr) => pr.bucket === bucket.value);
  }
  return scopedPulls.value;
});

const readyPullRequests = computed<PrView[]>(() =>
  filteredBasePulls.value.filter(isPrReadyToMerge),
);

const waitingPullRequests = computed<PrView[]>(() =>
  filteredBasePulls.value.filter(
    (pr) => pr.bucket === 'waiting' && pr.sources.includes('authored'),
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
    drafts.value
  );
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
  '.inspector-dialog, .pr-card, .ready-item, .waiting-item, .merge-confirm-dialog, .mermaid-fullscreen-dialog, .merge-menu-popover, .label-picker-popover, .refresh-btn';
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

function onGlobalKeydown(event: KeyboardEvent): void {
  if (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    mergeConfirm.value.status === 'open' ||
    mermaidFullscreen.value.status === 'open'
  ) {
    return;
  }

  if (event.key === 'Escape') {
    if (inspector.value.status !== 'closed') {
      closeInspector();
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
