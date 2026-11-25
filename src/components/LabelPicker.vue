<template>
  <div class="label-picker">
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="label-picker-trigger"
      :class="{ compact, active: menuOpen, saving: isSaving }"
      aria-haspopup="menu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :aria-controls="popoverId"
      :aria-label="`Labels — ${pr.key}`"
      title="Apply labels to this pull request"
      @pointerdown="onTriggerPointerDown"
      @click="onTriggerClick"
    >
      <progress v-if="isSaving" class="loading-spinner" aria-label="Updating labels"></progress>
      <CarbonIcon v-else name="tag" :size="13" />
      <span v-if="!compact">Labels</span>
      <CarbonIcon name="chevron-down" :size="12" />
    </button>

    <div
      :id="popoverId"
      ref="popoverRef"
      popover="auto"
      class="label-picker-popover"
      :class="{ 'fallback-open': fallbackOpen }"
      @toggle="onPopoverToggle"
      @keydown.esc.stop.prevent="closeMenu(true)"
    >
      <div class="picker-head">
        <span class="picker-title">Apply labels to this pull request</span>
        <div class="picker-head-right">
          <progress v-if="isSaving" class="loading-spinner" aria-label="Saving labels"></progress>
          <button
            type="button"
            class="picker-close-btn"
            aria-label="Close label picker"
            @click="closeMenu(true)"
          >
            <CarbonIcon name="close" :size="14" />
          </button>
        </div>
      </div>

      <div class="picker-search-wrap">
        <label :for="filterInputId" class="visually-hidden">Filter labels</label>
        <input
          :id="filterInputId"
          ref="filterInputRef"
          v-model="filterQuery"
          type="search"
          class="picker-search"
          placeholder="Filter labels"
          autocomplete="off"
        />
      </div>

      <div v-if="activeLabels.length > 0" class="picker-active" aria-label="Active labels">
        <div class="picker-active-head">
          <span class="picker-active-title">Active labels</span>
          <span class="picker-active-count mono-num">{{ activeLabels.length }}</span>
        </div>
        <div class="picker-active-list">
          <button
            v-for="label in activeLabels"
            :key="label.name"
            type="button"
            class="pr-label-pill picker-active-pill"
            :style="{ '--label-color': `#${label.color}` }"
            :aria-disabled="isSaving ? 'true' : undefined"
            :aria-label="`Remove label ${label.name}`"
            :title="
              label.description ? `${label.description} (click to remove)` : 'Click to remove'
            "
            @click="onToggleLabel(label.name)"
          >
            <span class="pr-label-dot" aria-hidden="true"></span>
            <span class="picker-active-name">{{ label.name }}</span>
            <CarbonIcon name="close" :size="11" />
          </button>
        </div>
      </div>

      <p v-if="labelState.status === 'error'" class="picker-error" role="alert">
        {{ labelState.error }}
      </p>

      <div class="picker-body app-scroll">
        <div v-if="repoLabelsState.status === 'loading'" class="picker-empty">
          Loading repository labels...
        </div>

        <div v-else-if="repoLabelsState.status === 'error'" class="picker-error-box" role="alert">
          <span>{{ repoLabelsState.error }}</span>
          <button type="button" class="picker-retry-btn" @click="$emit('retry-load', pr)">
            Retry
          </button>
        </div>

        <div v-else-if="filteredLabels.length === 0" class="picker-empty">
          {{
            filterQuery.trim()
              ? `No labels match "${filterQuery.trim()}".`
              : 'No labels found in this repository.'
          }}
        </div>

        <div v-else role="menu" :aria-labelledby="triggerId" class="picker-list">
          <button
            v-for="label in filteredLabels"
            :key="label.name"
            type="button"
            role="menuitemcheckbox"
            class="picker-item"
            :class="{ selected: isLabelActive(label.name) }"
            :aria-checked="isLabelActive(label.name) ? 'true' : 'false'"
            :aria-disabled="isSaving ? 'true' : undefined"
            @click="onToggleLabel(label.name)"
          >
            <span class="picker-check" aria-hidden="true">
              <CarbonIcon v-if="isLabelActive(label.name)" name="checkmark" :size="14" />
            </span>
            <span
              class="picker-swatch"
              :style="{ backgroundColor: `#${label.color}` }"
              aria-hidden="true"
            ></span>
            <span class="picker-item-copy">
              <span class="picker-item-name">{{ label.name }}</span>
              <span v-if="label.description" class="picker-item-desc">
                {{ label.description }}
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import {
  IDLE_PR_LABELS_STATE,
  IDLE_REPO_LABELS_STATE,
  type PrLabelsState,
  type RepoLabelsState,
} from '@/composables/use-dashboard-state';
import type { PrLabel, PrView } from '@/types/pr';

interface Props {
  pr: PrView;
  repoLabelsState?: RepoLabelsState;
  labelState?: PrLabelsState;
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  repoLabelsState: () => IDLE_REPO_LABELS_STATE,
  labelState: () => IDLE_PR_LABELS_STATE,
  compact: false,
});

const emit = defineEmits<{
  'load-labels': [pr: PrView];
  'retry-load': [pr: PrView];
  'update-labels': [pr: PrView, labels: string[]];
}>();

const instanceId = useId();
const triggerId = `label-trigger-${instanceId}`;
const popoverId = `label-popover-${instanceId}`;
const filterInputId = `label-filter-${instanceId}`;

const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const filterInputRef = ref<HTMLInputElement | null>(null);

const menuOpen = ref<boolean>(false);
const fallbackOpen = ref<boolean>(false);
const filterQuery = ref<string>('');
let suppressNextOpen = false;

const isSaving = computed<boolean>(() => props.labelState.status === 'saving');

const activeLabelNames = computed<Set<string>>(() => {
  if (props.labelState.status === 'saving') {
    return new Set(props.labelState.pendingLabels.map((n) => n.toLowerCase()));
  }
  return new Set(props.pr.labels.map((l) => l.name.toLowerCase()));
});

function isLabelActive(name: string): boolean {
  return activeLabelNames.value.has(name.toLowerCase());
}

const activeLabels = computed<PrLabel[]>(() => {
  const byLower = new Map<string, PrLabel>();
  if (props.repoLabelsState.status === 'ready') {
    for (const label of props.repoLabelsState.labels) {
      byLower.set(label.name.toLowerCase(), label);
    }
  }
  for (const label of props.pr.labels) {
    byLower.set(label.name.toLowerCase(), label);
  }

  if (props.labelState.status === 'saving') {
    return props.labelState.pendingLabels.map((name) => {
      const existing = byLower.get(name.toLowerCase());
      return existing ?? { name, color: '64748b', description: null };
    });
  }
  return props.pr.labels;
});

const availableLabels = computed<PrLabel[]>(() => {
  const fromRepo = props.repoLabelsState.status === 'ready' ? props.repoLabelsState.labels : [];
  const byLower = new Map<string, PrLabel>();
  for (const label of fromRepo) {
    byLower.set(label.name.toLowerCase(), label);
  }
  for (const label of props.pr.labels) {
    const key = label.name.toLowerCase();
    if (!byLower.has(key)) {
      byLower.set(key, label);
    }
  }
  return Array.from(byLower.values()).sort((a, b) => {
    const aActive = isLabelActive(a.name);
    const bActive = isLabelActive(b.name);
    if (aActive !== bActive) {
      return aActive ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
});

const filteredLabels = computed<PrLabel[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) {
    return availableLabels.value;
  }
  return availableLabels.value.filter(
    (label) =>
      label.name.toLowerCase().includes(q) ||
      (label.description?.toLowerCase().includes(q) ?? false),
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
  const width = popover.offsetWidth || 296;
  const height = popover.offsetHeight || 300;
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

function attachFallbackListeners(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.addEventListener('click', onDocumentClickOutside, { capture: true });
}

function detachFallbackListeners(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.removeEventListener('click', onDocumentClickOutside, { capture: true });
}

function onWindowResize(): void {
  if (menuOpen.value) {
    positionPopover();
  }
}

function attachResizeListener(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.addEventListener('resize', onWindowResize);
}

function detachResizeListener(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.removeEventListener('resize', onWindowResize);
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
  detachFallbackListeners();
  detachResizeListener();
  if (restoreFocus) {
    triggerRef.value?.focus();
  }
}

function openMenu(): void {
  emit('load-labels', props.pr);
  const popover = popoverRef.value;
  const trigger = triggerRef.value;
  if (supportsNativePopover(popover)) {
    try {
      popover.showPopover(trigger ? { source: trigger } : undefined);
      positionPopover();
      attachResizeListener();
    } catch {
      fallbackOpen.value = true;
      menuOpen.value = true;
      attachFallbackListeners();
      attachResizeListener();
      void nextTick(positionPopover);
    }
  } else {
    fallbackOpen.value = true;
    menuOpen.value = true;
    attachFallbackListeners();
    attachResizeListener();
    void nextTick(positionPopover);
  }
  void nextTick(() => {
    filterInputRef.value?.focus();
  });
}

function onTriggerPointerDown(): void {
  if (menuOpen.value && supportsNativePopover(popoverRef.value) && typeof window !== 'undefined') {
    suppressNextOpen = true;
    window.addEventListener(
      'pointerup',
      () => {
        window.setTimeout(() => {
          suppressNextOpen = false;
        }, 0);
      },
      { once: true },
    );
  }
}

function onTriggerClick(): void {
  if (suppressNextOpen) {
    suppressNextOpen = false;
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
  const isNowOpen = toggleEvent.newState === 'open';
  menuOpen.value = isNowOpen;
  if (isNowOpen) {
    positionPopover();
    attachResizeListener();
    void nextTick(() => {
      filterInputRef.value?.focus();
    });
  } else {
    filterQuery.value = '';
    detachResizeListener();
  }
}

watch(
  [
    () => props.repoLabelsState.status,
    () => props.labelState.status,
    () => activeLabels.value.length,
  ],
  () => {
    if (menuOpen.value) {
      void nextTick(positionPopover);
    }
  },
);

function onToggleLabel(labelName: string): void {
  if (isSaving.value) {
    return;
  }
  const currentNames = props.pr.labels.map((l) => l.name);
  const exists = currentNames.some((n) => n.toLowerCase() === labelName.toLowerCase());
  const nextNames = exists
    ? currentNames.filter((n) => n.toLowerCase() !== labelName.toLowerCase())
    : [...currentNames, labelName];
  emit('update-labels', props.pr, nextNames);
}

onUnmounted(() => {
  detachFallbackListeners();
  detachResizeListener();
});
</script>

<style scoped>
.label-picker {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
}

.label-picker-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  min-block-size: 2rem;
  min-inline-size: 2rem;
  padding: 0.25rem 0.55rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.label-picker-trigger.compact {
  padding: 0.25rem 0.42rem;
  gap: 0.18rem;
}

.label-picker-trigger:hover,
.label-picker-trigger.active {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-strong);
  color: var(--ink-primary);
}

.label-picker-trigger :deep(progress.loading-spinner) {
  --size: 0.75rem;
}

.label-picker-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  inline-size: min(19rem, calc(100vw - 1rem));
  border-radius: 0.5rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.32);
  z-index: 60;
  overflow: hidden;
}

.label-picker-popover:not(:popover-open):not(.fallback-open) {
  display: none;
}

.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.picker-title {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--ink-primary);
}

.picker-head-right {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.picker-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 1.5rem;
  min-inline-size: 1.5rem;
  padding: 0.15rem;
  border: 0;
  border-radius: 0.3rem;
  background: transparent;
  color: var(--ink-secondary);
  cursor: pointer;
}

.picker-close-btn:hover {
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.picker-search-wrap {
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
}

.picker-active {
  padding: 0.45rem 0.65rem 0.5rem;
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.picker-active-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.picker-active-title {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.picker-active-count {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--ink-muted);
}

.picker-active-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}

.picker-active-pill {
  cursor: pointer;
  min-block-size: 1.5rem;
  max-inline-size: 100%;
  overflow: hidden;
  transition: filter 120ms ease;
}

.picker-active-pill:hover:not([aria-disabled='true']) {
  filter: brightness(1.08);
}

.picker-active-pill[aria-disabled='true'] {
  opacity: 0.65;
  cursor: wait;
}

.picker-active-name {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-search {
  width: 100%;
  min-block-size: 1.9rem;
  padding: 0.25rem 0.55rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-canvas);
  color: var(--ink-primary);
  font-size: 0.78rem;
}

.picker-error {
  margin: 0;
  padding: 0.45rem 0.65rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
}

.picker-body {
  max-block-size: 16rem;
  padding: 0.25rem;
}

.picker-empty,
.picker-error-box {
  padding: 0.85rem 0.65rem;
  font-size: 0.78rem;
  color: var(--ink-muted);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}

.picker-error-box {
  color: var(--accent-red);
}

.picker-retry-btn {
  min-block-size: 1.75rem;
  padding: 0.2rem 0.6rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface-muted);
  color: var(--ink-primary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.picker-list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.picker-item {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  width: 100%;
  padding: 0.42rem 0.5rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.picker-item:hover:not([aria-disabled='true']),
.picker-item:focus-visible {
  background-color: var(--bg-surface-hover);
}

.picker-item[aria-disabled='true'] {
  opacity: 0.65;
  cursor: wait;
}

.picker-check {
  flex: 0 0 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 0.1rem;
  color: var(--accent-blue);
}

.picker-swatch {
  flex: 0 0 0.75rem;
  block-size: 0.75rem;
  margin-top: 0.22rem;
  border-radius: 999px;
  border: 1px solid rgb(128 128 128 / 0.35);
}

.picker-item-copy {
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
  min-width: 0;
}

.picker-item-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-primary);
  overflow-wrap: anywhere;
}

.picker-item-desc {
  font-size: 0.7rem;
  color: var(--ink-muted);
  line-height: 1.3;
  overflow-wrap: anywhere;
}
</style>
