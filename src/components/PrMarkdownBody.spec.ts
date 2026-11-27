import { flushPromises } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RenderedMermaidSvg } from '@/utils/mermaid-renderer';
import { preloadPrHtmlSanitizer } from '@/utils/pr-html';

const renderMermaidDiagramMock =
  vi.fn<(source: string, theme: string) => Promise<RenderedMermaidSvg>>();

vi.mock('@/utils/mermaid-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/mermaid-renderer')>();
  return {
    ...actual,
    renderMermaidDiagram: (source: string, theme: string) =>
      renderMermaidDiagramMock(source, theme),
  };
});

import PrMarkdownBody from '@/components/PrMarkdownBody.vue';
import { mountWithDeps } from '@/test/mount-with-deps';

describe('PrMarkdownBody', () => {
  beforeAll(async () => {
    await preloadPrHtmlSanitizer();
  });

  beforeEach(() => {
    renderMermaidDiagramMock.mockReset();
  });

  it('renders GitHub HTML, inline Mermaid SVG, and emits open-mermaid from the Full screen button', async () => {
    renderMermaidDiagramMock.mockResolvedValue({
      svg: '<svg viewBox="0 0 300 120"><text>Flow</text></svg>',
      width: 300,
      height: 120,
      usesLightCanvas: false,
    });

    const html = [
      '<h2>Summary</h2>',
      '<table><thead><tr><th>Finding</th><th>Fix</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
      '<pre class="pr-mermaid-source"><code>flowchart LR\n  A --&gt; B</code></pre>',
    ].join('');

    const wrapper = mountWithDeps(PrMarkdownBody, {
      props: {
        html,
        prUrl: 'https://github.com/org/repo/pull/5695',
        prKey: 'org/repo#5695',
        resolvedTheme: 'dark',
      },
    });
    await flushPromises();

    expect(wrapper.find('h2').text()).toBe('Summary');
    expect(wrapper.find('.pr-table-wrap table').exists()).toBe(true);
    expect(wrapper.find('.mermaid-svg-host svg').exists()).toBe(true);

    const expandBtn = wrapper.find('.mermaid-fullscreen-btn');
    expect(expandBtn.text()).toContain('Full screen');
    await expandBtn.trigger('click');

    expect(wrapper.emitted('open-mermaid')).toEqual([['flowchart LR\n  A --> B']]);
    wrapper.unmount();
  });

  it('falls back to source code when Mermaid rendering fails', async () => {
    renderMermaidDiagramMock.mockRejectedValue(new Error('Parse error on line 1'));

    const wrapper = mountWithDeps(PrMarkdownBody, {
      props: {
        html: '<pre class="pr-mermaid-source"><code>invalid %%% syntax</code></pre>',
        prKey: 'org/repo#9',
        resolvedTheme: 'light',
      },
    });
    await flushPromises();

    expect(wrapper.find('.mermaid-error-note').text()).toContain('Parse error on line 1');
    expect(wrapper.find('.mermaid-fallback-code').text()).toContain('invalid %%% syntax');
    wrapper.unmount();
  });

  it('renders inline SVG and supports fullscreen for nested Mermaid blocks inside details', async () => {
    renderMermaidDiagramMock.mockResolvedValue({
      svg: '<svg viewBox="0 0 280 100"><text>Nested Flow</text></svg>',
      width: 280,
      height: 100,
      usesLightCanvas: true,
    });

    const wrapper = mountWithDeps(PrMarkdownBody, {
      props: {
        html: '<details open><summary><h3>Flowchart</h3></summary><div><div><pre class="pr-mermaid-source"><code>graph TD\n  X --&gt; Y</code></pre></div></div></details>',
        prKey: 'org/repo#12',
        resolvedTheme: 'dark',
      },
    });
    await flushPromises();

    expect(wrapper.find('.pr-nested-mermaid-svg svg').exists()).toBe(true);
    expect(wrapper.find('pre.pr-mermaid-source').exists()).toBe(false);
    const nestedBtn = wrapper.find('.pr-nested-mermaid-btn');
    expect(nestedBtn.exists()).toBe(true);
    await nestedBtn.trigger('click');
    expect(wrapper.emitted('open-mermaid')).toEqual([['graph TD\n  X --> Y']]);
    wrapper.unmount();
  });
});
