export declare class BootAuthError extends Error {
  constructor(message: string);
}

export type TokenSource = 'gh-cli' | 'env';

export interface ExecResult {
  stdout: string;
  stderr?: string;
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { timeout?: number },
) => Promise<ExecResult>;

export type ReadFileFn = (path: string, encoding: 'utf8') => Promise<string>;

export interface BootOptions {
  execFileFn?: ExecFileFn;
  fetchFn?: typeof fetch;
  env?: Record<string, string | undefined>;
  readFileFn?: ReadFileFn;
}

export function readGhCredential(
  options?: Pick<BootOptions, 'execFileFn' | 'env' | 'readFileFn'>,
): Promise<{ token: string; tokenSource: TokenSource }>;
export function readGhToken(
  options?: Pick<BootOptions, 'execFileFn' | 'env' | 'readFileFn'>,
): Promise<string>;
export function verifyBootAuth(
  options?: BootOptions,
): Promise<{ token: string; login: string; tokenSource: TokenSource }>;
