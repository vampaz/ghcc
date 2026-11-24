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

    await expect(verifyBootAuth({ execFileFn, env: {} })).rejects.toThrow(/run: gh auth login/);
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
      await verifyBootAuth({ execFileFn, fetchFn, env: {} });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BootAuthError);
    expect((caught as Error).message).toMatch(/401 Unauthorized/);
    expect((caught as Error).message).not.toContain(secret);
  });

  it('uses GH_TOKEN from env without calling gh CLI and reports tokenSource env', async () => {
    const secret = 'ghp_envSecretToken1234567890';
    const execFileFn = vi.fn<ExecFn>();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { viewer: { login: 'octocat' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const store = createTokenStore({ execFileFn, fetchFn, env: { GH_TOKEN: `  ${secret}\n` } });
    expect(await store.getToken()).toBe(secret);
    expect(await store.getLogin()).toBe('octocat');
    expect(store.getTokenSource()).toBe('env');
    expect(execFileFn).not.toHaveBeenCalled();

    const fallbackFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { viewer: { login: 'octocat' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const fallbackResult = await verifyBootAuth({
      execFileFn,
      fetchFn: fallbackFetch,
      env: { GH_TOKEN: '   ', GITHUB_TOKEN: secret },
    });
    expect(fallbackResult.token).toBe(secret);
    expect(execFileFn).not.toHaveBeenCalled();
  });

  it('reads token from GH_TOKEN_FILE and fails closed if empty or unreadable', async () => {
    const secret = 'github_pat_FileSecretToken1234567890';
    const execFileFn = vi.fn<ExecFn>();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { viewer: { login: 'octocat' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await verifyBootAuth({
      execFileFn,
      fetchFn,
      env: { GH_TOKEN_FILE: '/run/secrets/gh_token' },
      readFileFn: async () => `${secret}\n`,
    });
    expect(result).toEqual({ token: secret, login: 'octocat', tokenSource: 'env' });
    expect(execFileFn).not.toHaveBeenCalled();

    await expect(
      verifyBootAuth({
        execFileFn,
        fetchFn,
        env: { GH_TOKEN_FILE: '/run/secrets/empty' },
        readFileFn: async () => '   \n',
      }),
    ).rejects.toThrow(/GH_TOKEN_FILE is empty/);

    await expect(
      verifyBootAuth({
        execFileFn,
        fetchFn,
        env: { GH_TOKEN_FILE: '/run/secrets/missing' },
        readFileFn: async () => {
          throw new Error('ENOENT');
        },
      }),
    ).rejects.toThrow(/Failed to read GitHub token from GH_TOKEN_FILE/);
  });

  it('redacts rejected env token on 401 and points to env vars instead of gh auth login', async () => {
    const secret = 'ghp_rejectedEnvToken1234567890';
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    let caught: unknown;
    try {
      await verifyBootAuth({ fetchFn, env: { GITHUB_TOKEN: secret } });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BootAuthError);
    expect((caught as Error).message).toMatch(/GH_TOKEN/);
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

    const store = createTokenStore({ execFileFn, fetchFn, env: {} });
    expect(await store.getToken()).toBe('gho_firstToken1234567890');
    expect(await store.getLogin()).toBe('octocat');
    expect(store.getTokenSource()).toBe('gh-cli');
    expect(execFileFn).toHaveBeenCalledTimes(2);

    expect(await store.reloadToken()).toBe('gho_secondToken1234567890');
    expect(execFileFn).toHaveBeenCalledTimes(4);
  });
});
