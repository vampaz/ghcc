import { describe, expect, it, vi } from 'vitest';
import { type BootOptions, BootAuthError, createTokenStore } from '@/server/auth';
import { verifyBootAuth } from '@/server/boot-check.mjs';
import { redactToken, sanitizeErrorMessage } from '@/server/redact';

type ExecFn = NonNullable<BootOptions['execFileFn']>;

describe('auth & redaction', () => {
  it('redacts GitHub tokens and explicit secret strings from errors', () => {
    const fakeSecret = 'gho_secretTokenValue1234567890';
    const input = `Request failed with Bearer ${fakeSecret} and github_pat_ABCDEFGHIJKLMNOPQRSTUV`;
    expect(redactToken(input, fakeSecret)).toBe(
      'Request failed with Bearer [REDACTED] and [REDACTED]',
    );
    expect(sanitizeErrorMessage(new Error(`bad ${fakeSecret}`), fakeSecret)).toBe('bad [REDACTED]');
  });

  it('fails closed when gh auth status fails and instructs user to run gh auth login', async () => {
    const execFileFn = vi
      .fn<ExecFn>()
      .mockRejectedValueOnce(new Error('not logged into any GitHub hosts'));

    await expect(verifyBootAuth({ execFileFn })).rejects.toThrow(/run: gh auth login/);
  });

  it('fails closed when GitHub returns 401 and never includes the token in the error', async () => {
    const secret = 'gho_topSecretTestToken987654321';
    const execFileFn = vi
      .fn<ExecFn>()
      .mockResolvedValueOnce({ stdout: 'Logged in' })
      .mockResolvedValueOnce({ stdout: `${secret}\n` });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    let caught: unknown;
    try {
      await verifyBootAuth({ execFileFn, fetchFn });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BootAuthError);
    expect((caught as Error).message).toMatch(/401 Unauthorized/);
    expect((caught as Error).message).not.toContain(secret);
  });

  it('caches token in memory and reloads on demand', async () => {
    const execFileFn = vi
      .fn<ExecFn>()
      .mockResolvedValueOnce({ stdout: 'ok' })
      .mockResolvedValueOnce({ stdout: 'gho_firstToken1234567890\n' })
      .mockResolvedValueOnce({ stdout: 'ok' })
      .mockResolvedValueOnce({ stdout: 'gho_secondToken1234567890\n' });
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { viewer: { login: 'octocat' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const store = createTokenStore({ execFileFn, fetchFn });
    expect(await store.getToken()).toBe('gho_firstToken1234567890');
    expect(await store.getLogin()).toBe('octocat');
    expect(execFileFn).toHaveBeenCalledTimes(2);

    expect(await store.reloadToken()).toBe('gho_secondToken1234567890');
    expect(execFileFn).toHaveBeenCalledTimes(4);
  });
});
