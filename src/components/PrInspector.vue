<template>
  <dialog
    v-if="mode === 'dialog'"
    ref="dialogRef"
    class="inspector-dialog"
    closedby="any"
    aria-labelledby="inspector-title"
    @close="onNativeClose"
  >
    <div class="drawer-header">
      <div class="drawer-title-group">
        <span v-if="pr" class="drawer-key mono-num">{{ pr.key }}</span>
        <h1 id="inspector-title" class="drawer-title">
          {{ pr?.title ?? 'Pull Request Inspector' }}
        </h1>
      </div>

      <div class="drawer-actions">
        <a v-if="pr" :href="pr.url" target="_blank" rel="noopener noreferrer" class="drawer-btn">
          GitHub ↗
        </a>
        <button type="button" class="drawer-btn" autofocus @click="$emit('close')">Close</button>
      </div>
    </div>

    <div class="drawer-scroll">
      <PrInspectorBody
        :pr="pr"
        :inspector="inspector"
        :now-ms="nowMs"
        @retry="$emit('retry', $event)"
      />
    </div>
  </dialog>

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
      @retry="$emit('retry', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import PrInspectorBody from '@/components/PrInspectorBody.vue';
import type { InspectorState } from '@/composables/use-dashboard-state';
import type { PrView } from '@/types/pr';

interface Props {
  mode: 'dialog' | 'inline';
  pr: PrView | null;
  inspector: InspectorState;
  nowMs: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  retry: [pr: PrView];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);

function syncDialogOpen(): void {
  if (props.mode !== 'dialog') {
    return;
  }
  const el = dialogRef.value;
  if (!el) {
    return;
  }
  const shouldOpen = props.inspector.status !== 'closed';
  if (shouldOpen && !el.open) {
    if (typeof el.showModal === 'function') {
      el.showModal();
    } else {
      el.setAttribute('open', '');
    }
  } else if (!shouldOpen && el.open) {
    if (typeof el.close === 'function') {
      el.close();
    } else {
      el.removeAttribute('open');
    }
  }
}

function onNativeClose(): void {
  if (props.inspector.status !== 'closed') {
    emit('close');
  }
}

let cleanupLightDismiss: (() => void) | null = null;

function installClosedByFallback(el: HTMLDialogElement): void {
  if (cleanupLightDismiss) {
    cleanupLightDismiss();
    cleanupLightDismiss = null;
  }
  if (typeof HTMLDialogElement === 'undefined' || 'closedBy' in HTMLDialogElement.prototype) {
    return;
  }

  let pressedOutside = false;

  function isOutside(event: PointerEvent): boolean {
    const r = el.getBoundingClientRect();
    return (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    );
  }

  function onPointerDown(event: PointerEvent): void {
    pressedOutside = isOutside(event);
  }

  function onPointerUp(event: PointerEvent): void {
    if (pressedOutside && isOutside(event) && el.open) {
      el.close();
    }
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointerup', onPointerUp);
  cleanupLightDismiss = () => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointerup', onPointerUp);
  };
}

watch(
  () => [props.mode, props.inspector.status, dialogRef.value] as const,
  () => {
    syncDialogOpen();
    if (dialogRef.value && props.mode === 'dialog') {
      installClosedByFallback(dialogRef.value);
    }
  },
  { flush: 'post' },
);

onMounted(() => {
  syncDialogOpen();
  if (dialogRef.value && props.mode === 'dialog') {
    installClosedByFallback(dialogRef.value);
  }
});

onUnmounted(() => {
  if (cleanupLightDismiss) {
    cleanupLightDismiss();
    cleanupLightDismiss = null;
  }
});
</script>

<style scoped>
.inspector-dialog {
  margin: 0 0 0 auto;
  padding: 0;
  width: min(36rem, 100vw);
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
  border: 0;
  border-left: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: -8px 0 32px rgb(0 0 0 / 0.25);
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
