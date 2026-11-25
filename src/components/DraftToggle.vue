<template>
  <div
    class="draft-toggle"
    :class="{ compact, updating: isBusy }"
    role="group"
    :aria-label="`Draft status for ${prKey}`"
  >
    <button
      type="button"
      class="draft-toggle-btn"
      :class="{ active: !activeDraft, 'active-ready': !activeDraft }"
      :aria-pressed="!activeDraft"
      :aria-disabled="isBusy ? 'true' : undefined"
      :aria-label="`Ready — ${prKey}`"
      :title="
        activeDraft ? 'Mark pull request ready for review' : 'Pull request is ready for review'
      "
      @click="onSelect(false)"
    >
      <progress
        v-if="isBusy && !activeDraft"
        class="loading-spinner"
        aria-label="Marking ready for review"
      ></progress>
      <span>Ready</span>
    </button>
    <button
      type="button"
      class="draft-toggle-btn"
      :class="{ active: activeDraft, 'active-draft': activeDraft }"
      :aria-pressed="activeDraft"
      :aria-disabled="isBusy ? 'true' : undefined"
      :aria-label="`Draft — ${prKey}`"
      :title="activeDraft ? 'Pull request is a draft' : 'Convert pull request to draft'"
      @click="onSelect(true)"
    >
      <progress
        v-if="isBusy && activeDraft"
        class="loading-spinner"
        aria-label="Converting to draft"
      ></progress>
      <span>Draft</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IDLE_PR_DRAFT_STATE, type PrDraftState } from '@/composables/use-dashboard-state';

interface Props {
  prKey: string;
  isDraft: boolean;
  draftState?: PrDraftState;
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  draftState: () => IDLE_PR_DRAFT_STATE,
  compact: false,
});

const emit = defineEmits<{
  toggle: [nextDraft: boolean];
}>();

const isBusy = computed<boolean>(() => props.draftState.status === 'updating');

const activeDraft = computed<boolean>(() =>
  props.draftState.status === 'updating' ? props.draftState.targetDraft : props.isDraft,
);

function onSelect(targetDraft: boolean): void {
  if (isBusy.value || targetDraft === props.isDraft) {
    return;
  }
  emit('toggle', targetDraft);
}
</script>

<style scoped>
.draft-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: stretch;
  border-radius: 0.375rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.draft-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  min-block-size: 2rem;
  min-inline-size: 2.75rem;
  padding: 0.2rem 0.48rem;
  border: 0;
  border-right: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.draft-toggle-btn:first-child {
  border-radius: 0.3125rem 0 0 0.3125rem;
}

.draft-toggle-btn:last-child {
  border-right: 0;
  border-radius: 0 0.3125rem 0.3125rem 0;
}

.draft-toggle-btn:focus-visible {
  position: relative;
  z-index: 1;
}

.draft-toggle.compact .draft-toggle-btn {
  min-block-size: 1.85rem;
  min-inline-size: 2.5rem;
  padding: 0.15rem 0.4rem;
  font-size: 0.7rem;
}

.draft-toggle-btn:hover:not(.active):not([aria-disabled='true']) {
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.draft-toggle-btn.active {
  cursor: default;
}

.draft-toggle-btn.active-ready {
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
}

.draft-toggle-btn.active-draft {
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}

.draft-toggle-btn[aria-disabled='true'] {
  cursor: default;
  opacity: 0.85;
}

.draft-toggle-btn :deep(progress.loading-spinner) {
  --size: 0.72rem;
}
</style>
