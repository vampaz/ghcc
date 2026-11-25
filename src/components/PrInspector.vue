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
          GitHub ↗
        </a>
        <button type="button" class="drawer-btn" @click="$emit('close')">Close</button>
      </div>
    </div>

    <div class="drawer-scroll app-scroll">
      <PrInspectorBody
        :pr="activePr"
        :inspector="activeInspector"
        :now-ms="nowMs"
        :sync-state="syncState"
        :draft-state="draftState"
        @retry="$emit('retry', $event)"
        @sync="$emit('sync', $event)"
        @toggle-draft="(target, nextDraft) => $emit('toggle-draft', target, nextDraft)"
      />
    </div>
  </aside>

  <section
    v-else-if="inspector.status !== 'closed' && pr"
    class="inspector-inline"
    aria-labelledby="inspector-inline-title"
  >
    <div class="inline-header">
      <h2 id="inspector-inline-title" class="inline-title">Pull Request Details</h2>
      <button type="button" class="drawer-btn" @click="$emit('close')">Close</button>
    </div>
    <PrInspectorBody
      :pr="pr"
      :inspector="inspector"
      :now-ms="nowMs"
      :sync-state="syncState"
      :draft-state="draftState"
      @retry="$emit('retry', $event)"
      @sync="$emit('sync', $event)"
      @toggle-draft="(target, nextDraft) => $emit('toggle-draft', target, nextDraft)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import PrInspectorBody from '@/components/PrInspectorBody.vue';
import {
  IDLE_PR_DRAFT_STATE,
  IDLE_PR_SYNC_STATE,
  type InspectorState,
  type PrDraftState,
  type PrSyncState,
} from '@/composables/use-dashboard-state';
import type { PrView } from '@/types/pr';

interface Props {
  mode: 'dialog' | 'inline';
  pr: PrView | null;
  inspector: InspectorState;
  nowMs: number;
  syncState?: PrSyncState;
  draftState?: PrDraftState;
}

const props = withDefaults(defineProps<Props>(), {
  syncState: () => IDLE_PR_SYNC_STATE,
  draftState: () => IDLE_PR_DRAFT_STATE,
});

defineEmits<{
  close: [];
  retry: [pr: PrView];
  sync: [pr: PrView];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
}>();

const lastOpenPr = ref<PrView | null>(props.pr);
const lastOpenInspector = ref<InspectorState>(props.inspector);

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
