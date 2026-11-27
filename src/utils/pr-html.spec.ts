import { describe, expect, it } from 'vitest';
import { safeSetPrHtml, splitPrBodySegments } from '@/utils/pr-html';

describe('pr-html utilities', () => {
  it('splits top-level mermaid blocks across all GitHub HTML shapes while preserving surrounding HTML', () => {
    const html = [
      '<h2>Summary</h2><p>Intro</p>',
      '<pre class="pr-mermaid-source"><code>flowchart LR\n  A --&gt; B</code></pre>',
      '<p>Middle</p>',
      '<div class="highlight highlight-source-mermaid"><pre>graph TD\n  C --&gt; D</pre></div>',
      '<div><div><pre class="pr-mermaid-source">flowchart TB\n  E --&gt; F</pre></div></div>',
      '<pre><code class="language-mermaid">sequenceDiagram\n  A-&gt;&gt;B: Ping</code></pre>',
      '<p>Outro</p>',
    ].join('');

    const segments = splitPrBodySegments(html);
    expect(segments).toEqual([
      { kind: 'html', html: '<h2>Summary</h2><p>Intro</p>' },
      { kind: 'mermaid', source: 'flowchart LR\n  A --> B' },
      { kind: 'html', html: '<p>Middle</p>' },
      { kind: 'mermaid', source: 'graph TD\n  C --> D' },
      { kind: 'mermaid', source: 'flowchart TB\n  E --> F' },
      { kind: 'mermaid', source: 'sequenceDiagram\n  A->>B: Ping' },
      { kind: 'html', html: '<p>Outro</p>' },
    ]);
  });

  it('sanitizes untrusted HTML, hardens links/inputs, wraps tables, and replaces broken images', async () => {
    const host = document.createElement('div');
    await safeSetPrHtml(
      host,
      `
        <p onclick="alert(1)">Safe <a href="https://github.com/org/repo/pull/1">#1</a> <a href="javascript:alert(1)">Bad</a></p>
        <script>window.__xss = true</script>
        <input type="checkbox" checked />
        <input type="text" value="drop" />
        <table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Val</td></tr></tbody></table>
        <img src="https://github.com/user-attachments/assets/abc" alt="Diagram" />
      `,
      { prUrl: 'https://github.com/org/repo/pull/1' },
    );

    expect(host.querySelector('script')).toBeNull();
    const links = host.querySelectorAll('a');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('href')).toBe('https://github.com/org/repo/pull/1');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[0]!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1]!.getAttribute('href')).toBeNull();

    const inputs = host.querySelectorAll('input');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.type).toBe('checkbox');
    expect(inputs[0]!.disabled).toBe(true);

    const wrappedTable = host.querySelector('.pr-table-wrap > table');
    expect(wrappedTable).not.toBeNull();

    const img = host.querySelector('img');
    expect(img).not.toBeNull();
    img!.dispatchEvent(new Event('error'));
    const fallback = host.querySelector('.pr-img-fallback a');
    expect(fallback?.textContent).toContain('Image unavailable (Diagram)');
    expect(fallback?.getAttribute('href')).toBe('https://github.com/org/repo/pull/1');
  });
});
