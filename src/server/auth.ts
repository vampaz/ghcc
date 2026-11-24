import {
  BootAuthError,
  readGhCredential,
  verifyBootAuth,
  type BootOptions,
  type ExecFileFn,
  type TokenSource,
} from './boot-check.mjs';

export { BootAuthError };

export interface TokenStore {
  getToken(): Promise<string>;
  reloadToken(): Promise<string>;
  getLogin(): Promise<string>;
  getTokenSource(): TokenSource;
  peekToken(): string | null;
}

export function createTokenStore(options: BootOptions = {}): TokenStore {
  let cachedToken: string | null = null;
  let cachedLogin: string | null = null;
  let cachedTokenSource: TokenSource = 'gh-cli';
  let inFlightLoad: Promise<string> | null = null;

  async function load(forceVerify: boolean): Promise<string> {
    if (inFlightLoad) {
      return inFlightLoad;
    }

    inFlightLoad = (async () => {
      if (forceVerify || !cachedLogin) {
        const result = await verifyBootAuth(options);
        cachedToken = result.token;
        cachedLogin = result.login;
        cachedTokenSource = result.tokenSource;
        return result.token;
      }
      const credential = await readGhCredential({
        execFileFn: options.execFileFn,
        env: options.env,
        readFileFn: options.readFileFn,
      });
      cachedToken = credential.token;
      cachedTokenSource = credential.tokenSource;
      return credential.token;
    })();

    try {
      return await inFlightLoad;
    } finally {
      inFlightLoad = null;
    }
  }

  return {
    async getToken(): Promise<string> {
      if (cachedToken) {
        return cachedToken;
      }
      return load(true);
    },

    async reloadToken(): Promise<string> {
      cachedToken = null;
      return load(true);
    },

    async getLogin(): Promise<string> {
      if (cachedLogin) {
        return cachedLogin;
      }
      await load(true);
      if (!cachedLogin) {
        throw new BootAuthError('Unable to resolve GitHub login. run: gh auth login');
      }
      return cachedLogin;
    },

    getTokenSource(): TokenSource {
      return cachedTokenSource;
    },

    peekToken(): string | null {
      return cachedToken;
    },
  };
}

export type { BootOptions, ExecFileFn, TokenSource };
