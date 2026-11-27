import type { ResolvedTheme } from '@/composables/use-theme';

export interface RenderedMermaidSvg {
  svg: string;
  width: number;
  height: number;
  usesLightCanvas: boolean;
}

type MermaidApi = (typeof import('mermaid'))['default'];

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderQueue: Promise<void> = Promise.resolve();
let renderSeq = 0;

const EXPLICIT_LIGHT_THEME_RE =
  /%%\{[\s\S]*?['"]?\btheme\b['"]?\s*:\s*['"](?:neutral|default|forest|base)['"][\s\S]*?\}%%/i;

export function hasExplicitLightMermaidTheme(source: string): boolean {
  return EXPLICIT_LIGHT_THEME_RE.test(source);
}

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((mod) => mod.default);
  return mermaidPromise;
}

export function extractSvgDimensions(svgMarkup: string): { width: number; height: number } {
  const viewBoxMatch = svgMarkup.match(/viewBox="([^"]+)"/i);
  if (viewBoxMatch?.[1]) {
    const parts = viewBoxMatch[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      const w = parts[2]!;
      const h = parts[3]!;
      if (w > 0 && h > 0) {
        return { width: w, height: h };
      }
    }
  }

  const widthMatch = svgMarkup.match(/\bwidth="(\d+(?:\.\d+)?)(?:px)?"/i);
  const heightMatch = svgMarkup.match(/\bheight="(\d+(?:\.\d+)?)(?:px)?"/i);
  const width = widthMatch?.[1] ? Number(widthMatch[1]) : 800;
  const height = heightMatch?.[1] ? Number(heightMatch[1]) : 450;
  return {
    width: Number.isFinite(width) && width > 0 ? width : 800,
    height: Number.isFinite(height) && height > 0 ? height : 450,
  };
}

export function mountSanitizedMermaidSvg(
  host: HTMLElement,
  svgMarkup: string,
  dimensions?: { width: number; height: number },
): boolean {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(svgMarkup, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) {
    return false;
  }
  const svgEl = parsed.documentElement;
  if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
    return false;
  }
  for (const script of svgEl.querySelectorAll('script')) {
    script.remove();
  }
  for (const el of svgEl.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    }
  }
  svgEl.removeAttribute('style');
  if (dimensions) {
    svgEl.setAttribute('width', String(dimensions.width));
    svgEl.setAttribute('height', String(dimensions.height));
  }
  host.replaceChildren(document.importNode(svgEl, true));
  return true;
}

export function renderMermaidDiagram(
  source: string,
  resolvedTheme: ResolvedTheme,
): Promise<RenderedMermaidSvg> {
  const trimmed = source.trim();
  if (!trimmed) {
    return Promise.reject(new Error('Empty Mermaid diagram'));
  }

  const task = renderQueue.then(async (): Promise<RenderedMermaidSvg> => {
    const mermaid = await loadMermaid();
    const usesLightCanvas = resolvedTheme === 'light' || hasExplicitLightMermaidTheme(trimmed);

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: resolvedTheme === 'dark' ? 'dark' : 'default',
      suppressErrorRendering: true,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });

    const id = `ghcc-mermaid-${++renderSeq}`;
    const result = await mermaid.render(id, trimmed);
    const { width, height } = extractSvgDimensions(result.svg);

    return {
      svg: result.svg,
      width,
      height,
      usesLightCanvas,
    };
  });

  renderQueue = task.then(
    () => undefined,
    () => undefined,
  );

  return task;
}
