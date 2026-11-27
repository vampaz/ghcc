<template>
  <aside
    v-if="mode === 'dialog'"
    class="inspector-dialog"
    :class="{ open: isOpen }"
    :inert="!isOpen"
    aria-labelledby="inspector-title"
  >
    <div class="drawer-header">
      <div class="drawer-title-group">
        <span v-if="activePr" class="drawer-key mono-num">{{ activePr.key }}</span>
        <h2 id="inspector-title" class="drawer-title">
          {{ activePr?.title ?? 'Pull Request Inspector' }}
        </h2>
      </div>

      <div class="drawer-actions">
        <a
          v-if="activePr"
          :href="activePr.url"
          target="_blank"
          rel="noopener noreferrer"
          class="drawer-btn"
        >
          <span>GitHub</span>
          <CarbonIcon name="launch" :size="14" />
        </a>
        <button type="button" class="drawer-btn" @click="$emit('close')">
          <CarbonIcon name="close" :size="14" />
          <span>Close</span>
        </button>
      </div>
    </div>

    <div class="drawer-scroll app-scroll">
      <PrInspectorBody
        :pr="activePr"
        :inspector="activeInspector"
        :now-ms="nowMs"
        :viewer-login="viewerLogin"
        :resolved-theme="resolvedTheme"
        :sync-state="syncState"
        :draft-state="draftState"
        :merge-state="mergeState"
        :repo-labels-state="repoLabelsState"
        :label-state="labelState"
        :rerun-state="rerunState"
        :check-summary-states="checkSummaryStates"
        :triage-state="triageState"
        :review-submit-state="reviewSubmitState"
        :thread-action-states="threadActionStates"
        :repo-reviewers-state="repoReviewersState"
        :pr-reviewers-state="prReviewersState"
        @retry="$emit('retry', $event)"
        @sync="$emit('sync', $event)"
        @rerun-checks="(target, options) => $emit('rerun-checks', target, options)"
        @load-check-summary="
          (target, checkRunId, options) => $emit('load-check-summary', target, checkRunId, options)
        "
        @toggle-pin="$emit('toggle-pin', $event)"
        @snooze="(target, condition) => $emit('snooze', target, condition)"
        @unsnooze="$emit('unsnooze', $event)"
        @submit-review="(target, event, body) => $emit('submit-review', target, event, body)"
        @reply-thread="(target, threadId, body) => $emit('reply-thread', target, threadId, body)"
        @resolve-thread="
          (target, threadId, resolved) => $emit('resolve-thread', target, threadId, resolved)
        "
        @load-reviewers="$emit('load-reviewers', $event)"
        @retry-load-reviewers="$emit('retry-load-reviewers', $event)"
        @update-reviewers="(target, changes) => $emit('update-reviewers', target, changes)"
        @toggle-draft="(target, nextDraft) => $emit('toggle-draft', target, nextDraft)"
        @request-merge="(target, method) => $emit('request-merge', target, method)"
        @load-labels="$emit('load-labels', $event)"
        @retry-load-labels="$emit('retry-load-labels', $event)"
        @update-labels="(target, labels) => $emit('update-labels', target, labels)"
        @open-mermaid="$emit('open-mermaid', $event)"
      />
    </div>
  </aside>

  <section
    v-else-if="inspector.status !== 'closed' && pr"
    ref="inlineRef"
    class="inspector-inline"
    aria-labelledby="inspector-inline-title"
  >
    <div class="inline-header">
      <h2 id="inspector-inline-title" ref="inlineTitleRef" class="inline-title" tabindex="-1">
        Pull Request Details
      </h2>
      <button type="button" class="drawer-btn" @click="$emit('close')">
        <CarbonIcon name="close" :size="14" />
        <span>Close</span>
      </button>
    </div>
    <PrInspectorBody
      :pr="pr"
      :inspector="inspector"
      :now-ms="nowMs"
      :viewer-login="viewerLogin"
      :resolved-theme="resolvedTheme"
      :sync-state="syncState"
      :draft-state="draftState"
      :merge-state="mergeState"
      :repo-labels-state="repoLabelsState"
      :label-state="labelState"
      :rerun-state="rerunState"
      :check-summary-states="checkSummaryStates"
      :triage-state="triageState"
      :review-submit-state="reviewSubmitState"
      :thread-action-states="threadActionStates"
      :repo-reviewers-state="repoReviewersState"
      :pr-reviewers-state="prReviewersState"
      @retry="$emit('retry', $event)"
      @sync="$emit('sync', $event)"
      @rerun-checks="(target, options) => $emit('rerun-checks', target, options)"
      @load-check-summary="
        (target, checkRunId, options) => $emit('load-check-summary', target, checkRunId, options)
      "
      @toggle-pin="$emit('toggle-pin', $event)"
      @snooze="(target, condition) => $emit('snooze', target, condition)"
      @unsnooze="$emit('unsnooze', $event)"
      @submit-review="(target, event, body) => $emit('submit-review', target, event, body)"
      @reply-thread="(target, threadId, body) => $emit('reply-thread', target, threadId, body)"
      @resolve-thread="
        (target, threadId, resolved) => $emit('resolve-thread', target, threadId, resolved)
      "
      @load-reviewers="$emit('load-reviewers', $event)"
      @retry-load-reviewers="$emit('retry-load-reviewers', $event)"
      @update-reviewers="(target, changes) => $emit('update-reviewers', target, changes)"
      @toggle-draft="(target, nextDraft) => $emit('toggle-draft', target, nextDraft)"
      @request-merge="(target, method) => $emit('request-merge', target, method)"
      @load-labels="$emit('load-labels', $event)"
      @retry-load-labels="$emit('retry-load-labels', $event)"
      @update-labels="(target, labels) => $emit('update-labels', target, labels)"
      @open-mermaid="$emit('open-mermaid', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import PrInspectorBody from '@/components/PrInspectorBody.vue';
import {
  IDLE_PR_DRAFT_STATE,
  IDLE_PR_LABELS_STATE,
  IDLE_PR_MERGE_STATE,
  IDLE_PR_RERUN_STATE,
  IDLE_PR_REVIEW_SUBMIT_STATE,
  IDLE_PR_REVIEWERS_STATE,
  IDLE_PR_SYNC_STATE,
  IDLE_PR_TRIAGE_STATE,
  IDLE_REPO_LABELS_STATE,
  IDLE_REPO_REVIEWERS_STATE,
  type CheckSummaryState,
  type InspectorState,
  type PrDraftState,
  type PrLabelsState,
  type PrMergeState,
  type PrRerunState,
  type PrReviewersState,
  type PrReviewSubmitState,
  type PrSyncState,
  type PrTriageState,
  type RepoLabelsState,
  type RepoReviewersState,
  type ThreadActionState,
} from '@/composables/use-dashboard-state';
import type { ResolvedTheme } from '@/composables/use-theme';
import type { MergeMethod, PrView, ReviewEvent, SnoozeCondition } from '@/types/pr';

interface Props {
  mode: 'dialog' | 'inline';
  pr: PrView | null;
  inspector: InspectorState;
  nowMs: number;
  viewerLogin?: string;
  resolvedTheme?: ResolvedTheme;
  syncState?: PrSyncState;
  draftState?: PrDraftState;
  mergeState?: PrMergeState;
  repoLabelsState?: RepoLabelsState;
  labelState?: PrLabelsState;
  rerunState?: PrRerunState;
  checkSummaryStates?: Record<string, CheckSummaryState>;
  triageState?: PrTriageState;
  reviewSubmitState?: PrReviewSubmitState;
  threadActionStates?: Record<string, ThreadActionState>;
  repoReviewersState?: RepoReviewersState;
  prReviewersState?: PrReviewersState;
}

const props = withDefaults(defineProps<Props>(), {
  viewerLogin: '',
  resolvedTheme: 'dark',
  syncState: () => IDLE_PR_SYNC_STATE,
  draftState: () => IDLE_PR_DRAFT_STATE,
  mergeState: () => IDLE_PR_MERGE_STATE,
  repoLabelsState: () => IDLE_REPO_LABELS_STATE,
  labelState: () => IDLE_PR_LABELS_STATE,
  rerunState: () => IDLE_PR_RERUN_STATE,
  checkSummaryStates: () => ({}),
  triageState: () => IDLE_PR_TRIAGE_STATE,
  reviewSubmitState: () => IDLE_PR_REVIEW_SUBMIT_STATE,
  threadActionStates: () => ({}),
  repoReviewersState: () => IDLE_REPO_REVIEWERS_STATE,
  prReviewersState: () => IDLE_PR_REVIEWERS_STATE,
});

defineEmits<{
  close: [];
  retry: [pr: PrView];
  sync: [pr: PrView];
  'rerun-checks': [pr: PrView, options?: { jobId?: number; runId?: number }];
  'load-check-summary': [
    pr: PrView,
    checkRunId: number,
    options?: { isActionsJob?: boolean; force?: boolean },
  ];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
  'request-merge': [pr: PrView, method: MergeMethod];
  'load-labels': [pr: PrView];
  'retry-load-labels': [pr: PrView];
  'update-labels': [pr: PrView, labels: string[]];
  'toggle-pin': [pr: PrView];
  snooze: [pr: PrView, condition: SnoozeCondition];
  unsnooze: [pr: PrView];
  'submit-review': [pr: PrView, event: ReviewEvent, body?: string];
  'reply-thread': [pr: PrView, threadId: string, body: string];
  'resolve-thread': [pr: PrView, threadId: string, resolved: boolean];
  'load-reviewers': [pr: PrView];
  'retry-load-reviewers': [pr: PrView];
  'update-reviewers': [
    pr: PrView,
    changes: {
      addUsers?: string[];
      removeUsers?: string[];
      addTeams?: string[];
      removeTeams?: string[];
    },
  ];
  'open-mermaid': [source: string];
}>();

const lastOpenPr = ref<PrView | null>(props.pr);
const lastOpenInspector = ref<InspectorState>(props.inspector);
const inlineRef = ref<HTMLElement | null>(null);
const inlineTitleRef = ref<HTMLHeadingElement | null>(null);

watch(
  () => [props.pr, props.inspector] as const,
  ([nextPr, nextInspector]) => {
    if (nextInspector.status !== 'closed') {
      lastOpenInspector.value = nextInspector;
      if (nextPr) {
        lastOpenPr.value = nextPr;
      }
    }
  },
  { immediate: true },
);

const inlineFocusKey = computed<string | null>(() => {
  if (props.mode !== 'inline' || props.inspector.status === 'closed' || !props.pr) {
    return null;
  }
  return props.inspector.key;
});

function focusAndScrollInline(): void {
  if (!inlineFocusKey.value || typeof window === 'undefined') {
    return;
  }
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  inlineTitleRef.value?.focus({ preventScroll: true });
  if (typeof inlineRef.value?.scrollIntoView === 'function') {
    inlineRef.value.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }
}

onMounted(() => {
  focusAndScrollInline();
});

watch(
  inlineFocusKey,
  (nextKey) => {
    if (nextKey) {
      focusAndScrollInline();
    }
  },
  { flush: 'post' },
);

const isOpen = computed<boolean>(() => props.inspector.status !== 'closed');
const activePr = computed<PrView | null>(() => props.pr ?? lastOpenPr.value);
const activeInspector = computed<InspectorState>(() =>
  props.inspector.status !== 'closed' ? props.inspector : lastOpenInspector.value,
);
</script>

<style scoped>
.inspector-dialog {
  position: fixed;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  inline-size: min(32rem, 100%);
  max-inline-size: 100%;
  block-size: 100dvh;
  border-left: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: -8px 0 28px rgb(0 0 0 / 0.24);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 160ms cubic-bezier(0.22, 1, 0.36, 1),
    translate 160ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 160ms;
}

@media (prefers-reduced-motion: no-preference) {
  .inspector-dialog {
    translate: 100% 0;
  }
}

.inspector-dialog.open {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    opacity 160ms cubic-bezier(0.22, 1, 0.36, 1),
    translate 160ms cubic-bezier(0.22, 1, 0.36, 1),
    visibility 0s linear 0s;
}

@media (prefers-reduced-motion: no-preference) {
  .inspector-dialog.open {
    translate: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .inspector-dialog,
  .inspector-dialog.open {
    transition-duration: 80ms, 80ms, 0s;
  }

  .inspector-dialog {
    transition-delay: 0s, 0s, 80ms;
  }
}

.drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
}

.drawer-title-group {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.drawer-key {
  font-size: 0.78rem;
  color: var(--ink-secondary);
}

.drawer-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.drawer-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.drawer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 2rem;
  padding: 0.25rem 0.65rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface-muted);
  color: var(--ink-primary);
  font-size: 0.8rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.drawer-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 1rem 1.25rem 1.5rem;
}

.inspector-inline {
  padding: 0.875rem;
  border-top: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-hover);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.inline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.inline-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-secondary);
}
</style>
