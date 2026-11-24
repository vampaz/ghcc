<template>
  <div class="dashboard-shell">
    <a href="#action-queue" class="skip-link visually-hidden">Skip to action queue</a>

    <AppHeader
      :viewer-login="snapshot?.viewer.login"
      :fetched-at="snapshot?.fetchedAt"
      :now-ms="nowMs"
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
      <KpiStrip
        :pull-requests="allPullRequests"
        :active-bucket="bucket"
        @select-bucket="onSelectBucket"
      />

      <FilterBar
        ref="filterBarRef"
        :view="view"
        :bucket="bucket"
        :q="q"
        :repo="repo"
        :drafts="drafts"
        :repo-options="repoOptions"
        :total-count="allPullRequests.length"
        :draft-count="draftPullRequests.length"
        @update:view="view = $event"
        @update:bucket="bucket = $event"
        @update:q="q = $event"
        @update:repo="repo = $event"
        @update:drafts="drafts = $event"
        @clear="resetFilters"
      />

      <div class="dashboard-grid">
        <ActionQueue
          :pull-requests="primaryQueuePulls"
          :selected-key="activeKey"
          :now-ms="nowMs"
          :is-loading="clientState === 'initializing' && !snapshot"
          :active-bucket="bucket"
          :has-filters="hasActiveFilters"
          @select="onSelectPr"
        >
          <template #inline-inspector="{ pr }">
            <PrInspector
              v-if="!isDesktop && inspector.key === pr.key"
              mode="inline"
              :pr="pr"
              :inspector="inspector"
              :now-ms="nowMs"
              @close="closeInspector"
              @retry="openInspector"
            />
          </template>
        </ActionQueue>

        <aside class="context-rail" aria-label="Waiting queue, repositories, and drafts">
          <WaitingPanel
            :pull-requests="waitingPullRequests"
            :selected-key="activeKey"
            :now-ms="nowMs"
            @select="onSelectPr"
          >
            <template #inline-inspector="{ pr }">
              <PrInspector
                v-if="!isDesktop && inspector.key === pr.key"
                mode="inline"
                :pr="pr"
                :inspector="inspector"
                :now-ms="nowMs"
                @close="closeInspector"
                @retry="openInspector"
              />
            </template>
          </WaitingPanel>

          <RepoBreakdown
            :pull-requests="ownershipFilteredPulls"
            :active-repo="repo"
            @select-repo="repo = $event"
          />

          <DraftsPanel
            :pull-requests="draftPullRequests"
            :expanded="drafts"
            :selected-key="activeKey"
            :now-ms="nowMs"
            @toggle="drafts = !drafts"
            @select="onSelectPr"
          >
            <template #inline-inspector="{ pr }">
              <PrInspector
                v-if="!isDesktop && inspector.key === pr.key"
                mode="inline"
                :pr="pr"
                :inspector="inspector"
                :now-ms="nowMs"
                @close="closeInspector"
                @retry="openInspector"
              />
            </template>
          </DraftsPanel>
        </aside>
      </div>
    </main>

    <PrInspector
      v-if="isDesktop"
      mode="dialog"
      :pr="selectedPr"
      :inspector="inspector"
      :now-ms="nowMs"
      @close="closeInspector"
      @retry="openInspector"
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
import DraftsPanel from '@/components/DraftsPanel.vue';
import FilterBar from '@/components/FilterBar.vue';
import KpiStrip from '@/components/KpiStrip.vue';
import PrInspector from '@/components/PrInspector.vue';
import RepoBreakdown from '@/components/RepoBreakdown.vue';
import WaitingPanel from '@/components/WaitingPanel.vue';
import WarningStrip from '@/components/WarningStrip.vue';
import { useDashboardState } from '@/composables/use-dashboard-state';
import { useTheme } from '@/composables/use-theme';
import { type BucketFilter, useUrlState } from '@/composables/use-url-state';
import type { PrView } from '@/types/pr';

const {
  clientState,
  snapshot,
  nowMs,
  pollIntervalMs,
  isStale,
  offlineMessage,
  refreshCooldownNotice,
  announcement,
  inspector,
  fetchSnapshot,
  openInspector,
  closeInspector,
  setPollIntervalMs,
} = useDashboardState();

const { resolvedTheme, toggleTheme } = useTheme();
const { view, bucket, q, repo, drafts, resetFilters } = useUrlState();

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
  return true;
}

function matchesSearchAndRepo(pr: PrView): boolean {
  if (repo.value && pr.repository !== repo.value) {
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
    pr.author.toLowerCase().includes(query)
  );
}

const ownershipFilteredPulls = computed<PrView[]>(() =>
  allPullRequests.value.filter(matchesOwnership),
);

const filteredBasePulls = computed<PrView[]>(() =>
  ownershipFilteredPulls.value.filter(matchesSearchAndRepo),
);

const repoOptions = computed(() => {
  const counts = new Map<string, number>();
  for (const pr of ownershipFilteredPulls.value) {
    counts.set(pr.repository, (counts.get(pr.repository) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
});

const primaryQueuePulls = computed<PrView[]>(() => {
  const base = filteredBasePulls.value;
  if (bucket.value === 'ci-failing') {
    return base.filter((pr) => pr.ci.state === 'failing');
  }
  if (bucket.value) {
    return base.filter((pr) => pr.bucket === bucket.value);
  }
  return base.filter((pr) => {
    if (pr.bucket === 'needs-me' || pr.bucket === 'ready') {
      return true;
    }
    return drafts.value && pr.bucket === 'draft';
  });
});

const waitingPullRequests = computed<PrView[]>(() =>
  filteredBasePulls.value.filter((pr) => pr.bucket === 'waiting'),
);

const draftPullRequests = computed<PrView[]>(() =>
  filteredBasePulls.value.filter((pr) => pr.bucket === 'draft'),
);

const hasActiveFilters = computed<boolean>(() => {
  return (
    view.value !== 'all' ||
    bucket.value !== '' ||
    q.value.trim() !== '' ||
    repo.value !== '' ||
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

function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) {
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
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onGlobalKeydown);
  }
  if (desktopQuery) {
    desktopQuery.removeEventListener('change', updateViewportMode);
  }
});
</script>

<style scoped>
.dashboard-shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.dashboard-main {
  width: 100%;
  max-width: 90rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 2.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(18rem, 1fr);
  align-items: start;
  gap: 1rem;
}

.context-rail {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  min-width: 0;
}

@media (max-width: 1023px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 639px) {
  .dashboard-main {
    padding: 0.75rem 0.875rem 2rem;
  }
}
</style>
