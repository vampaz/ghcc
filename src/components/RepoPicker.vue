<template>
  <div class="repo-picker">
    <button
      :id="triggerId"
      ref="triggerRef"
      type="button"
      class="repo-picker-trigger"
      :class="{ active: repoSelection.mode !== 'all' }"
      aria-haspopup="dialog"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :aria-controls="popoverId"
      :aria-label="`Filter repositories (${triggerLabel})`"
      :title="triggerTitle"
      @pointerdown="onTriggerPointerDown"
      @click="onTriggerClick"
    >
      <CarbonIcon name="branch" :size="13" />
      <span class="repo-picker-label">{{ triggerLabel }}</span>
      <CarbonIcon name="chevron-down" :size="12" />
    </button>

    <div
      :id="popoverId"
      ref="popoverRef"
      popover="auto"
      role="dialog"
      aria-label="Filter repositories"
      class="repo-picker-popover"
      :class="{ 'fallback-open': fallbackOpen }"
      tabindex="-1"
      @toggle="onPopoverToggle"
      @keydown.esc.stop.prevent="closeMenu(true)"
    >
      <div class="picker-head">
        <span class="picker-title">Filter repositories</span>
        <button
          type="button"
          class="picker-close-btn"
          aria-label="Close repository filter"
          @click="closeMenu(true)"
        >
          <CarbonIcon name="close" :size="14" />
        </button>
      </div>

      <p v-if="entries.length === 0" class="picker-empty">No open repositories.</p>

      <div v-else class="picker-body app-scroll">
        <label class="repo-all">
          <input
            id="toggle-all-repos"
            ref="allInputRef"
            type="checkbox"
            class="repo-checkbox"
            :checked="allSelected"
            :indeterminate.prop="someSelected"
            @change="onToggleAll"
          />
          <span class="repo-all-label">Select all</span>
          <span class="repo-count mono-num">{{ selectedCount }}/{{ entries.length }}</span>
        </label>

        <div role="group" aria-label="Repositories" class="repo-list">
          <label
            v-for="entry in entries"
            :key="entry.name"
            :for="repoInputId(entry.name)"
            class="repo-row"
            :class="{
              unchecked: !isRepoChecked(entry.name),
              'drafts-only': entry.displayCount === 0,
            }"
            :title="repoRowTitle(entry)"
          >
            <input
              :id="repoInputId(entry.name)"
              type="checkbox"
              class="repo-checkbox"
              :checked="isRepoChecked(entry.name)"
              @change="$emit('toggleRepo', entry.name, allRepoNames)"
            />
            <span class="repo-name">{{ entry.shortName }}</span>
            <span class="repo-count mono-num">
              {{ entry.displayCount }}
              <span v-if="!includeDrafts && entry.draftCount > 0" class="repo-draft-note">
                +{{ entry.draftCount }}d
              </span>
            </span>
            <span
              class="repo-health"
              :data-health="entry.health"
              :title="healthTitle(entry.health)"
            >
              <CarbonIcon :name="healthIcon(entry.health)" :size="15" />
              <span class="visually-hidden">{{ healthTitle(entry.health) }}</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue';
import CarbonIcon, { type CarbonIconName } from '@/components/CarbonIcon.vue';
import type { RepoSelection } from '@/composables/use-url-state';
import type { PrView } from '@/types/pr';

interface Props {
  pullRequests: PrView[];
  repoSelection: RepoSelection;
  includeDrafts?: boolean;
}

type RepoHealth = 'failing' | 'pending' | 'ok' | 'muted';

interface RepoEntry {
  name: string;
  shortName: string;
  activeCount: number;
  draftCount: number;
  displayCount: number;
  health: RepoHealth;
}

const props = withDefaults(defineProps<Props>(), {
  includeDrafts: false,
});

const emit = defineEmits<{
  toggleRepo: [repo: string, allRepos: string[]];
  toggleAll: [allRepos: string[]];
}>();

const instanceId = useId();
const triggerId = `repo-trigger-${instanceId}`;
const popoverId = `repo-popover-${instanceId}`;

const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const allInputRef = ref<HTMLInputElement | null>(null);

const menuOpen = ref<boolean>(false);
const fallbackOpen = ref<boolean>(false);
let suppressNextOpen = false;

const entries = computed<RepoEntry[]>(() => {
  const map = new Map<string, PrView[]>();
  for (const pr of props.pullRequests) {
    const list = map.get(pr.repository) ?? [];
    list.push(pr);
    map.set(pr.repository, list);
  }

  const raw = Array.from(map.entries()).map(([name, prs]) => {
    const activePrs = prs.filter((p) => p.bucket !== 'draft');
    const draftCount = prs.length - activePrs.length;
    const scopedPrs = props.includeDrafts ? prs : activePrs;
    let health: RepoHealth = scopedPrs.length === 0 ? 'muted' : 'ok';
    if (scopedPrs.some((p) => p.ci.state === 'failing' || p.merge.state === 'conflicting')) {
      health = 'failing';
    } else if (scopedPrs.some((p) => p.ci.state === 'pending')) {
      health = 'pending';
    }
    return {
      name,
      shortName: name.split('/')[1] ?? name,
      activeCount: activePrs.length,
      draftCount,
      displayCount: scopedPrs.length,
      health,
    };
  });

  return raw.sort(
    (a, b) =>
      b.displayCount - a.displayCount ||
      b.draftCount - a.draftCount ||
      a.name.localeCompare(b.name),
  );
});

const allRepoNames = computed<string[]>(() => entries.value.map((entry) => entry.name));

function isRepoChecked(repoName: string): boolean {
  if (props.repoSelection.mode === 'all') {
    return true;
  }
  if (props.repoSelection.mode === 'none') {
    return false;
  }
  return props.repoSelection.repos.includes(repoName);
}

const selectedCount = computed<number>(() => {
  return entries.value.filter((entry) => isRepoChecked(entry.name)).length;
});

const allSelected = computed<boolean>(
  () => entries.value.length > 0 && selectedCount.value === entries.value.length,
);

const someSelected = computed<boolean>(
  () => selectedCount.value > 0 && selectedCount.value < entries.value.length,
);

const triggerLabel = computed<string>(() => {
  if (props.repoSelection.mode === 'none') {
    return 'No repos';
  }
  if (props.repoSelection.mode === 'all' || props.repoSelection.repos.length === 0) {
    return 'All repos';
  }
  if (props.repoSelection.repos.length === 1) {
    return props.repoSelection.repos[0]!.split('/')[1] ?? props.repoSelection.repos[0]!;
  }
  return `${props.repoSelection.repos.length} repos`;
});

const triggerTitle = computed<string>(() => {
  if (props.repoSelection.mode === 'subset') {
    return props.repoSelection.repos.join(', ');
  }
  return 'Filter by repository';
});

function repoInputId(name: string): string {
  return `repo-check-${instanceId}-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function repoRowTitle(entry: RepoEntry): string {
  const activeLabel = `${entry.activeCount} active`;
  if (entry.draftCount > 0) {
    return `${entry.name}: ${activeLabel}, ${entry.draftCount} draft`;
  }
  return `${entry.name}: ${activeLabel}`;
}

function healthIcon(health: RepoHealth): CarbonIconName {
  if (health === 'failing') {
    return 'warning-filled';
  }
  if (health === 'pending') {
    return 'in-progress';
  }
  if (health === 'muted') {
    return 'subtract';
  }
  return 'checkmark-filled';
}

function healthTitle(health: RepoHealth): string {
  if (health === 'failing') {
    return 'Has failing CI or conflict';
  }
  if (health === 'pending') {
    return 'Checks pending';
  }
  if (health === 'muted') {
    return 'Only draft pull requests';
  }
  return 'All active checks passing';
}

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
  const width = popover.offsetWidth || 320;
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
  detachFallbackListeners();
  detachResizeListener();
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
    (allInputRef.value ?? popoverRef.value)?.focus();
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
      (allInputRef.value ?? popoverRef.value)?.focus();
    });
  } else {
    detachResizeListener();
  }
}

function onToggleAll(): void {
  if (entries.value.length === 0) {
    return;
  }
  emit('toggleAll', allRepoNames.value);
}

watch(
  () => entries.value.length,
  () => {
    if (menuOpen.value) {
      void nextTick(positionPopover);
    }
  },
);

onUnmounted(() => {
  detachFallbackListeners();
  detachResizeListener();
});
</script>

<style scoped>
.repo-picker {
  position: relative;
  display: inline-flex;
}

.repo-picker-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-block-size: 2rem;
  padding: 0.25rem 0.625rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.repo-picker-trigger:hover {
  background-color: var(--bg-surface-hover);
}

.repo-picker-trigger.active {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  font-weight: 600;
}

.repo-picker-label {
  overflow: hidden;
  text-overflow: ellipsis;
  max-inline-size: 12rem;
}

.repo-picker-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  inline-size: min(22rem, calc(100vw - 1rem));
  border-radius: 0.5rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.32);
  z-index: 60;
  overflow: hidden;
}

.repo-picker-popover:not(:popover-open):not(.fallback-open) {
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

.picker-empty {
  margin: 0;
  padding: 0.85rem 0.65rem;
  font-size: 0.78rem;
  color: var(--ink-muted);
}

.picker-body {
  max-block-size: 18rem;
  padding: 0.25rem;
}

.repo-all {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-block-size: 2rem;
  padding: 0.3rem 0.5rem;
  border-radius: 0.375rem;
  cursor: pointer;
  user-select: none;
  font-size: 0.78rem;
  font-weight: 600;
}

.repo-all:hover {
  background-color: var(--bg-surface-hover);
}

.repo-all-label {
  flex: 1 1 auto;
}

.repo-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding-block-start: 0.2rem;
  border-block-start: 1px solid var(--border-subtle);
}

.repo-row {
  position: relative;
  inline-size: 100%;
  min-block-size: 2rem;
  padding: 0.3rem 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  color: inherit;
  cursor: pointer;
  user-select: none;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 1.25rem;
  align-items: center;
  gap: 0.45rem;
  text-align: left;
  font-size: 0.8rem;
}

.repo-row.drafts-only {
  color: var(--ink-muted);
}

.repo-row.unchecked {
  opacity: 0.55;
}

.repo-row:hover {
  background-color: var(--bg-surface-hover);
  border-color: var(--border-subtle);
}

.repo-checkbox {
  inline-size: 0.95rem;
  block-size: 0.95rem;
  margin: 0;
  accent-color: var(--accent-blue);
  cursor: pointer;
}

.repo-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.repo-count {
  text-align: right;
  color: var(--ink-secondary);
  font-size: 0.75rem;
  white-space: nowrap;
}

.repo-draft-note {
  color: var(--ink-muted);
  font-size: 0.7rem;
}

.repo-health {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-emerald);
}

.repo-health[data-health='failing'] {
  color: var(--accent-red);
}

.repo-health[data-health='pending'] {
  color: var(--accent-blue);
}

.repo-health[data-health='muted'] {
  color: var(--ink-muted);
}
</style>
