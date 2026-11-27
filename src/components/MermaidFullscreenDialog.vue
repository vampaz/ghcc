<template>
  <dialog
    ref="dialogRef"
    class="mermaid-fullscreen-dialog"
    :aria-labelledby="titleId"
    @close="onDialogClose"
    @keydown="onDialogKeydown"
  >
    <header class="mermaid-fs-header">
      <div class="mermaid-fs-title-group">
        <span class="mermaid-fs-badge">Mermaid</span>
        <h1 :id="titleId" class="mermaid-fs-title">{{ title }}</h1>
      </div>

      <div class="mermaid-fs-controls">
        <div class="mermaid-zoom-group" role="group" aria-label="Diagram zoom controls">
          <button
            type="button"
            class="mermaid-fs-btn"
            aria-label="Zoom out"
            :disabled="viewerState.status !== 'ready' || scale <= MIN_SCALE"
            @click="stepZoom(1 / ZOOM_STEP)"
          >
            <CarbonIcon name="zoom-out" :size="15" />
          </button>
          <button
            type="button"
            class="mermaid-fs-btn mermaid-zoom-readout mono-num"
            aria-label="Reset zoom to 100%"
            :disabled="viewerState.status !== 'ready'"
            @click="resetToActualSize"
          >
            {{ zoomPercent }}%
          </button>
          <button
            type="button"
            class="mermaid-fs-btn"
            aria-label="Zoom in"
            :disabled="viewerState.status !== 'ready' || scale >= MAX_SCALE"
            @click="stepZoom(ZOOM_STEP)"
          >
            <CarbonIcon name="zoom-in" :size="15" />
          </button>
          <button
            type="button"
            class="mermaid-fs-btn"
            aria-label="Fit diagram to viewport"
            :disabled="viewerState.status !== 'ready'"
            @click="fitToViewport"
          >
            <CarbonIcon name="fit-to-screen" :size="15" />
            <span>Fit</span>
          </button>
        </div>

        <button
          ref="closeBtnRef"
          type="button"
          class="mermaid-fs-btn mermaid-fs-close"
          autofocus
          @click="requestClose"
        >
          <CarbonIcon name="close" :size="15" />
          <span>Close</span>
        </button>
      </div>
    </header>

    <div
      ref="stageRef"
      class="mermaid-fs-stage"
      :class="{
        panning: panState.status === 'panning',
      }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div v-if="viewerState.status === 'loading'" class="mermaid-fs-state">
        <progress class="loading-spinner" aria-label="Rendering Mermaid diagram"></progress>
        <span>Rendering diagram...</span>
      </div>

      <div v-else-if="viewerState.status === 'error'" class="mermaid-fs-error" role="alert">
        <p class="mermaid-fs-error-title">Unable to render Mermaid diagram</p>
        <p class="mermaid-fs-error-msg">{{ viewerState.message }}</p>
        <pre class="mermaid-fs-fallback"><code>{{ source }}</code></pre>
      </div>

      <div
        v-show="viewerState.status === 'ready'"
        ref="canvasRef"
        class="mermaid-fs-canvas"
        :class="{
          'light-sheet':
            viewerState.status === 'ready' &&
            viewerState.usesLightCanvas &&
            resolvedTheme === 'dark',
        }"
        :style="canvasTransformStyle"
      ></div>

      <div v-if="viewerState.status === 'ready'" class="mermaid-fs-hint" aria-hidden="true">
        Drag to pan · Scroll to zoom · <kbd>+</kbd>/<kbd>-</kbd> zoom · <kbd>0</kbd> fit ·
        <kbd>Esc</kbd> close
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import type { ResolvedTheme } from '@/composables/use-theme';
import { mountSanitizedMermaidSvg, renderMermaidDiagram } from '@/utils/mermaid-renderer';

type ViewerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; width: number; height: number; usesLightCanvas: boolean }
  | { status: 'error'; message: string };

type PanState =
  | { status: 'idle' }
  | {
      status: 'panning';
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    };

interface Props {
  open: boolean;
  title: string;
  source: string;
  resolvedTheme: ResolvedTheme;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
}>();

const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;
const FIT_PADDING_PX = 48;

const titleId = `mermaid-fs-title-${useId()}`;
const dialogRef = ref<HTMLDialogElement | null>(null);
const closeBtnRef = ref<HTMLButtonElement | null>(null);
const stageRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLDivElement | null>(null);

const viewerState = ref<ViewerState>({ status: 'idle' });
const panState = ref<PanState>({ status: 'idle' });

const scale = ref<number>(1);
const translateX = ref<number>(0);
const translateY = ref<number>(0);

let renderToken = 0;

const zoomPercent = computed<number>(() => Math.round(scale.value * 100));

const canvasTransformStyle = computed<Record<string, string>>(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
}));

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function getEffectiveCanvasSize(): { width: number; height: number } {
  if (viewerState.value.status !== 'ready') {
    return { width: 0, height: 0 };
  }
  const sheetPad = viewerState.value.usesLightCanvas && props.resolvedTheme === 'dark' ? 48 : 0;
  return {
    width: viewerState.value.width + sheetPad,
    height: viewerState.value.height + sheetPad,
  };
}

function fitToViewport(): void {
  if (viewerState.value.status !== 'ready') {
    return;
  }
  const stage = stageRef.value;
  const stageW = stage?.clientWidth ?? 0;
  const stageH = stage?.clientHeight ?? 0;
  const { width, height } = getEffectiveCanvasSize();

  if (stageW <= 0 || stageH <= 0 || width <= 0 || height <= 0) {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    return;
  }

  const availW = Math.max(120, stageW - FIT_PADDING_PX * 2);
  const availH = Math.max(120, stageH - FIT_PADDING_PX * 2);
  const fitScale = Math.min(availW / width, availH / height, 2.5);
  const nextScale = clampScale(fitScale);
  scale.value = nextScale;
  translateX.value = Math.round((stageW - width * nextScale) / 2);
  translateY.value = Math.round((stageH - height * nextScale) / 2);
}

function resetToActualSize(): void {
  if (viewerState.value.status !== 'ready') {
    return;
  }
  const stage = stageRef.value;
  const stageW = stage?.clientWidth ?? 0;
  const stageH = stage?.clientHeight ?? 0;
  const { width, height } = getEffectiveCanvasSize();
  scale.value = 1;
  if (stageW > 0 && stageH > 0) {
    translateX.value = Math.round((stageW - width) / 2);
    translateY.value = Math.round((stageH - height) / 2);
  } else {
    translateX.value = 0;
    translateY.value = 0;
  }
}

function zoomAroundPoint(factor: number, clientX?: number, clientY?: number): void {
  if (viewerState.value.status !== 'ready') {
    return;
  }
  const stage = stageRef.value;
  const rect = stage?.getBoundingClientRect();
  const prevScale = scale.value;
  const nextScale = clampScale(prevScale * factor);
  if (nextScale === prevScale) {
    return;
  }

  const anchorX = rect ? (clientX !== undefined ? clientX - rect.left : rect.width / 2) : 0;
  const anchorY = rect ? (clientY !== undefined ? clientY - rect.top : rect.height / 2) : 0;
  const ratio = nextScale / prevScale;

  translateX.value = anchorX - (anchorX - translateX.value) * ratio;
  translateY.value = anchorY - (anchorY - translateY.value) * ratio;
  scale.value = nextScale;
}

function stepZoom(factor: number): void {
  zoomAroundPoint(factor);
}

function onWheel(event: WheelEvent): void {
  if (viewerState.value.status !== 'ready') {
    return;
  }
  const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
  zoomAroundPoint(factor, event.clientX, event.clientY);
}

function onPointerDown(event: PointerEvent): void {
  if (viewerState.value.status !== 'ready' || event.button !== 0) {
    return;
  }
  const stage = stageRef.value;
  if (!stage) {
    return;
  }
  if (typeof stage.setPointerCapture === 'function') {
    stage.setPointerCapture(event.pointerId);
  }
  panState.value = {
    status: 'panning',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: translateX.value,
    originY: translateY.value,
  };
}

function onPointerMove(event: PointerEvent): void {
  if (panState.value.status !== 'panning' || panState.value.pointerId !== event.pointerId) {
    return;
  }
  translateX.value = panState.value.originX + (event.clientX - panState.value.startX);
  translateY.value = panState.value.originY + (event.clientY - panState.value.startY);
}

function onPointerUp(event: PointerEvent): void {
  if (panState.value.status !== 'panning' || panState.value.pointerId !== event.pointerId) {
    return;
  }
  const stage = stageRef.value;
  if (stage && typeof stage.releasePointerCapture === 'function') {
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore if capture was already released.
    }
  }
  panState.value = { status: 'idle' };
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (viewerState.value.status !== 'ready' || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    stepZoom(ZOOM_STEP);
  } else if (event.key === '-') {
    event.preventDefault();
    stepZoom(1 / ZOOM_STEP);
  } else if (event.key === '0') {
    event.preventDefault();
    fitToViewport();
  }
}

function requestClose(): void {
  const dialog = dialogRef.value;
  if (dialog?.open && typeof dialog.close === 'function') {
    dialog.close('close');
  } else {
    emit('close');
  }
}

function onDialogClose(): void {
  const dialog = dialogRef.value;
  if (dialog) {
    dialog.returnValue = '';
  }
  panState.value = { status: 'idle' };
  if (props.open) {
    emit('close');
  }
}

async function renderDiagram(): Promise<void> {
  if (!props.open || !props.source.trim()) {
    viewerState.value = { status: 'idle' };
    return;
  }
  const token = ++renderToken;
  viewerState.value = { status: 'loading' };
  try {
    const result = await renderMermaidDiagram(props.source, props.resolvedTheme);
    if (token !== renderToken) {
      return;
    }
    viewerState.value = {
      status: 'ready',
      width: result.width,
      height: result.height,
      usesLightCanvas: result.usesLightCanvas,
    };
    await nextTick();
    if (token !== renderToken) {
      return;
    }
    if (canvasRef.value) {
      const mounted = mountSanitizedMermaidSvg(canvasRef.value, result.svg, {
        width: result.width,
        height: result.height,
      });
      if (!mounted) {
        viewerState.value = { status: 'error', message: 'Invalid SVG output.' };
        return;
      }
      fitToViewport();
    }
  } catch (error) {
    if (token !== renderToken) {
      return;
    }
    viewerState.value = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Syntax error',
    };
  }
}

watch(
  () => [props.open, props.source, props.resolvedTheme] as const,
  async ([isOpen], prev) => {
    const wasOpen = prev?.[0] ?? false;
    if (isOpen) {
      await nextTick();
      const dialog = dialogRef.value;
      if (!dialog) {
        return;
      }
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
      }
      if (!wasOpen) {
        closeBtnRef.value?.focus();
      }
      await renderDiagram();
    } else {
      renderToken++;
      panState.value = { status: 'idle' };
      viewerState.value = { status: 'idle' };
      const dialog = dialogRef.value;
      if (dialog?.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  renderToken++;
});
</script>

<style scoped>
.mermaid-fullscreen-dialog {
  position: fixed;
  inset: 0;
  margin: 0;
  padding: 0;
  inline-size: 100vw;
  max-inline-size: 100vw;
  block-size: 100dvh;
  max-block-size: 100dvh;
  border: 0;
  border-radius: 0;
  background-color: var(--bg-canvas);
  color: var(--ink-primary);
  overflow: hidden;
}

.mermaid-fullscreen-dialog[open] {
  display: flex;
  flex-direction: column;
}

.mermaid-fullscreen-dialog::backdrop {
  background-color: var(--bg-canvas);
}

.mermaid-fs-header {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
}

.mermaid-fs-title-group {
  min-inline-size: 0;
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.mermaid-fs-badge {
  flex: 0 0 auto;
  padding: 0.12rem 0.45rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-secondary);
}

.mermaid-fs-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--ink-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mermaid-fs-controls {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.mermaid-zoom-group {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.mermaid-fs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-block-size: 2rem;
  min-inline-size: 2rem;
  padding: 0.25rem 0.55rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface-muted);
  color: var(--ink-primary);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.mermaid-fs-btn:hover:not(:disabled) {
  background-color: var(--bg-surface-hover);
  border-color: var(--accent-blue);
}

.mermaid-fs-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.mermaid-zoom-readout {
  min-inline-size: 3.6rem;
}

.mermaid-fs-stage {
  position: relative;
  flex: 1 1 auto;
  min-block-size: 0;
  inline-size: 100%;
  overflow: hidden;
  background-color: var(--bg-canvas);
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.mermaid-fs-stage.panning {
  cursor: grabbing;
}

.mermaid-fs-canvas {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.mermaid-fs-canvas.light-sheet {
  padding: 1.5rem;
  border-radius: 0.75rem;
  background-color: #f8fafc;
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.45);
}

.mermaid-fs-canvas :deep(svg) {
  display: block;
}

.mermaid-fs-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  font-size: 0.9rem;
  color: var(--ink-secondary);
}

.mermaid-fs-error {
  max-inline-size: 46rem;
  margin: 2rem auto;
  padding: 1rem 1.25rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  user-select: text;
  cursor: default;
}

.mermaid-fs-error-title {
  margin: 0 0 0.25rem;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--accent-red);
}

.mermaid-fs-error-msg {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  color: var(--ink-secondary);
}

.mermaid-fs-fallback {
  margin: 0;
  padding: 0.75rem;
  border-radius: 0.4rem;
  background-color: var(--bg-surface-muted);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  overflow-x: auto;
}

.mermaid-fs-hint {
  position: absolute;
  inset-block-end: 0.85rem;
  inset-inline-end: 1rem;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background-color: color-mix(in srgb, var(--bg-surface) 92%, transparent);
  color: var(--ink-secondary);
  font-size: 0.72rem;
  pointer-events: none;
}

.mermaid-fs-hint kbd {
  padding: 0.02rem 0.28rem;
  border-radius: 0.2rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
}

@media (max-width: 640px) {
  .mermaid-fs-hint {
    display: none;
  }
}
</style>
