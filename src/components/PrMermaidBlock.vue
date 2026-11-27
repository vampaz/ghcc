<template>
  <figure class="mermaid-card" :aria-label="diagramLabel">
    <div class="mermaid-card-header">
      <span class="mermaid-badge">Mermaid</span>
      <button
        type="button"
        class="mermaid-fullscreen-btn"
        aria-label="Open Mermaid diagram in full screen"
        @click="$emit('open-fullscreen', source)"
      >
        <CarbonIcon name="maximize" :size="13" />
        <span>Full screen</span>
      </button>
    </div>

    <div v-if="state.status === 'loading'" class="mermaid-status">
      <progress class="loading-spinner" aria-label="Rendering Mermaid diagram"></progress>
      <span>Rendering diagram...</span>
    </div>

    <div v-else-if="state.status === 'error'" class="mermaid-error-box">
      <p class="mermaid-error-note" role="note">
        Unable to render Mermaid diagram: {{ state.message }}
      </p>
      <pre class="mermaid-fallback-code"><code>{{ source }}</code></pre>
    </div>

    <div
      v-show="state.status === 'ready'"
      ref="svgHostRef"
      class="mermaid-svg-host"
      :class="{ 'light-canvas': state.status === 'ready' && state.usesLightCanvas }"
      title="Double-click to open in full screen"
      @dblclick="$emit('open-fullscreen', source)"
    ></div>
  </figure>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import type { ResolvedTheme } from '@/composables/use-theme';
import { mountSanitizedMermaidSvg, renderMermaidDiagram } from '@/utils/mermaid-renderer';

type MermaidBlockState =
  | { status: 'loading' }
  | { status: 'ready'; usesLightCanvas: boolean }
  | { status: 'error'; message: string };

interface Props {
  source: string;
  resolvedTheme: ResolvedTheme;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'open-fullscreen': [source: string];
  rendered: [];
}>();

const state = ref<MermaidBlockState>({ status: 'loading' });
const svgHostRef = ref<HTMLDivElement | null>(null);
const diagramLabel = 'Mermaid diagram';

let renderToken = 0;

async function renderCurrentDiagram(): Promise<void> {
  const token = ++renderToken;
  state.value = { status: 'loading' };
  try {
    const result = await renderMermaidDiagram(props.source, props.resolvedTheme);
    if (token !== renderToken) {
      return;
    }
    if (!svgHostRef.value) {
      state.value = { status: 'error', message: 'Diagram container unavailable.' };
      return;
    }
    const mounted = mountSanitizedMermaidSvg(svgHostRef.value, result.svg);
    if (!mounted) {
      state.value = { status: 'error', message: 'Invalid SVG output.' };
    } else {
      state.value = {
        status: 'ready',
        usesLightCanvas: result.usesLightCanvas,
      };
    }
    emit('rendered');
  } catch (error) {
    if (token !== renderToken) {
      return;
    }
    state.value = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Syntax error',
    };
    emit('rendered');
  }
}

onMounted(() => {
  void renderCurrentDiagram();
});

watch(
  () => [props.source, props.resolvedTheme] as const,
  () => {
    void renderCurrentDiagram();
  },
  { flush: 'post' },
);

onUnmounted(() => {
  renderToken++;
});
</script>

<style scoped>
.mermaid-card {
  margin: 0.65rem 0;
  border-radius: 0.45rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  overflow: hidden;
}

.mermaid-card:first-child {
  margin-top: 0;
}

.mermaid-card:last-child {
  margin-bottom: 0;
}

.mermaid-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.mermaid-badge {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.mermaid-fullscreen-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-block-size: 1.65rem;
  padding: 0.15rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.mermaid-fullscreen-btn:hover {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.mermaid-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem 0.75rem;
  font-size: 0.78rem;
  color: var(--ink-muted);
}

.mermaid-svg-host {
  padding: 0.75rem;
  overflow-x: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  min-block-size: 4rem;
  cursor: zoom-in;
}

.mermaid-svg-host.light-canvas {
  background-color: #ffffff;
}

.mermaid-svg-host :deep(svg) {
  display: block;
  max-inline-size: 100%;
  block-size: auto;
}

.mermaid-error-box {
  padding: 0.65rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.mermaid-error-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--accent-amber);
}

.mermaid-fallback-code {
  margin: 0;
  padding: 0.55rem 0.65rem;
  border-radius: 0.35rem;
  background-color: var(--bg-surface-muted);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  line-height: 1.45;
  overflow-x: auto;
  color: var(--ink-primary);
}
</style>
