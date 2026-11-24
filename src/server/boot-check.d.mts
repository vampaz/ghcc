export declare class BootAuthError extends Error {
  constructor(message: string);
}

export interface ExecResult {
  stdout: string;
  stderr?: string;
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options?: { timeout?: number },
) => Promise<ExecResult>;

export interface BootOptions {
  execFileFn?: ExecFileFn;
  fetchFn?: typeof fetch;
}

export function readGhToken(options?: Pick<BootOptions, 'execFileFn'>): Promise<string>;
export function verifyBootAuth(options?: BootOptions): Promise<{ token: string; login: string }>;
