<template>
  <div class="pr-markdown-shell">
    <div class="pr-markdown-viewport" :class="{ collapsed: isClamped }">
      <div ref="innerRef" class="pr-markdown">
        <template v-for="(segment, index) in segments" :key="`${segment.kind}-${index}`">
          <div
            v-if="segment.kind === 'html'"
            :ref="(el) => setChunkRef(index, el)"
            class="pr-markdown-chunk"
          ></div>
          <PrMermaidBlock
            v-else
            :source="segment.source"
            :resolved-theme="resolvedTheme"
            @open-fullscreen="$emit('open-mermaid', $event)"
            @rendered="scheduleMeasure"
          />
        </template>
      </div>
      <div v-if="isClamped" class="pr-markdown-fade" aria-hidden="true"></div>
    </div>

    <button
      v-if="isOverflowing"
      type="button"
      class="pr-markdown-toggle"
      :aria-expanded="disclosure === 'expanded' ? 'true' : 'false'"
      @click="toggleDisclosure"
    >
      {{ disclosure === 'expanded' ? 'Show less' : 'Show full description' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import PrMermaidBlock from '@/components/PrMermaidBlock.vue';
import type { ResolvedTheme } from '@/composables/use-theme';
import { mountSanitizedMermaidSvg, renderMermaidDiagram } from '@/utils/mermaid-renderer';
import { type PrBodySegment, safeSetPrHtml, splitPrBodySegments } from '@/utils/pr-html';

type DisclosureState = 'collapsed' | 'expanded';

interface Props {
  html: string;
  prUrl?: string;
  prKey?: string;
  resolvedTheme: ResolvedTheme;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'open-mermaid': [source: string];
}>();

const COLLAPSED_MAX_PX = 340;

const disclosure = ref<DisclosureState>('collapsed');
const isOverflowing = ref<boolean>(false);
const innerRef = ref<HTMLDivElement | null>(null);
const chunkElements = new Map<number, HTMLElement>();

let hydrateToken = 0;
let resizeObserver: ResizeObserver | null = null;

const segments = computed<PrBodySegment[]>(() => splitPrBodySegments(props.html));

const isClamped = computed<boolean>(() => disclosure.value === 'collapsed' && isOverflowing.value);

function setChunkRef(index: number, el: unknown): void {
  if (el instanceof HTMLElement) {
    chunkElements.set(index, el);
  } else {
    chunkElements.delete(index);
  }
}

function toggleDisclosure(): void {
  disclosure.value = disclosure.value === 'collapsed' ? 'expanded' : 'collapsed';
}

function measureOverflow(): void {
  const el = innerRef.value;
  if (!el) {
    isOverflowing.value = false;
    return;
  }
  isOverflowing.value = el.scrollHeight > COLLAPSED_MAX_PX + 24;
}

function scheduleMeasure(): void {
  void nextTick(() => {
    measureOverflow();
  });
}

function createMaximizeSvgIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const useEl = document.createElementNS(ns, 'use');
  useEl.setAttribute('href', '/icons.svg#carbon-maximize');
  svg.appendChild(useEl);
  return svg;
}

async function renderNestedMermaidHost(
  bodyHost: HTMLElement,
  source: string,
  fallbackPre: HTMLElement,
  token: number,
): Promise<void> {
  try {
    const result = await renderMermaidDiagram(source, props.resolvedTheme);
    if (token !== hydrateToken || !bodyHost.parentNode) {
      return;
    }
    const svgWrap = document.createElement('div');
    svgWrap.className = 'pr-nested-mermaid-svg';
    if (result.usesLightCanvas) {
      svgWrap.classList.add('light-canvas');
    }
    svgWrap.title = 'Double-click to open in full screen';
    svgWrap.addEventListener('dblclick', () => {
      emit('open-mermaid', source);
    });
    const mounted = mountSanitizedMermaidSvg(svgWrap, result.svg);
    if (mounted) {
      bodyHost.replaceChildren(svgWrap);
      scheduleMeasure();
      return;
    }
  } catch (error) {
    if (token !== hydrateToken || !bodyHost.parentNode) {
      return;
    }
    const note = document.createElement('p');
    note.className = 'pr-nested-mermaid-error';
    note.textContent = `Unable to render Mermaid diagram: ${error instanceof Error ? error.message : 'Syntax error'}`;
    bodyHost.replaceChildren(note, fallbackPre);
    scheduleMeasure();
    return;
  }

  bodyHost.replaceChildren(fallbackPre);
  scheduleMeasure();
}

function upgradeNestedMermaidBlocks(container: HTMLElement, token: number): Promise<void[]> {
  const candidates = container.querySelectorAll<HTMLElement>(
    'pre.pr-mermaid-source, .highlight-source-mermaid, pre > code.language-mermaid',
  );
  const visited = new Set<HTMLElement>();
  const renderTasks: Promise<void>[] = [];

  for (const match of candidates) {
    const host =
      match.tagName.toLowerCase() === 'code' && match.parentElement ? match.parentElement : match;
    if (visited.has(host) || host.parentElement?.classList.contains('pr-nested-mermaid-body')) {
      continue;
    }
    visited.add(host);
    const source = (host.textContent ?? '').trim();
    if (!source) {
      continue;
    }
    const wrapper = document.createElement('figure');
    wrapper.className = 'pr-nested-mermaid';
    wrapper.setAttribute('aria-label', 'Mermaid diagram');

    const bar = document.createElement('div');
    bar.className = 'pr-nested-mermaid-bar';
    const badge = document.createElement('span');
    badge.className = 'pr-nested-mermaid-badge';
    badge.textContent = 'Mermaid';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pr-nested-mermaid-btn';
    btn.setAttribute('aria-label', 'Open Mermaid diagram in full screen');
    const btnText = document.createElement('span');
    btnText.textContent = 'Full screen';
    btn.append(createMaximizeSvgIcon(), btnText);
    btn.addEventListener('click', () => {
      emit('open-mermaid', source);
    });
    bar.append(badge, btn);

    const bodyHost = document.createElement('div');
    bodyHost.className = 'pr-nested-mermaid-body';
    const loadingNote = document.createElement('div');
    loadingNote.className = 'pr-nested-mermaid-status';
    loadingNote.textContent = 'Rendering diagram...';

    host.parentNode?.insertBefore(wrapper, host);
    host.remove();
    bodyHost.appendChild(loadingNote);
    wrapper.append(bar, bodyHost);

    renderTasks.push(renderNestedMermaidHost(bodyHost, source, host, token));
  }

  return Promise.all(renderTasks);
}

async function hydrateHtmlChunks(): Promise<void> {
  const token = ++hydrateToken;

  const tasks: Promise<void>[] = [];
  segments.value.forEach((segment, index) => {
    if (segment.kind !== 'html') {
      return;
    }
    const el = chunkElements.get(index);
    if (!el) {
      return;
    }
    tasks.push(
      safeSetPrHtml(el, segment.html, { prUrl: props.prUrl }).then(async () => {
        if (token === hydrateToken) {
          await upgradeNestedMermaidBlocks(el, token);
        }
      }),
    );
  });

  await Promise.all(tasks);
  if (token === hydrateToken) {
    scheduleMeasure();
  }
}

watch(
  () => [props.prKey, props.html] as const,
  () => {
    disclosure.value = 'collapsed';
    void hydrateHtmlChunks();
  },
  { flush: 'post' },
);

watch(
  () => props.resolvedTheme,
  () => {
    const hasNestedMermaid = Array.from(chunkElements.values()).some((el) =>
      Boolean(el.querySelector('.pr-nested-mermaid')),
    );
    if (hasNestedMermaid) {
      void hydrateHtmlChunks();
    }
  },
  { flush: 'post' },
);

onMounted(() => {
  void hydrateHtmlChunks();
  if (typeof ResizeObserver !== 'undefined' && innerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      measureOverflow();
    });
    resizeObserver.observe(innerRef.value);
  }
  scheduleMeasure();
});

onUnmounted(() => {
  hydrateToken++;
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.pr-markdown-shell {
  border-radius: 0.45rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  overflow: hidden;
}

.pr-markdown-viewport {
  position: relative;
  padding: 0.75rem 0.85rem;
}

.pr-markdown-viewport.collapsed {
  max-block-size: 21.25rem;
  overflow: clip;
}

.pr-markdown-fade {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 3.25rem;
  background: linear-gradient(to bottom, transparent, var(--bg-surface-muted) 88%);
  pointer-events: none;
}

.pr-markdown-toggle {
  display: block;
  inline-size: 100%;
  min-block-size: 2rem;
  padding: 0.35rem 0.75rem;
  border: 0;
  border-top: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  color: var(--accent-blue);
  font-size: 0.76rem;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
}

.pr-markdown-toggle:hover {
  background-color: var(--bg-surface-hover);
}

.pr-markdown {
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--ink-primary);
  overflow-wrap: break-word;
  word-wrap: break-word;
}

.pr-markdown-chunk :deep(> :first-child),
.pr-markdown-chunk :deep(> div:first-child > :first-child) {
  margin-top: 0;
}

.pr-markdown-chunk :deep(> :last-child) {
  margin-bottom: 0;
}

.pr-markdown-chunk + .pr-markdown-chunk {
  margin-top: 0.65rem;
}

/* Headings */
.pr-markdown :deep(h1),
.pr-markdown :deep(h2),
.pr-markdown :deep(h3),
.pr-markdown :deep(h4),
.pr-markdown :deep(h5),
.pr-markdown :deep(h6) {
  margin: 0.95rem 0 0.45rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ink-primary);
}

.pr-markdown :deep(h1) {
  font-size: 1.05rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--border-subtle);
}

.pr-markdown :deep(h2) {
  font-size: 0.94rem;
  padding-bottom: 0.2rem;
  border-bottom: 1px solid var(--border-subtle);
}

.pr-markdown :deep(h3) {
  font-size: 0.86rem;
}

.pr-markdown :deep(h4),
.pr-markdown :deep(h5),
.pr-markdown :deep(h6) {
  font-size: 0.8125rem;
  color: var(--ink-secondary);
}

/* Paragraphs and inline formatting */
.pr-markdown :deep(p) {
  margin: 0 0 0.6rem;
}

.pr-markdown :deep(strong),
.pr-markdown :deep(b) {
  font-weight: 600;
}

.pr-markdown :deep(a) {
  color: var(--accent-blue);
  text-decoration: none;
}

.pr-markdown :deep(a:hover) {
  text-decoration: underline;
}

.pr-markdown :deep(hr) {
  height: 1px;
  border: 0;
  margin: 0.85rem 0;
  background-color: var(--border-subtle);
}

.pr-markdown :deep(kbd) {
  display: inline-block;
  padding: 0.08rem 0.35rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  line-height: 1.25;
  color: var(--ink-primary);
}

/* Lists & task lists */
.pr-markdown :deep(ul),
.pr-markdown :deep(ol) {
  margin: 0 0 0.65rem;
  padding-inline-start: 1.35rem;
}

.pr-markdown :deep(ul) {
  list-style-type: disc;
}

.pr-markdown :deep(ul ul) {
  list-style-type: circle;
}

.pr-markdown :deep(ol) {
  list-style-type: decimal;
}

.pr-markdown :deep(li) {
  margin: 0.2rem 0;
}

.pr-markdown :deep(li > p) {
  margin-bottom: 0.3rem;
}

.pr-markdown :deep(ul.contains-task-list),
.pr-markdown :deep(ol.contains-task-list) {
  list-style: none;
  padding-inline-start: 0.2rem;
}

.pr-markdown :deep(li.task-list-item) {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
}

.pr-markdown :deep(input.task-list-item-checkbox) {
  margin-top: 0.25rem;
  accent-color: var(--accent-blue);
  flex: 0 0 auto;
}

/* Blockquotes */
.pr-markdown :deep(blockquote) {
  margin: 0 0 0.65rem;
  padding: 0.15rem 0.75rem;
  border-inline-start: 3px solid var(--border-strong);
  color: var(--ink-secondary);
}

.pr-markdown :deep(blockquote > :last-child) {
  margin-bottom: 0;
}

/* GitHub Alerts */
.pr-markdown :deep(.markdown-alert) {
  margin: 0 0 0.7rem;
  padding: 0.5rem 0.75rem;
  border-inline-start: 3px solid var(--border-strong);
  border-radius: 0 0.35rem 0.35rem 0;
  background-color: var(--bg-surface);
}

.pr-markdown :deep(.markdown-alert > :last-child) {
  margin-bottom: 0;
}

.pr-markdown :deep(.markdown-alert-title) {
  margin: 0 0 0.25rem;
  font-size: 0.76rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.pr-markdown :deep(.markdown-alert-note) {
  border-inline-start-color: var(--accent-blue);
}

.pr-markdown :deep(.markdown-alert-note > .markdown-alert-title) {
  color: var(--accent-blue);
}

.pr-markdown :deep(.markdown-alert-tip) {
  border-inline-start-color: var(--accent-emerald);
}

.pr-markdown :deep(.markdown-alert-tip > .markdown-alert-title) {
  color: var(--accent-emerald);
}

.pr-markdown :deep(.markdown-alert-important) {
  border-inline-start-color: light-dark(#7c3aed, #a78bfa);
}

.pr-markdown :deep(.markdown-alert-important > .markdown-alert-title) {
  color: light-dark(#7c3aed, #a78bfa);
}

.pr-markdown :deep(.markdown-alert-warning) {
  border-inline-start-color: var(--accent-amber);
}

.pr-markdown :deep(.markdown-alert-warning > .markdown-alert-title) {
  color: var(--accent-amber);
}

.pr-markdown :deep(.markdown-alert-caution) {
  border-inline-start-color: var(--accent-red);
}

.pr-markdown :deep(.markdown-alert-caution > .markdown-alert-title) {
  color: var(--accent-red);
}

/* Code and GitHub syntax highlighting tokens */
.pr-markdown :deep(code) {
  padding: 0.1rem 0.32rem;
  border-radius: 0.25rem;
  background-color: light-dark(rgb(15 23 42 / 0.07), rgb(230 237 243 / 0.1));
  font-family: var(--font-mono);
  font-size: 0.76rem;
}

.pr-markdown :deep(pre) {
  margin: 0 0 0.65rem;
  padding: 0.6rem 0.75rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.48;
  overflow-x: auto;
}

.pr-markdown :deep(pre code) {
  padding: 0;
  border-radius: 0;
  background-color: transparent;
  font-size: inherit;
}

.pr-markdown :deep(.highlight) {
  margin: 0 0 0.65rem;
}

.pr-markdown :deep(.highlight pre) {
  margin-bottom: 0;
}

.pr-markdown :deep(.pl-c) {
  color: light-dark(#64748b, #8b949e);
}

.pr-markdown :deep(.pl-k),
.pr-markdown :deep(.pl-bu) {
  color: light-dark(#cf222e, #ff7b72);
}

.pr-markdown :deep(.pl-s),
.pr-markdown :deep(.pl-pds),
.pr-markdown :deep(.pl-sr) {
  color: light-dark(#0a3069, #a5d6ff);
}

.pr-markdown :deep(.pl-en),
.pr-markdown :deep(.pl-e) {
  color: light-dark(#8250df, #d2a8ff);
}

.pr-markdown :deep(.pl-c1),
.pr-markdown :deep(.pl-s1),
.pr-markdown :deep(.pl-mi) {
  color: light-dark(#0550ae, #79c0ff);
}

.pr-markdown :deep(.pl-ent) {
  color: light-dark(#116329, #7ee787);
}

.pr-markdown :deep(.pl-v),
.pr-markdown :deep(.pl-smi) {
  color: light-dark(#953800, #ffa657);
}

/* Tables */
.pr-markdown :deep(.pr-table-wrap) {
  margin: 0 0 0.7rem;
  overflow-x: auto;
  border-radius: 0.375rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
}

.pr-markdown :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
  line-height: 1.45;
}

.pr-markdown :deep(th),
.pr-markdown :deep(td) {
  padding: 0.4rem 0.55rem;
  border-bottom: 1px solid var(--border-subtle);
  border-inline-end: 1px solid var(--border-subtle);
  vertical-align: top;
}

.pr-markdown :deep(th:last-child),
.pr-markdown :deep(td:last-child) {
  border-inline-end: 0;
}

.pr-markdown :deep(tr:last-child td) {
  border-bottom: 0;
}

.pr-markdown :deep(th) {
  font-weight: 600;
  text-align: left;
  background-color: var(--bg-surface-muted);
  color: var(--ink-primary);
}

.pr-markdown :deep(tbody tr:nth-child(2n)) {
  background-color: light-dark(rgb(15 23 42 / 0.02), rgb(255 255 255 / 0.025));
}

/* Details / Summary */
.pr-markdown :deep(details) {
  margin: 0 0 0.65rem;
  padding: 0.45rem 0.65rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
}

.pr-markdown :deep(summary) {
  cursor: pointer;
  font-weight: 600;
  color: var(--ink-primary);
}

.pr-markdown :deep(summary > h1),
.pr-markdown :deep(summary > h2),
.pr-markdown :deep(summary > h3),
.pr-markdown :deep(summary > h4),
.pr-markdown :deep(summary > h5),
.pr-markdown :deep(summary > h6) {
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 0.86rem;
}

.pr-markdown :deep(details[open] > summary) {
  margin-bottom: 0.45rem;
}

/* Images */
.pr-markdown :deep(img) {
  display: block;
  max-inline-size: 100%;
  block-size: auto;
  margin: 0.45rem 0;
  border-radius: 0.35rem;
  border: 1px solid var(--border-subtle);
}

.pr-markdown :deep(.pr-img-fallback) {
  display: inline-block;
  margin: 0.25rem 0;
  padding: 0.2rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px dashed var(--border-strong);
  background-color: var(--bg-surface);
  font-size: 0.75rem;
  color: var(--ink-secondary);
}

/* Nested Mermaid inside details/blockquotes */
.pr-markdown :deep(.pr-nested-mermaid) {
  margin: 0.5rem 0;
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  overflow: hidden;
}

.pr-markdown :deep(.pr-nested-mermaid-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.pr-markdown :deep(.pr-nested-mermaid-badge) {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.pr-markdown :deep(.pr-nested-mermaid-btn) {
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

.pr-markdown :deep(.pr-nested-mermaid-btn:hover) {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.pr-markdown :deep(.pr-nested-mermaid-status) {
  padding: 0.75rem;
  font-size: 0.78rem;
  color: var(--ink-muted);
}

.pr-markdown :deep(.pr-nested-mermaid-svg) {
  padding: 0.75rem;
  overflow-x: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: zoom-in;
}

.pr-markdown :deep(.pr-nested-mermaid-svg.light-canvas) {
  background-color: #f8fafc;
}

.pr-markdown :deep(.pr-nested-mermaid-svg svg) {
  display: block;
  max-inline-size: 100%;
  block-size: auto;
}

.pr-markdown :deep(.pr-nested-mermaid-error) {
  margin: 0;
  padding: 0.55rem 0.7rem 0.25rem;
  font-size: 0.75rem;
  color: var(--accent-amber);
}

.pr-markdown :deep(.pr-nested-mermaid pre) {
  margin: 0;
  border: 0;
  border-radius: 0;
}
</style>
