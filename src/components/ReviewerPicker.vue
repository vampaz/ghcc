<template>
  <div class="reviewer-picker">
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="reviewer-picker-trigger"
      :class="{ active: menuOpen, saving: isSaving }"
      aria-haspopup="menu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :aria-controls="popoverId"
      :aria-label="`Edit reviewers — ${pr.key}`"
      @pointerdown="onTriggerPointerDown"
      @click="onTriggerClick"
    >
      <progress v-if="isSaving" class="loading-spinner" aria-label="Updating reviewers"></progress>
      <span>Edit reviewers</span>
      <CarbonIcon name="chevron-down" :size="12" />
    </button>

    <div
      :id="popoverId"
      ref="popoverRef"
      popover="auto"
      class="reviewer-picker-popover"
      :class="{ 'fallback-open': fallbackOpen }"
      @toggle="onPopoverToggle"
      @keydown.esc.stop.prevent="closeMenu(true)"
    >
      <div class="picker-head">
        <span class="picker-title">Request reviewers</span>
        <button
          type="button"
          class="picker-close-btn"
          aria-label="Close reviewer picker"
          @click="closeMenu(true)"
        >
          <CarbonIcon name="close" :size="14" />
        </button>
      </div>

      <div class="picker-search-wrap">
        <label :for="filterInputId" class="visually-hidden">Filter reviewers</label>
        <input
          :id="filterInputId"
          ref="filterInputRef"
          v-model="filterQuery"
          type="search"
          class="picker-search"
          placeholder="Filter collaborators"
          autocomplete="off"
        />
      </div>

      <p v-if="prReviewersState.status === 'error'" class="picker-error" role="alert">
        {{ prReviewersState.error }}
      </p>

      <div class="picker-body app-scroll">
        <div v-if="repoReviewersState.status === 'loading'" class="picker-empty">
          Loading assignable reviewers...
        </div>

        <div
          v-else-if="repoReviewersState.status === 'error'"
          class="picker-error-box"
          role="alert"
        >
          <span>{{ repoReviewersState.error }}</span>
          <button type="button" class="picker-retry-btn" @click="$emit('retry-load', pr)">
            Retry
          </button>
        </div>

        <div v-else-if="filteredOptions.length === 0" class="picker-empty">
          {{
            filterQuery.trim()
              ? `No reviewers match "${filterQuery.trim()}".`
              : 'No assignable reviewers found.'
          }}
        </div>

        <div v-else role="menu" :aria-labelledby="triggerId" class="picker-list">
          <button
            v-for="option in filteredOptions"
            :key="option.login"
            type="button"
            role="menuitemcheckbox"
            class="picker-item"
            :class="{ selected: isPendingRequested(option.login) }"
            :aria-checked="isPendingRequested(option.login) ? 'true' : 'false'"
            :aria-disabled="isSaving ? 'true' : undefined"
            @click="onToggleReviewer(option.login)"
          >
            <span class="picker-check" aria-hidden="true">
              <CarbonIcon v-if="isPendingRequested(option.login)" name="checkmark" :size="14" />
            </span>
            <span class="picker-item-copy">
              <span class="picker-item-name">@{{ option.login }}</span>
              <span v-if="option.name" class="picker-item-desc">{{ option.name }}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import {
  IDLE_PR_REVIEWERS_STATE,
  IDLE_REPO_REVIEWERS_STATE,
  type PrReviewersState,
  type RepoReviewersState,
} from '@/composables/use-dashboard-state';
import type { PrReviewerDetail, PrView, RepoReviewerOption } from '@/types/pr';

interface Props {
  pr: PrView;
  currentReviewers: PrReviewerDetail[];
  repoReviewersState?: RepoReviewersState;
  prReviewersState?: PrReviewersState;
}

const props = withDefaults(defineProps<Props>(), {
  repoReviewersState: () => IDLE_REPO_REVIEWERS_STATE,
  prReviewersState: () => IDLE_PR_REVIEWERS_STATE,
});

const emit = defineEmits<{
  'load-reviewers': [pr: PrView];
  'retry-load': [pr: PrView];
  'update-reviewers': [
    pr: PrView,
    changes: {
      addUsers?: string[];
      removeUsers?: string[];
      addTeams?: string[];
      removeTeams?: string[];
    },
  ];
}>();

const uid = useId();
const triggerId = `reviewer-trigger-${uid}`;
const popoverId = `reviewer-popover-${uid}`;
const filterInputId = `reviewer-filter-${uid}`;

const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const filterInputRef = ref<HTMLInputElement | null>(null);
const menuOpen = ref<boolean>(false);
const fallbackOpen = ref<boolean>(false);
const filterQuery = ref<string>('');
let wasOpenOnPointerDown = false;

const isSaving = computed<boolean>(() => props.prReviewersState.status === 'saving');

const pendingUserLogins = computed<Set<string>>(() => {
  const set = new Set<string>();
  for (const rev of props.currentReviewers) {
    if (rev.kind === 'user' && rev.state === 'PENDING') {
      set.add(rev.login.toLowerCase());
    }
  }
  return set;
});

function isPendingRequested(login: string): boolean {
  return pendingUserLogins.value.has(login.toLowerCase());
}

const availableOptions = computed<RepoReviewerOption[]>(() => {
  if (props.repoReviewersState.status !== 'ready') {
    return [];
  }
  const authorLower = props.pr.author.toLowerCase();
  return props.repoReviewersState.reviewers.filter(
    (opt) => opt.login.toLowerCase() !== authorLower,
  );
});

const filteredOptions = computed<RepoReviewerOption[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) {
    return availableOptions.value;
  }
  return availableOptions.value.filter(
    (opt) => opt.login.toLowerCase().includes(q) || (opt.name?.toLowerCase().includes(q) ?? false),
  );
});

function supportsNativePopover(el: HTMLElement | null): el is HTMLElement & {
  showPopover: (options?: { source?: HTMLElement }) => void;
  hidePopover: () => void;
} {
  return Boolean(
    el && typeof el.showPopover === 'function' && typeof el.hidePopover === 'function',
  );
}

function positionPopover(): void {
  const popover = popoverRef.value;
  const trigger = triggerRef.value;
  if (!popover || !trigger || typeof window === 'undefined') {
    return;
  }
  const rect = trigger.getBoundingClientRect();
  const width = popover.offsetWidth || 280;
  const height = popover.offsetHeight || 280;
  const margin = 8;

  let left = rect.right - width;
  if (left < margin) {
    left = Math.max(margin, rect.left);
  }
  if (left + width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - width - margin);
  }

  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - margin && rect.top - height - 4 >= margin) {
    top = rect.top - height - 4;
  } else if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - height - margin);
  }

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function onDocumentClickOutside(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (target && (popoverRef.value?.contains(target) || triggerRef.value?.contains(target))) {
    return;
  }
  closeMenu(false);
}

function detachListeners(): void {
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', onDocumentClickOutside, { capture: true });
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', positionPopover);
  }
}

function closeMenu(restoreFocus = false): void {
  const popover = popoverRef.value;
  if (supportsNativePopover(popover)) {
    try {
      popover.hidePopover();
    } catch {
      // Already closed
    }
  }
  fallbackOpen.value = false;
  menuOpen.value = false;
  filterQuery.value = '';
  detachListeners();
  if (restoreFocus) {
    triggerRef.value?.focus();
  }
}

function openMenu(): void {
  emit('load-reviewers', props.pr);
  const popover = popoverRef.value;
  const trigger = triggerRef.value;
  if (supportsNativePopover(popover)) {
    try {
      popover.showPopover(trigger ? { source: trigger } : undefined);
      menuOpen.value = true;
      fallbackOpen.value = false;
    } catch {
      fallbackOpen.value = true;
      menuOpen.value = true;
      document.addEventListener('click', onDocumentClickOutside, { capture: true });
    }
  } else {
    fallbackOpen.value = true;
    menuOpen.value = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('click', onDocumentClickOutside, { capture: true });
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', positionPopover);
  }
  void nextTick(() => {
    positionPopover();
    filterInputRef.value?.focus();
  });
}

function onTriggerPointerDown(): void {
  wasOpenOnPointerDown = menuOpen.value;
}

function onTriggerClick(): void {
  if (wasOpenOnPointerDown) {
    wasOpenOnPointerDown = false;
    closeMenu(false);
    return;
  }
  if (menuOpen.value) {
    closeMenu(false);
  } else {
    openMenu();
  }
}

function onPopoverToggle(event: Event): void {
  const toggleEvent = event as ToggleEvent;
  if (toggleEvent.newState === 'open') {
    menuOpen.value = true;
    void nextTick(() => {
      positionPopover();
      filterInputRef.value?.focus();
    });
  } else {
    menuOpen.value = false;
    fallbackOpen.value = false;
    filterQuery.value = '';
    detachListeners();
  }
}

function onToggleReviewer(login: string): void {
  if (isSaving.value) {
    return;
  }
  if (isPendingRequested(login)) {
    emit('update-reviewers', props.pr, { removeUsers: [login] });
  } else {
    emit('update-reviewers', props.pr, { addUsers: [login] });
  }
}

onUnmounted(() => {
  detachListeners();
});
</script>

<style scoped>
.reviewer-picker {
  position: relative;
  display: inline-flex;
}

.reviewer-picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
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

.reviewer-picker-trigger:hover,
.reviewer-picker-trigger.active {
  border-color: var(--border-strong);
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.reviewer-picker-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  inline-size: min(17.5rem, calc(100vw - 1rem));
  border-radius: 0.5rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: 0 12px 28px rgb(0 0 0 / 0.28);
  z-index: 60;
}

.reviewer-picker-popover:not(:popover-open):not(.fallback-open) {
  display: none;
}

.reviewer-picker-popover.fallback-open {
  display: block;
}

.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
}

.picker-title {
  font-size: 0.76rem;
  font-weight: 700;
}

.picker-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 1.5rem;
  block-size: 1.5rem;
  padding: 0;
  border: 0;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--ink-secondary);
  cursor: pointer;
}

.picker-search-wrap {
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid var(--border-subtle);
}

.picker-search {
  width: 100%;
  min-block-size: 1.85rem;
  padding: 0.2rem 0.5rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface-muted);
  color: var(--ink-primary);
  font-size: 0.78rem;
}

.picker-error,
.picker-error-box {
  margin: 0.45rem 0.55rem;
  padding: 0.4rem 0.55rem;
  border-radius: 0.35rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.74rem;
}

.picker-error-box {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: flex-start;
}

.picker-retry-btn {
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.72rem;
  cursor: pointer;
}

.picker-body {
  max-block-size: 14rem;
  overflow-y: auto;
  padding: 0.3rem;
}

.picker-empty {
  padding: 0.75rem;
  font-size: 0.76rem;
  color: var(--ink-muted);
  text-align: center;
}

.picker-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: var(--ink-primary);
  text-align: left;
  cursor: pointer;
}

.picker-item:hover:not([aria-disabled='true']) {
  background-color: var(--bg-surface-hover);
}

.picker-check {
  flex: 0 0 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-blue);
}

.picker-item-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.picker-item-name {
  font-size: 0.78rem;
  font-weight: 600;
}

.picker-item-desc {
  font-size: 0.7rem;
  color: var(--ink-secondary);
}
</style>
