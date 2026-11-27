import { describe, expect, it } from 'vitest';
import { sanitizePrBodyHtml } from '@/server/sanitize-pr-html';

describe('sanitizePrBodyHtml', () => {
  it('preserves GitHub tables, headings, alerts, task lists, and syntax spans', () => {
    const raw = `
      <div class="markdown-heading" dir="auto">
        <h2 class="heading-element" dir="auto">Summary</h2>
        <a id="user-content-summary" class="anchor" href="#summary"><svg><path d="M0 0"/></svg></a>
      </div>
      <div class="markdown-alert markdown-alert-note" dir="auto">
        <p class="markdown-alert-title"><svg></svg>Note</p>
        <p>Check <a href="/org/repo/pull/42">#42</a>.</p>
      </div>
      <ul class="contains-task-list">
        <li class="task-list-item">
          <input type="checkbox" id="cb1" class="task-list-item-checkbox" checked="" disabled="">
          Done
        </li>
      </ul>
      <div class="highlight highlight-source-ts">
        <pre><span class="pl-k">const</span> x = <span class="pl-c1">1</span>;</pre>
      </div>
      <table>
        <thead><tr><th align="left">Finding</th><th>Fix</th></tr></thead>
        <tbody><tr><td>One</td><td>Two</td></tr></tbody>
      </table>
    `;

    const out = sanitizePrBodyHtml(raw);
    expect(out).toContain('<h2>Summary</h2>');
    expect(out).not.toContain('class="anchor"');
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('id="user-content-summary"');
    expect(out).toContain('<div class="markdown-alert markdown-alert-note">');
    expect(out).toContain('<p class="markdown-alert-title">Note</p>');
    expect(out).toContain(
      '<a href="https://github.com/org/repo/pull/42" target="_blank" rel="noopener noreferrer">#42</a>',
    );
    expect(out).toContain(
      '<input type="checkbox" disabled class="task-list-item-checkbox" checked />',
    );
    expect(out).toContain('<span class="pl-k">const</span>');
    expect(out).toContain('<table>');
    expect(out).toContain('<th align="left">Finding</th>');
  });

  it('normalizes mermaid blocks across GitHub HTML shapes', () => {
    const langPre = sanitizePrBodyHtml(
      '<pre lang="mermaid" class="notranslate"><code>flowchart LR\n  A --&gt; B</code></pre>',
    );
    expect(langPre).toBe(
      '<pre class="pr-mermaid-source"><code>flowchart LR\n  A --&gt; B</code></pre>',
    );

    const highlightDiv = sanitizePrBodyHtml(
      '<div class="highlight highlight-source-mermaid"><pre>graph TD\n  A --&gt; B</pre></div>',
    );
    expect(highlightDiv).toContain('<div class="highlight highlight-source-mermaid">');

    const codeClass = sanitizePrBodyHtml(
      '<pre><code class="language-mermaid">sequenceDiagram\n  A-&gt;&gt;B: Hi</code></pre>',
    );
    expect(codeClass).toContain('<code class="language-mermaid">');

    const githubEnrichment = sanitizePrBodyHtml(`
      <section class="js-render-needs-enrichment" data-type="mermaid">
        <div class="js-render-enrichment-target">
          <div class="render-plaintext-hidden">
            <pre lang="mermaid" class="notranslate">flowchart LR\n  A --&gt; B</pre>
          </div>
        </div>
        <span class="js-render-enrichment-loader">
          <span data-view-component="true"><svg></svg><span class="sr-only">Loading</span></span>
        </span>
      </section>
    `);
    expect(githubEnrichment).toContain('<pre class="pr-mermaid-source">');
    expect(githubEnrichment).not.toContain('Loading');
  });

  it('strips scripts, event handlers, javascript URLs, non-checkbox inputs, and clipboard chrome', () => {
    const raw = `
      <p onclick="alert(1)">Hello</p>
      <script>alert('xss')</script>
      <iframe src="https://evil.test"></iframe>
      <a href="javascript:alert(1)">Bad link</a>
      <a href="#local-jump">Local</a>
      <img src="https://img.example.com/a.png" onerror="alert(1)" alt="shot" />
      <img src="data:image/svg+xml,<svg/>" alt="data" />
      <input type="text" value="secret" />
      <div class="zeroclipboard-container"><button>Copy</button></div>
    `;

    const out = sanitizePrBodyHtml(raw);
    expect(out).toContain('<p>Hello</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('#local-jump');
    expect(out).toContain('<span>Bad link</span>');
    expect(out).toContain('<span>Local</span>');
    expect(out).toContain(
      '<img src="https://img.example.com/a.png" loading="lazy" referrerpolicy="no-referrer" alt="shot" />',
    );
    expect(out).not.toContain('data:image');
    expect(out).not.toContain('type="text"');
    expect(out).not.toContain('zeroclipboard-container');
    expect(out).not.toContain('<button');
  });

  it('falls back safely when raw bodyHTML exceeds the size limit', () => {
    const huge = `<p>${'a'.repeat(260_000)}</p>`;
    const out = sanitizePrBodyHtml(huge, 'Fallback <text>\nLine 2');
    expect(out).toBe('<p>Fallback &lt;text&gt;<br />Line 2</p>');
  });
});
