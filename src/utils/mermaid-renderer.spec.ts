import { beforeEach, describe, expect, it, vi } from 'vitest';

const initializeMock = vi.fn<(config: Record<string, unknown>) => void>();
const renderMock = vi.fn<(id: string, text: string) => Promise<{ svg: string }>>();

vi.mock('mermaid', () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

import {
  extractSvgDimensions,
  hasExplicitLightMermaidTheme,
  renderMermaidDiagram,
} from '@/utils/mermaid-renderer';

describe('mermaid-renderer', () => {
  beforeEach(() => {
    initializeMock.mockReset();
    renderMock.mockReset();
  });

  it('extracts dimensions from viewBox and falls back to width/height', () => {
    expect(extractSvgDimensions('<svg viewBox="0 0 640 320"></svg>')).toEqual({
      width: 640,
      height: 320,
    });
    expect(extractSvgDimensions('<svg width="420px" height="180px"></svg>')).toEqual({
      width: 420,
      height: 180,
    });
  });

  it('detects explicit light theme init directives', () => {
    expect(hasExplicitLightMermaidTheme("%%{init: {'theme': 'neutral'}}%%\nflowchart LR")).toBe(
      true,
    );
    expect(hasExplicitLightMermaidTheme("%%{init: {'theme': 'dark'}}%%\nflowchart LR")).toBe(false);
    expect(hasExplicitLightMermaidTheme('flowchart LR\n  A --> B')).toBe(false);
  });

  it('renders mermaid diagrams with strict security and theme awareness', async () => {
    renderMock.mockResolvedValue({
      svg: '<svg viewBox="0 0 500 200"><g></g></svg>',
    });

    const darkResult = await renderMermaidDiagram('flowchart LR\n  A --> B', 'dark');
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'dark',
      }),
    );
    expect(darkResult).toEqual({
      svg: '<svg viewBox="0 0 500 200"><g></g></svg>',
      width: 500,
      height: 200,
      usesLightCanvas: false,
    });

    const neutralResult = await renderMermaidDiagram(
      "%%{init: {'theme': 'neutral'}}%%\nflowchart LR\n  A --> B",
      'dark',
    );
    expect(neutralResult.usesLightCanvas).toBe(true);
  });

  it('rejects empty mermaid input', async () => {
    await expect(renderMermaidDiagram('   ', 'dark')).rejects.toThrow('Empty Mermaid diagram');
  });
});
