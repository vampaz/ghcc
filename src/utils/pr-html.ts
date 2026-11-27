export type PrBodySegment = { kind: 'html'; html: string } | { kind: 'mermaid'; source: string };

const ALLOWED_ELEMENTS: string[] = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
];

const ALLOWED_ATTRIBUTES: string[] = [
  'align',
  'alt',
  'checked',
  'class',
  'colspan',
  'disabled',
  'height',
  'href',
  'loading',
  'open',
  'referrerpolicy',
  'rel',
  'rowspan',
  'src',
  'start',
  'target',
  'title',
  'type',
  'width',
];

interface ElementWithSetHTML extends HTMLElement {
  setHTML(
    input: string,
    options?: {
      sanitizer?: {
        elements?: string[];
        attributes?: string[];
      };
    },
  ): void;
}

type DomPurifyModule = typeof import('dompurify');
type DomPurifyInstance = DomPurifyModule['default'];
let domPurifyPromise: Promise<DomPurifyInstance | null> | null = null;

function isDomPurifyOperational(dp: DomPurifyInstance): boolean {
  if (!dp.isSupported) {
    return false;
  }
  try {
    const probe = dp.sanitize('<p>ok</p><script>bad</script>', {
      ALLOWED_TAGS: ['p', '#text'],
      ALLOWED_ATTR: [],
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: false,
    });
    return probe === '<p>ok</p>';
  } catch {
    return false;
  }
}

function resolveDomPurify(mod: DomPurifyModule): DomPurifyInstance | null {
  const candidate = mod.default;
  if (isDomPurifyOperational(candidate)) {
    return candidate;
  }
  if (typeof window !== 'undefined' && typeof candidate === 'function') {
    const instance = candidate(window) as unknown as DomPurifyInstance;
    if (isDomPurifyOperational(instance)) {
      return instance;
    }
  }
  return null;
}

function loadDomPurify(): Promise<DomPurifyInstance | null> {
  domPurifyPromise ??= import('dompurify').then((mod) => resolveDomPurify(mod));
  return domPurifyPromise;
}

export async function preloadPrHtmlSanitizer(): Promise<void> {
  if (typeof Element !== 'undefined' && 'setHTML' in Element.prototype) {
    return;
  }
  await loadDomPurify();
}

const ALLOWED_ELEMENT_SET = new Set(ALLOWED_ELEMENTS);
const ALLOWED_ATTRIBUTE_SET = new Set(ALLOWED_ATTRIBUTES);

function isSafeLinkHref(rawHref: string): boolean {
  try {
    const parsed = new URL(rawHref);
    return (
      parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:'
    );
  } catch {
    return false;
  }
}

function sanitizeToFragmentFailClosed(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();

  function cloneSafeNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_ELEMENT_SET.has(tag)) {
      return null;
    }
    const cleanEl = document.createElement(tag);
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRIBUTE_SET.has(name) || name.startsWith('on')) {
        continue;
      }
      if ((name === 'href' || name === 'src') && !isSafeLinkHref(attr.value)) {
        continue;
      }
      cleanEl.setAttribute(name, attr.value);
    }
    for (const child of Array.from(el.childNodes)) {
      const safeChild = cloneSafeNode(child);
      if (safeChild) {
        cleanEl.appendChild(safeChild);
      }
    }
    return cleanEl;
  }

  for (const child of Array.from(parsed.body.childNodes)) {
    const safeChild = cloneSafeNode(child);
    if (safeChild) {
      fragment.appendChild(safeChild);
    }
  }
  return fragment;
}

export async function safeSetPrHtml(
  el: HTMLElement,
  html: string,
  options?: { prUrl?: string },
): Promise<void> {
  if (!html.trim()) {
    el.replaceChildren();
    return;
  }

  if (typeof Element !== 'undefined' && 'setHTML' in Element.prototype) {
    (el as ElementWithSetHTML).setHTML(html, {
      sanitizer: {
        elements: ALLOWED_ELEMENTS,
        attributes: ALLOWED_ATTRIBUTES,
      },
    });
  } else {
    const DOMPurify = await loadDomPurify();
    if (DOMPurify) {
      el.innerHTML = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [...ALLOWED_ELEMENTS, '#text'],
        ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
        ALLOW_ARIA_ATTR: false,
        ALLOW_DATA_ATTR: false,
        KEEP_CONTENT: false,
      });
    } else {
      el.replaceChildren(sanitizeToFragmentFailClosed(html));
    }
  }

  enhancePrHtmlDom(el, options?.prUrl);
}

function enhancePrHtmlDom(container: HTMLElement, prUrl?: string): void {
  for (const anchor of container.querySelectorAll('a')) {
    const href = anchor.getAttribute('href') ?? '';
    if (!isSafeLinkHref(href)) {
      anchor.removeAttribute('href');
      anchor.removeAttribute('target');
      anchor.removeAttribute('rel');
      continue;
    }
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }

  for (const input of container.querySelectorAll('input')) {
    if (input.getAttribute('type')?.toLowerCase() !== 'checkbox') {
      input.remove();
      continue;
    }
    input.disabled = true;
    input.setAttribute('disabled', '');
  }

  for (const table of container.querySelectorAll('table')) {
    if (table.parentElement?.classList.contains('pr-table-wrap')) {
      continue;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'pr-table-wrap';
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  }

  for (const img of container.querySelectorAll('img')) {
    img.addEventListener(
      'error',
      () => {
        if (!img.parentNode) {
          return;
        }
        const fallback = document.createElement('span');
        fallback.className = 'pr-img-fallback';
        const altText = img.getAttribute('alt')?.trim();
        const label = altText ? `Image unavailable (${altText})` : 'Image unavailable';
        if (prUrl && isSafeLinkHref(prUrl)) {
          const link = document.createElement('a');
          link.href = prUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `${label} — view on GitHub`;
          fallback.appendChild(link);
        } else {
          fallback.textContent = label;
        }
        img.replaceWith(fallback);
      },
      { once: true },
    );
  }
}

function extractMermaidSourceFromElement(element: Element): string | null {
  const tag = element.tagName.toLowerCase();
  if (tag === 'pre') {
    if (
      element.classList.contains('pr-mermaid-source') ||
      element.getAttribute('lang')?.toLowerCase() === 'mermaid' ||
      Boolean(element.querySelector(':scope > code.language-mermaid'))
    ) {
      const text = (element.textContent ?? '').trim();
      return text.length > 0 ? text : null;
    }
    return null;
  }

  if (tag === 'div' && element.classList.contains('highlight-source-mermaid')) {
    const pre = element.querySelector('pre');
    if (pre) {
      const text = (pre.textContent ?? '').trim();
      return text.length > 0 ? text : null;
    }
  }

  if (tag === 'div' && !element.className.trim()) {
    const significantChildren = Array.from(element.childNodes).filter(
      (child) =>
        child.nodeType === Node.ELEMENT_NODE ||
        (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim().length > 0),
    );
    if (
      significantChildren.length === 1 &&
      significantChildren[0]!.nodeType === Node.ELEMENT_NODE
    ) {
      return extractMermaidSourceFromElement(significantChildren[0] as Element);
    }
  }

  return null;
}

export function splitPrBodySegments(html: string): PrBodySegment[] {
  const trimmed = html.trim();
  if (!trimmed || typeof document === 'undefined') {
    return trimmed ? [{ kind: 'html', html: trimmed }] : [];
  }

  const template = document.createElement('template');
  template.innerHTML = trimmed;

  const segments: PrBodySegment[] = [];
  let htmlBuffer = '';

  function flushHtmlBuffer(): void {
    const clean = htmlBuffer.trim();
    if (clean) {
      segments.push({ kind: 'html', html: clean });
    }
    htmlBuffer = '';
  }

  for (const node of Array.from(template.content.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const mermaidSource = extractMermaidSourceFromElement(element);
      if (mermaidSource) {
        flushHtmlBuffer();
        segments.push({ kind: 'mermaid', source: mermaidSource });
        continue;
      }
      htmlBuffer += element.outerHTML;
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.trim()) {
        const p = document.createElement('p');
        p.textContent = text.trim();
        htmlBuffer += p.outerHTML;
      }
    }
  }

  flushHtmlBuffer();
  return segments;
}
