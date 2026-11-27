<template>
  <div class="preset-picker">
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="preset-trigger"
      :class="{ active: menuOpen }"
      aria-haspopup="menu"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :aria-controls="popoverId"
      aria-label="Filter presets"
      @pointerdown="onTriggerPointerDown"
      @click="onTriggerClick"
    >
      <span>Presets</span>
      <span v-if="savedPresets.length > 0" class="preset-count mono-num">
        ({{ savedPresets.length }})
      </span>
      <CarbonIcon name="chevron-down" :size="12" />
    </button>

    <div
      :id="popoverId"
      ref="popoverRef"
      popover="auto"
      class="preset-picker-popover"
      :class="{ 'fallback-open': fallbackOpen }"
      @toggle="onPopoverToggle"
      @keydown.esc.stop.prevent="closeMenu(true)"
    >
      <div class="picker-head">
        <span class="picker-title">Filter presets</span>
        <button
          type="button"
          class="picker-close-btn"
          aria-label="Close presets"
          @click="closeMenu(true)"
        >
          <CarbonIcon name="close" :size="14" />
        </button>
      </div>

      <div class="picker-section">
        <span class="picker-section-label">Built-in views</span>
        <div role="menu" :aria-labelledby="triggerId" class="picker-list">
          <button
            v-for="preset in builtInPresets"
            :key="preset.id"
            type="button"
            role="menuitem"
            class="picker-item"
            @click="onApply(preset.filters)"
          >
            <span class="picker-item-name">{{ preset.name }}</span>
            <span class="picker-item-desc">{{ preset.description }}</span>
          </button>
        </div>
      </div>

      <div v-if="savedPresets.length > 0" class="picker-section">
        <span class="picker-section-label">Saved views</span>
        <div class="picker-list">
          <div v-for="preset in savedPresets" :key="preset.id" class="saved-preset-row">
            <button
              type="button"
              role="menuitem"
              class="picker-item saved-preset-btn"
              @click="onApply(preset.filters)"
            >
              <span class="picker-item-name">{{ preset.name }}</span>
            </button>
            <button
              type="button"
              class="preset-delete-btn"
              :aria-label="`Delete preset ${preset.name}`"
              @click="$emit('delete-preset', preset.id)"
            >
              <CarbonIcon name="close" :size="13" />
            </button>
          </div>
        </div>
      </div>

      <form class="save-preset-form" @submit.prevent="onSave">
        <label :for="saveInputId" class="visually-hidden">Save current filters as preset</label>
        <input
          :id="saveInputId"
          ref="saveInputRef"
          v-model="draftName"
          type="text"
          maxlength="60"
          class="save-preset-input"
          placeholder="Save current view as..."
        />
        <button
          type="submit"
          class="save-preset-btn"
          :disabled="saving || draftName.trim().length === 0"
        >
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </form>

      <p v-if="error" class="picker-error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onUnmounted, ref, useId } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import type { SavedFilterPreset } from '@/types/pr';
import { BUILT_IN_PRESETS } from '@/utils/presets';

interface Props {
  savedPresets: SavedFilterPreset[];
  saving?: boolean;
  error?: string | null;
}

withDefaults(defineProps<Props>(), {
  saving: false,
  error: null,
});

const emit = defineEmits<{
  'apply-preset': [filters: SavedFilterPreset['filters']];
  'save-preset': [name: string];
  'delete-preset': [id: string];
}>();

const builtInPresets = BUILT_IN_PRESETS;
const uid = useId();
const triggerId = `preset-trigger-${uid}`;
const popoverId = `preset-popover-${uid}`;
const saveInputId = `preset-save-input-${uid}`;

const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const saveInputRef = ref<HTMLInputElement | null>(null);
const menuOpen = ref<boolean>(false);
const fallbackOpen = ref<boolean>(false);
const draftName = ref<string>('');
let wasOpenOnPointerDown = false;

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
  const height = popover.offsetHeight || 320;
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
  detachListeners();
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
  void nextTick(() => positionPopover());
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
    detachListeners();
  }
}

function onApply(filters: SavedFilterPreset['filters']): void {
  emit('apply-preset', filters);
  closeMenu(false);
}

function onSave(): void {
  const name = draftName.value.trim();
  if (!name) {
    return;
  }
  emit('save-preset', name);
  draftName.value = '';
  saveInputRef.value?.focus();
}

onUnmounted(() => {
  detachListeners();
});
</script>

<style scoped>
.preset-picker {
  position: relative;
  display: inline-flex;
}

.preset-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-block-size: 2rem;
  padding: 0.25rem 0.65rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.preset-trigger:hover,
.preset-trigger.active {
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.preset-count {
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.preset-picker-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  inline-size: min(18rem, calc(100vw - 1rem));
  border-radius: 0.5rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: 0 12px 28px rgb(0 0 0 / 0.28);
  z-index: 60;
}

.preset-picker-popover:not(:popover-open):not(.fallback-open) {
  display: none;
}

.preset-picker-popover.fallback-open {
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

.picker-close-btn,
.preset-delete-btn {
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

.picker-close-btn:hover,
.preset-delete-btn:hover {
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.picker-section {
  padding: 0.4rem 0.35rem;
  border-bottom: 1px solid var(--border-subtle);
}

.picker-section-label {
  display: block;
  padding: 0 0.45rem 0.25rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-muted);
}

.picker-list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.saved-preset-row {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.saved-preset-btn {
  flex: 1 1 auto;
}

.picker-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.08rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: var(--ink-primary);
  text-align: left;
  cursor: pointer;
}

.picker-item:hover {
  background-color: var(--bg-surface-hover);
}

.picker-item-name {
  font-size: 0.8rem;
  font-weight: 600;
}

.picker-item-desc {
  font-size: 0.7rem;
  color: var(--ink-secondary);
}

.save-preset-form {
  display: flex;
  gap: 0.35rem;
  padding: 0.5rem 0.55rem;
}

.save-preset-input {
  flex: 1 1 auto;
  min-width: 0;
  min-block-size: 1.85rem;
  padding: 0.2rem 0.5rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface-muted);
  color: var(--ink-primary);
  font-size: 0.78rem;
}

.save-preset-btn {
  flex: 0 0 auto;
  min-block-size: 1.85rem;
  padding: 0.2rem 0.6rem;
  border-radius: 0.35rem;
  border: 1px solid var(--accent-blue);
  background-color: var(--accent-blue);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.save-preset-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.picker-error {
  margin: 0 0.55rem 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.3rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.74rem;
}
</style>
