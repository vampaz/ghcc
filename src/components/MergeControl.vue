<template>
  <div
    class="merge-split"
    :class="{ compact, ready: isReadyToMerge, merging: isBusy, disabled: isBlocked }"
    role="group"
    :aria-label="`Merge options for ${pr.key}`"
  >
    <button
      type="button"
      class="merge-main-btn"
      :aria-disabled="isBlocked ? 'true' : undefined"
      :aria-label="mainAriaLabel"
      :title="mainTooltip"
      @click="onMainClick"
    >
      <progress v-if="isBusy" class="loading-spinner" aria-label="Merging pull request"></progress>
      <CarbonIcon v-else :name="isMerged ? 'checkmark' : 'branch'" :size="13" />
      <span>{{ mainLabel }}</span>
    </button>

    <button
      :id="triggerId"
      ref="caretRef"
      type="button"
      class="merge-caret-btn"
      aria-haspopup="menu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :aria-controls="menuId"
      :aria-disabled="isBlocked ? 'true' : undefined"
      :aria-label="`Select merge method for ${pr.key}`"
      title="Select merge method"
      @click="onCaretClick"
      @keydown="onCaretKeydown"
    >
      <CarbonIcon name="chevron-down" :size="14" />
    </button>

    <div
      :id="menuId"
      ref="popoverRef"
      popover="auto"
      class="merge-menu-popover"
      :class="{ 'fallback-open': fallbackOpen }"
      @toggle="onPopoverToggle"
    >
      <div
        ref="menuListRef"
        role="menu"
        class="merge-menu"
        :aria-labelledby="triggerId"
        @keydown="onMenuKeydown"
      >
        <button
          type="button"
          role="menuitemradio"
          class="merge-menu-item"
          :aria-checked="selectedMethod === 'squash' ? 'true' : 'false'"
          @click="selectMethod('squash')"
        >
          <span class="merge-menu-check" aria-hidden="true">
            <CarbonIcon v-if="selectedMethod === 'squash'" name="checkmark" :size="14" />
          </span>
          <span class="merge-menu-copy">
            <span class="merge-menu-title">Squash and merge</span>
            <span class="merge-menu-desc">Combine all commits into one commit on base</span>
          </span>
        </button>

        <button
          type="button"
          role="menuitemradio"
          class="merge-menu-item"
          :aria-checked="selectedMethod === 'merge' ? 'true' : 'false'"
          @click="selectMethod('merge')"
        >
          <span class="merge-menu-check" aria-hidden="true">
            <CarbonIcon v-if="selectedMethod === 'merge'" name="checkmark" :size="14" />
          </span>
          <span class="merge-menu-copy">
            <span class="merge-menu-title">Create a merge commit</span>
            <span class="merge-menu-desc">Add all commits with a regular merge commit</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import { IDLE_PR_MERGE_STATE, type PrMergeState } from '@/composables/use-dashboard-state';
import type { MergeMethod, PrView } from '@/types/pr';
import { isPrReadyToMerge } from '@/utils/ready-to-merge';

interface Props {
  pr: PrView;
  mergeState?: PrMergeState;
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mergeState: () => IDLE_PR_MERGE_STATE,
  compact: false,
});

const emit = defineEmits<{
  'request-merge': [pr: PrView, method: MergeMethod];
}>();

const instanceId = useId();
const triggerId = `merge-trigger-${instanceId}`;
const menuId = `merge-menu-${instanceId}`;

const selectedMethod = ref<MergeMethod>('squash');
const menuOpen = ref<boolean>(false);
const fallbackOpen = ref<boolean>(false);

const caretRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const menuListRef = ref<HTMLDivElement | null>(null);

const isBusy = computed<boolean>(() => props.mergeState.status === 'merging');
const isMerged = computed<boolean>(() => props.mergeState.status === 'merged');
const hasConflicts = computed<boolean>(() => props.pr.merge.state === 'conflicting');
const isBlocked = computed<boolean>(() => isBusy.value || isMerged.value || hasConflicts.value);
const isReadyToMerge = computed<boolean>(() => isPrReadyToMerge(props.pr));

const mainLabel = computed<string>(() => {
  if (isBusy.value) {
    return 'Merging';
  }
  if (isMerged.value) {
    return 'Merged';
  }
  if (props.compact) {
    return selectedMethod.value === 'merge' ? 'Merge' : 'Squash';
  }
  return selectedMethod.value === 'merge' ? 'Create a merge commit' : 'Squash and merge';
});

const mainAriaLabel = computed<string>(() => {
  const action = selectedMethod.value === 'merge' ? 'Merge' : 'Squash';
  const fullAction =
    selectedMethod.value === 'merge' ? 'Create a merge commit' : 'Squash and merge';
  const prefix = props.compact ? action : fullAction;
  return `${prefix} — ${props.pr.key}`;
});

const mainTooltip = computed<string>(() => {
  if (hasConflicts.value) {
    return 'Resolve merge conflicts before merging';
  }
  const methodLabel =
    selectedMethod.value === 'merge' ? 'Create a merge commit' : 'Squash and merge';
  return `${methodLabel} into ${props.pr.baseRefName}`;
});

function supportsNativePopover(el: HTMLElement | null): el is HTMLElement & {
  showPopover: (options?: { source?: HTMLElement }) => void;
  hidePopover: () => void;
} {
  return Boolean(
    el && typeof el.showPopover === 'function' && typeof el.hidePopover === 'function',
  );
}

function positionPopoverFallback(): void {
  const popover = popoverRef.value;
  const trigger = caretRef.value;
  if (!popover || !trigger || typeof window === 'undefined') {
    return;
  }
  const rect = trigger.getBoundingClientRect();
  const menuWidth = popover.offsetWidth || 256;
  const menuHeight = popover.offsetHeight || 112;
  const margin = 8;

  let left = rect.right - menuWidth;
  if (left < margin) {
    left = Math.max(margin, rect.left);
  }
  if (left + menuWidth > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - menuWidth - margin);
  }

  let top = rect.bottom + 4;
  if (top + menuHeight > window.innerHeight - margin && rect.top - menuHeight - 4 >= margin) {
    top = rect.top - menuHeight - 4;
  }

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
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
  detachFallbackListeners();
  if (restoreFocus) {
    caretRef.value?.focus();
  }
}

function openMenu(focusFirst = false): void {
  if (isBlocked.value) {
    return;
  }
  const popover = popoverRef.value;
  const trigger = caretRef.value;
  if (supportsNativePopover(popover)) {
    try {
      popover.showPopover(trigger ? { source: trigger } : undefined);
      positionPopoverFallback();
    } catch {
      fallbackOpen.value = true;
      menuOpen.value = true;
      attachFallbackListeners();
      void nextTick(positionPopoverFallback);
    }
  } else {
    fallbackOpen.value = true;
    menuOpen.value = true;
    attachFallbackListeners();
    void nextTick(positionPopoverFallback);
  }

  if (focusFirst) {
    void nextTick(() => {
      const firstItem =
        menuListRef.value?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
      firstItem?.focus();
    });
  }
}

function onDocumentClickOutside(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (target && (popoverRef.value?.contains(target) || caretRef.value?.contains(target))) {
    return;
  }
  closeMenu(false);
}

function onDocumentKeydownFallback(event: KeyboardEvent): void {
  if (event.key === 'Escape' && fallbackOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
  }
}

function attachFallbackListeners(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.addEventListener('click', onDocumentClickOutside, { capture: true });
  document.addEventListener('keydown', onDocumentKeydownFallback, { capture: true });
}

function detachFallbackListeners(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.removeEventListener('click', onDocumentClickOutside, { capture: true });
  document.removeEventListener('keydown', onDocumentKeydownFallback, { capture: true });
}

function onPopoverToggle(event: Event): void {
  const toggleEvent = event as ToggleEvent;
  const isNowOpen = toggleEvent.newState === 'open';
  menuOpen.value = isNowOpen;
  if (isNowOpen) {
    positionPopoverFallback();
  }
}

function onMainClick(): void {
  if (isBlocked.value) {
    return;
  }
  closeMenu(false);
  emit('request-merge', props.pr, selectedMethod.value);
}

function onCaretClick(): void {
  if (isBlocked.value) {
    return;
  }
  if (menuOpen.value) {
    closeMenu(false);
  } else {
    openMenu(false);
  }
}

function onCaretKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openMenu(true);
  }
}

function onMenuKeydown(event: KeyboardEvent): void {
  const items = Array.from(
    menuListRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
  );
  if (items.length === 0) {
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
    return;
  }
  if (event.key === 'Tab') {
    closeMenu(false);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex = 0;
  if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  } else if (event.key === 'ArrowUp') {
    nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
  } else {
    nextIndex = currentIndex < 0 || currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
  }
  items[nextIndex]?.focus();
}

function selectMethod(method: MergeMethod): void {
  selectedMethod.value = method;
  closeMenu(false);
}

onUnmounted(() => {
  detachFallbackListeners();
});
</script>

<style scoped>
.merge-split {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: stretch;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface-muted);
}

.merge-split.ready {
  border-color: var(--accent-emerald);
  background-color: var(--accent-emerald-bg);
}

.merge-main-btn,
.merge-caret-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.32rem;
  min-block-size: 2rem;
  border: 0;
  background: transparent;
  color: var(--ink-primary);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.merge-split.ready .merge-main-btn,
.merge-split.ready .merge-caret-btn {
  color: var(--accent-emerald);
}

.merge-main-btn {
  padding: 0.25rem 0.58rem;
  border-right: 1px solid var(--border-strong);
  border-radius: 0.3125rem 0 0 0.3125rem;
}

.merge-split.ready .merge-main-btn {
  border-right-color: color-mix(in srgb, var(--accent-emerald) 45%, transparent);
}

.merge-caret-btn {
  min-inline-size: 1.65rem;
  padding: 0.2rem 0.38rem;
  border-radius: 0 0.3125rem 0.3125rem 0;
}

.merge-main-btn:focus-visible,
.merge-caret-btn:focus-visible {
  position: relative;
  z-index: 1;
}

.merge-main-btn:hover:not([aria-disabled='true']),
.merge-caret-btn:hover:not([aria-disabled='true']) {
  background-color: var(--bg-surface-hover);
}

.merge-split.ready .merge-main-btn:hover:not([aria-disabled='true']),
.merge-split.ready .merge-caret-btn:hover:not([aria-disabled='true']) {
  background-color: var(--accent-emerald);
  color: #ffffff;
}

.merge-main-btn[aria-disabled='true'],
.merge-caret-btn[aria-disabled='true'] {
  cursor: default;
  opacity: 0.55;
}

.merge-main-btn :deep(progress.loading-spinner) {
  --size: 0.75rem;
}

.merge-menu-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0.3rem;
  min-inline-size: 16rem;
  max-inline-size: min(19rem, calc(100vw - 1rem));
  border-radius: 0.5rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.28);
  z-index: 60;
}

.merge-menu-popover:not(:popover-open):not(.fallback-open) {
  display: none;
}

.merge-menu {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.merge-menu-item {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.merge-menu-item:hover,
.merge-menu-item:focus-visible {
  background-color: var(--bg-surface-hover);
}

.merge-menu-check {
  flex: 0 0 1rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--accent-emerald);
  line-height: 1.3;
}

.merge-menu-copy {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
}

.merge-menu-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ink-primary);
}

.merge-menu-desc {
  font-size: 0.72rem;
  color: var(--ink-secondary);
  line-height: 1.3;
}
</style>
