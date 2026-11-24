import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

export class BootAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootAuthError';
  }
}

function redact(input, secret) {
  let out = String(input).replace(TOKEN_PATTERN, '[REDACTED]');
  if (secret && secret.length >= 6) {
    out = out.split(secret).join('[REDACTED]');
  }
  return out;
}

export async function readGhToken(options = {}) {
  const run = options.execFileFn ?? execFileAsync;

  try {
    await run('gh', ['auth', 'status'], { timeout: 10_000 });
  } catch (error) {
    const detail = error instanceof Error ? redact(error.message) : '';
    const suffix = detail ? ` (${detail.split('\n')[0]})` : '';
    throw new BootAuthError(`GitHub CLI is not logged in${suffix}. run: gh auth login`);
  }

  let token = '';
  try {
    const result = await run('gh', ['auth', 'token'], { timeout: 10_000 });
    token = String(result.stdout ?? '').trim();
  } catch (error) {
    throw new BootAuthError(
      `Failed to read token from gh CLI (${redact(error instanceof Error ? error.message : error)}). run: gh auth login`,
    );
  }

  if (!token) {
    throw new BootAuthError('gh auth token returned an empty credential. run: gh auth login');
  }

  return token;
}

export async function verifyBootAuth(options = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const token = await readGhToken(options);

  let response;
  try {
    response = await fetchFn('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'ghcc/0.1',
      },
      body: JSON.stringify({ query: 'query ViewerBootCheck { viewer { login } }' }),
    });
  } catch (error) {
    throw new BootAuthError(
      `Failed to verify GitHub token at startup: ${redact(error instanceof Error ? error.message : error, token)}`,
    );
  }

  if (response.status === 401) {
    throw new BootAuthError(
      'GitHub rejected the gh CLI token (401 Unauthorized). run: gh auth login',
    );
  }

  if (!response.ok) {
    throw new BootAuthError(
      `GitHub token verification failed with HTTP ${response.status}. Check gh auth status.`,
    );
  }

  const payload = await response.json();
  const login = payload?.data?.viewer?.login;
  if (typeof login !== 'string' || login.length === 0) {
    const errMsg = payload?.errors?.[0]?.message
      ? redact(payload.errors[0].message, token)
      : 'missing viewer.login';
    throw new BootAuthError(`GitHub token verification failed (${errMsg}). run: gh auth login`);
  }

  return { token, login };
}
