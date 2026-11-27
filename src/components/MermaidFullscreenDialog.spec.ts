import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RenderedMermaidSvg } from '@/utils/mermaid-renderer';

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

import MermaidFullscreenDialog from '@/components/MermaidFullscreenDialog.vue';
import { mountWithDeps } from '@/test/mount-with-deps';

describe('MermaidFullscreenDialog', () => {
  beforeEach(() => {
    renderMermaidDiagramMock.mockReset();
  });

  it('opens native modal dialog, renders SVG, zooms, fits, and emits close', async () => {
    renderMermaidDiagramMock.mockResolvedValue({
      svg: '<svg viewBox="0 0 600 300"><rect width="600" height="300" /></svg>',
      width: 600,
      height: 300,
      usesLightCanvas: false,
    });

    const wrapper = mountWithDeps(MermaidFullscreenDialog, {
      props: {
        open: true,
        title: 'org/repo#5695 · Flowchart',
        source: 'flowchart LR\n  A --> B',
        resolvedTheme: 'dark',
      },
      attachTo: document.body,
    });
    await flushPromises();

    const dialog = wrapper.find('dialog.mermaid-fullscreen-dialog');
    expect(dialog.exists()).toBe(true);
    expect(dialog.find('h1').text()).toBe('org/repo#5695 · Flowchart');
    expect(wrapper.find('.mermaid-fs-canvas svg').exists()).toBe(true);

    const readout = wrapper.find('.mermaid-zoom-readout');
    const initialZoom = readout.text();

    await wrapper.find('button[aria-label="Zoom in"]').trigger('click');
    expect(readout.text()).not.toBe(initialZoom);

    await readout.trigger('click');
    expect(readout.text()).toBe('100%');

    await wrapper.find('button[aria-label="Zoom out"]').trigger('click');
    expect(readout.text()).toBe('80%');

    await wrapper.find('.mermaid-fs-close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);

    wrapper.unmount();
  });

  it('displays an error alert with source fallback when Mermaid fails', async () => {
    renderMermaidDiagramMock.mockRejectedValue(new Error('Lexical error'));

    const wrapper = mountWithDeps(MermaidFullscreenDialog, {
      props: {
        open: true,
        title: 'Broken diagram',
        source: 'flowchart ???',
        resolvedTheme: 'dark',
      },
      attachTo: document.body,
    });
    await flushPromises();

    expect(wrapper.find('.mermaid-fs-error').text()).toContain('Lexical error');
    expect(wrapper.find('.mermaid-fs-fallback').text()).toContain('flowchart ???');
    wrapper.unmount();
  });
});
