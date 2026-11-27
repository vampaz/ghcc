import sanitizeHtml from 'sanitize-html';

const MAX_RAW_BODY_HTML_CHARS = 250_000;
const GITHUB_ORIGIN = 'https://github.com';

const ALLOWED_TAGS: string[] = [
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

const SAFE_DIV_CLASS_RE =
  /^(markdown-alert(?:-(?:note|tip|important|warning|caution))?|highlight(?:-source-[a-z0-9_+-]+)?)$/;
const SAFE_SPAN_CLASS_RE = /^pl-[a-z0-9-]+$/;

function filterClasses(
  rawClass: string | undefined,
  predicate: (token: string) => boolean,
): string | undefined {
  if (!rawClass) {
    return undefined;
  }
  const kept = rawClass
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && predicate(token));
  return kept.length > 0 ? kept.join(' ') : undefined;
}

function hasClassToken(rawClass: string | undefined, target: string): boolean {
  if (!rawClass) {
    return false;
  }
  return rawClass.split(/\s+/).includes(target);
}

function normalizeHttpUrl(rawUrl: string | undefined, allowMailto: boolean): string | null {
  if (!rawUrl) {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return null;
  }
  const candidate = trimmed.startsWith('/') ? `${GITHUB_ORIGIN}${trimmed}` : trimmed;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol === 'https:' ||
      parsed.protocol === 'http:' ||
      (allowMailto && parsed.protocol === 'mailto:')
    ) {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeAlign(rawAlign: string | undefined): string | undefined {
  if (!rawAlign) {
    return undefined;
  }
  const lower = rawAlign.trim().toLowerCase();
  return lower === 'left' || lower === 'center' || lower === 'right' ? lower : undefined;
}

function normalizePositiveIntAttr(rawValue: string | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }
  const trimmed = rawValue.trim();
  return /^[1-9]\d{0,3}$/.test(trimmed) ? trimmed : undefined;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPlainTextFallbackHtml(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return '';
  }
  const clipped = trimmed.length > 4_000 ? `${trimmed.slice(0, 3_997)}...` : trimmed;
  return `<p>${escapeHtmlText(clipped).replace(/\r?\n/g, '<br />')}</p>`;
}

const DROP_SENTINEL_CLASS = '__ghcc-drop';
const DROP_ELEMENT_CLASSES = new Set([
  'anchor',
  'zeroclipboard-container',
  'js-render-enrichment-loader',
  'sr-only',
  'render-viewer-error',
  'render-viewer-fatal',
  'render-viewer-invalid',
]);

function hasDropClass(rawClass: string | undefined): boolean {
  if (!rawClass) {
    return false;
  }
  return rawClass.split(/\s+/).some((token) => DROP_ELEMENT_CLASSES.has(token));
}

function classAttribs(className: string | undefined): Record<string, string> {
  return className ? { class: className } : {};
}

export function sanitizePrBodyHtml(
  rawHtml: string | null | undefined,
  fallbackBodyText?: string | null,
): string {
  const trimmed = (rawHtml ?? '').trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length > MAX_RAW_BODY_HTML_CHARS) {
    return buildPlainTextFallbackHtml(fallbackBodyText ?? '');
  }

  return sanitizeHtml(trimmed, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      abbr: ['title'],
      code: ['class'],
      details: ['open'],
      div: ['class'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'referrerpolicy'],
      input: ['type', 'checked', 'disabled', 'class'],
      li: ['class'],
      ol: ['start', 'class'],
      p: ['class'],
      pre: ['class'],
      span: ['class'],
      td: ['align', 'colspan', 'rowspan'],
      th: ['align', 'colspan', 'rowspan'],
      ul: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: [
      'script',
      'style',
      'textarea',
      'option',
      'noscript',
      'iframe',
      'object',
      'embed',
      'svg',
      'math',
      'template',
      'button',
      'form',
      'select',
      'clipboard-copy',
    ],
    exclusiveFilter(frame) {
      if (hasClassToken(frame.attribs.class, DROP_SENTINEL_CLASS)) {
        return true;
      }
      if (frame.tag === 'input' && frame.attribs.type?.toLowerCase() !== 'checkbox') {
        return true;
      }
      return false;
    },
    transformTags: {
      a(_tagName, attribs) {
        if (hasDropClass(attribs.class)) {
          return { tagName: 'a', attribs: { class: DROP_SENTINEL_CLASS } };
        }
        const href = normalizeHttpUrl(attribs.href, true);
        if (!href) {
          return { tagName: 'span', attribs: {} };
        }
        const next: Record<string, string> = {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
        };
        if (attribs.title) {
          next.title = attribs.title;
        }
        return { tagName: 'a', attribs: next };
      },
      img(_tagName, attribs) {
        const src = normalizeHttpUrl(attribs.src, false);
        if (!src) {
          return { tagName: 'span', attribs: {} };
        }
        const next: Record<string, string> = {
          src,
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
        };
        if (attribs.alt !== undefined) {
          next.alt = attribs.alt;
        }
        if (attribs.title) {
          next.title = attribs.title;
        }
        const width = normalizePositiveIntAttr(attribs.width);
        const height = normalizePositiveIntAttr(attribs.height);
        if (width) {
          next.width = width;
        }
        if (height) {
          next.height = height;
        }
        return { tagName: 'img', attribs: next };
      },
      input(_tagName, attribs) {
        const next: Record<string, string> = {
          type: 'checkbox',
          disabled: '',
          class: 'task-list-item-checkbox',
        };
        if (attribs.checked !== undefined) {
          next.checked = '';
        }
        return { tagName: 'input', attribs: next };
      },
      pre(_tagName, attribs) {
        const isMermaid =
          attribs.lang?.trim().toLowerCase() === 'mermaid' ||
          hasClassToken(attribs.class, 'pr-mermaid-source');
        return {
          tagName: 'pre',
          attribs: classAttribs(isMermaid ? 'pr-mermaid-source' : undefined),
        };
      },
      code(_tagName, attribs) {
        const isMermaid =
          hasClassToken(attribs.class, 'language-mermaid') ||
          hasClassToken(attribs.class, 'lang-mermaid');
        return {
          tagName: 'code',
          attribs: classAttribs(isMermaid ? 'language-mermaid' : undefined),
        };
      },
      div(_tagName, attribs) {
        if (hasDropClass(attribs.class)) {
          return { tagName: 'div', attribs: { class: DROP_SENTINEL_CLASS } };
        }
        const safeClass = filterClasses(attribs.class, (token) => SAFE_DIV_CLASS_RE.test(token));
        return {
          tagName: 'div',
          attribs: classAttribs(safeClass),
        };
      },
      p(_tagName, attribs) {
        if (hasDropClass(attribs.class)) {
          return { tagName: 'p', attribs: { class: DROP_SENTINEL_CLASS } };
        }
        const safeClass = filterClasses(attribs.class, (token) => token === 'markdown-alert-title');
        return {
          tagName: 'p',
          attribs: classAttribs(safeClass),
        };
      },
      span(_tagName, attribs) {
        if (hasDropClass(attribs.class)) {
          return { tagName: 'span', attribs: { class: DROP_SENTINEL_CLASS } };
        }
        const safeClass = filterClasses(attribs.class, (token) => SAFE_SPAN_CLASS_RE.test(token));
        return {
          tagName: 'span',
          attribs: classAttribs(safeClass),
        };
      },
      ul(_tagName, attribs) {
        const safeClass = filterClasses(attribs.class, (token) => token === 'contains-task-list');
        return {
          tagName: 'ul',
          attribs: classAttribs(safeClass),
        };
      },
      ol(_tagName, attribs) {
        const next: Record<string, string> = {};
        const start = normalizePositiveIntAttr(attribs.start);
        if (start) {
          next.start = start;
        }
        const safeClass = filterClasses(attribs.class, (token) => token === 'contains-task-list');
        if (safeClass) {
          next.class = safeClass;
        }
        return { tagName: 'ol', attribs: next };
      },
      li(_tagName, attribs) {
        const safeClass = filterClasses(attribs.class, (token) => token === 'task-list-item');
        return {
          tagName: 'li',
          attribs: classAttribs(safeClass),
        };
      },
      td(_tagName, attribs) {
        return { tagName: 'td', attribs: filterTableCellAttrs(attribs) };
      },
      th(_tagName, attribs) {
        return { tagName: 'th', attribs: filterTableCellAttrs(attribs) };
      },
    },
  }).trim();
}

function filterTableCellAttrs(attribs: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  const align = normalizeAlign(attribs.align);
  if (align) {
    next.align = align;
  }
  const colspan = normalizePositiveIntAttr(attribs.colspan);
  if (colspan) {
    next.colspan = colspan;
  }
  const rowspan = normalizePositiveIntAttr(attribs.rowspan);
  if (rowspan) {
    next.rowspan = rowspan;
  }
  return next;
}
