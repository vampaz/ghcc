// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  extractLogExcerpt,
  isSafeLogRedirectUrl,
  readBoundedLogTail,
  stripAnsi,
} from '@/server/ci-log-excerpt';

describe('ci-log-excerpt', () => {
  it('strips ANSI CSI and OSC escape sequences', () => {
    const raw = '\u001B[31mFAIL\u001B[0m \u001B]0;title\u0007src/app.spec.ts';
    expect(stripAnsi(raw)).toBe('FAIL src/app.spec.ts');
  });

  it('validates safe GitHub and Azure log redirect URLs only', () => {
    expect(
      isSafeLogRedirectUrl(
        'https://pipelines.actions.githubusercontent.com/abc/_apis/pipelines/1/runs/2/signedlogcontent/3?urlExpires=999',
      ),
    ).toBe(true);
    expect(
      isSafeLogRedirectUrl('https://productionresultssa0.blob.core.windows.net/logs/job.txt?sig=1'),
    ).toBe(true);
    expect(isSafeLogRedirectUrl('http://pipelines.actions.githubusercontent.com/log.txt')).toBe(
      false,
    );
    expect(
      isSafeLogRedirectUrl('https://user:pass@pipelines.actions.githubusercontent.com/log.txt'),
    ).toBe(false);
    expect(isSafeLogRedirectUrl('https://evil.example/log.txt')).toBe(false);
    expect(isSafeLogRedirectUrl('not-a-url')).toBe(false);
  });

  it('strips timestamps, identifies failedStep, and focuses around ##[error] lines', () => {
    const lines = [
      '2026-11-24T10:00:00.000Z ##[group]Run npm run test',
      ...Array.from(
        { length: 40 },
        (_, idx) => `2026-11-24T10:00:01.${String(idx).padStart(3, '0')}Z line ${idx}`,
      ),
      '2026-11-24T10:00:02.000Z \u001B[31mAssertionError: expected 1 to be 2\u001B[0m',
      '2026-11-24T10:00:02.100Z ##[error]Process completed with exit code 1.',
      ...Array.from(
        { length: 20 },
        (_, idx) => `2026-11-24T10:00:03.${String(idx).padStart(3, '0')}Z cleanup ${idx}`,
      ),
    ];

    const res = extractLogExcerpt(lines.join('\n'), { maxLines: 25 });
    expect(res.failedStep).toBe('Run npm run test');
    expect(res.truncated).toBe(true);
    expect(res.excerpt).toContain('AssertionError: expected 1 to be 2');
    expect(res.excerpt).toContain('##[error]Process completed with exit code 1.');
    expect(res.excerpt).not.toContain('2026-11-24T10:00:02.000Z');
  });

  it('reads bounded tail from streamed responses and truncates oversized streams', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 50; i++) {
          controller.enqueue(
            encoder.encode(`row-${String(i).padStart(2, '0')}: ${'x'.repeat(20)}\n`),
          );
        }
        controller.close();
      },
    });
    const response = new Response(stream);
    const result = await readBoundedLogTail(response, {
      maxStreamBytes: 2000,
      maxTailBytes: 180,
    });
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('row-49:');
    expect(result.text).not.toContain('row-00:');
  });
});
