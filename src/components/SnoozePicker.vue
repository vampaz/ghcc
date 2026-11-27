<template>
  <div class="snooze-picker">
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="snooze-trigger"
      :class="{ compact, active: menuOpen, snoozed: isSnoozed, saving: isSaving }"
      aria-haspopup="menu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :aria-controls="popoverId"
      :aria-label="triggerAriaLabel"
      :data-snooze-trigger="pr.key"
      :title="isSnoozed ? 'Change or clear snooze' : 'Snooze this pull request (z)'"
      @pointerdown="onTriggerPointerDown"
      @click="onTriggerClick"
    >
      <progress v-if="isSaving" class="loading-spinner" aria-label="Updating snooze"></progress>
      <CarbonIcon v-else name="time" :size="13" />
      <span v-if="!compact">{{ isSnoozed ? 'Snoozed' : 'Snooze' }}</span>
    </button>

    <div
      :id="popoverId"
      ref="popoverRef"
      popover="auto"
      class="snooze-picker-popover"
      :class="{ 'fallback-open': fallbackOpen }"
      @toggle="onPopoverToggle"
      @keydown.esc.stop.prevent="closeMenu(true)"
    >
      <div class="picker-head">
        <span class="picker-title">
          {{ isSnoozed ? 'Manage snooze' : 'Snooze pull request' }}
        </span>
        <button
          type="button"
          class="picker-close-btn"
          aria-label="Close snooze menu"
          @click="closeMenu(true)"
        >
          <CarbonIcon name="close" :size="14" />
        </button>
      </div>

      <p v-if="triageState.status === 'error'" class="picker-error" role="alert">
        {{ triageState.error }}
      </p>

      <div role="menu" :aria-labelledby="triggerId" class="picker-list">
        <button
          v-if="isSnoozed"
          type="button"
          role="menuitem"
          class="picker-item unsnooze-item"
          :aria-disabled="isSaving ? 'true' : undefined"
          @click="onUnsnooze"
        >
          <span class="picker-item-name">Unsnooze now</span>
          <span class="picker-item-desc">Return immediately to the active queue</span>
        </button>

        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          role="menuitem"
          class="picker-item"
          :aria-disabled="isSaving ? 'true' : undefined"
          @click="onSelectPreset(preset.condition)"
        >
          <span class="picker-item-name">{{ preset.label }}</span>
          <span class="picker-item-desc">{{ preset.hint }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import { IDLE_PR_TRIAGE_STATE, type PrTriageState } from '@/composables/use-dashboard-state';
import type { PrView, SnoozeCondition } from '@/types/pr';
import { buildSnoozePresets, isPrSnoozed, type SnoozePresetOption } from '@/utils/triage';

interface Props {
  pr: PrView;
  nowMs?: number;
  triageState?: PrTriageState;
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  nowMs: () => Date.now(),
  triageState: () => IDLE_PR_TRIAGE_STATE,
  compact: false,
});

const emit = defineEmits<{
  snooze: [pr: PrView, condition: SnoozeCondition];
  unsnooze: [pr: PrView];
}>();

const uid = useId();
const triggerId = `snooze-trigger-${uid}`;
const popoverId = `snooze-popover-${uid}`;

const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const menuOpen = ref<boolean>(false);
const fallbackOpen = ref<boolean>(false);
let wasOpenOnPointerDown = false;

const isSnoozed = computed<boolean>(() => isPrSnoozed(props.pr));
const isSaving = computed<boolean>(() => props.triageState.status === 'saving');

const triggerAriaLabel = computed<string>(() =>
  isSnoozed.value ? `Manage snooze — ${props.pr.key}` : `Snooze — ${props.pr.key}`,
);

const presets = computed<SnoozePresetOption[]>(() => buildSnoozePresets(props.pr, props.nowMs));

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
  const width = popover.offsetWidth || 260;
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

function attachFallbackListeners(): void {
  if (typeof document !== 'undefined') {
    document.addEventListener('click', onDocumentClickOutside, { capture: true });
  }
}

function detachFallbackListeners(): void {
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', onDocumentClickOutside, { capture: true });
  }
}

function onWindowResize(): void {
  if (menuOpen.value) {
    positionPopover();
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
  detachFallbackListeners();
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onWindowResize);
  }
  if (restoreFocus) {
    triggerRef.value?.focus();
  }
}

function openMenu(): void {
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
      attachFallbackListeners();
    }
  } else {
    fallbackOpen.value = true;
    menuOpen.value = true;
    attachFallbackListeners();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }
  void nextTick(() => {
    positionPopover();
    popover?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
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
    void nextTick(() => positionPopover());
  } else {
    menuOpen.value = false;
    fallbackOpen.value = false;
    detachFallbackListeners();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onWindowResize);
    }
  }
}

function onSelectPreset(condition: SnoozeCondition): void {
  if (isSaving.value) {
    return;
  }
  emit('snooze', props.pr, condition);
  closeMenu(false);
}

function onUnsnooze(): void {
  if (isSaving.value) {
    return;
  }
  emit('unsnooze', props.pr);
  closeMenu(false);
}

onUnmounted(() => {
  detachFallbackListeners();
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onWindowResize);
  }
});
</script>

<style scoped>
.snooze-picker {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

.snooze-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-block-size: 2rem;
  min-inline-size: 2rem;
  padding: 0.25rem 0.55rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.snooze-trigger.compact {
  padding: 0.25rem 0.45rem;
}

.snooze-trigger:hover,
.snooze-trigger.active {
  border-color: var(--border-strong);
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.snooze-trigger.snoozed {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.snooze-picker-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  inline-size: min(17rem, calc(100vw - 1rem));
  border-radius: 0.5rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: 0 12px 28px rgb(0 0 0 / 0.28);
  z-index: 60;
}

.snooze-picker-popover:not(:popover-open):not(.fallback-open) {
  display: none;
}

.snooze-picker-popover.fallback-open {
  display: block;
}

.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
}

.picker-title {
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--ink-primary);
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

.picker-close-btn:hover {
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.picker-error {
  margin: 0.45rem 0.65rem 0;
  padding: 0.35rem 0.5rem;
  border-radius: 0.3rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.74rem;
}

.picker-list {
  display: flex;
  flex-direction: column;
  padding: 0.35rem;
  gap: 0.15rem;
}

.picker-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
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

.picker-item.unsnooze-item {
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 0.35rem 0.35rem 0 0;
  margin-bottom: 0.15rem;
  color: var(--accent-blue);
}

.picker-item-name {
  font-size: 0.8rem;
  font-weight: 600;
}

.picker-item-desc {
  font-size: 0.71rem;
  color: var(--ink-secondary);
}
</style>
