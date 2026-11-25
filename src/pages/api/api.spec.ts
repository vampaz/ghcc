// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIContext } from 'astro';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as getHealth } from '@/pages/api/health';
import { GET as getPullDetail } from '@/pages/api/pull/[owner]/[repo]/[number]';
import { POST as postToggleDraft } from '@/pages/api/pull/[owner]/[repo]/[number]/draft';
import { POST as postPullLabels } from '@/pages/api/pull/[owner]/[repo]/[number]/labels';
import { POST as postMergePull } from '@/pages/api/pull/[owner]/[repo]/[number]/merge';
import { POST as postUpdateBranch } from '@/pages/api/pull/[owner]/[repo]/[number]/update-branch';
import { isAllowedSameOriginPost, POST as postRefresh } from '@/pages/api/refresh';
import { GET as getRepoLabels } from '@/pages/api/repo/[owner]/[repo]/labels';
import { GET as getSnapshot } from '@/pages/api/snapshot';
import type { TokenStore } from '@/server/auth';
import {
  FIXTURE_NOW_MS,
  VIEWER_LOGIN,
  fixtureArchivedRepo,
  fixtureNoCiRollup,
} from '@/server/derive/__fixtures__/pull-requests';
import { createGitHubClient } from '@/server/github-client';
import { setRuntimeForTesting } from '@/server/runtime';
import { createSnapshotService } from '@/server/snapshot-service';
import { StateStore } from '@/server/state-store';
import type { SnapshotResponse } from '@/types/pr';

const TEST_SECRET = 'gho_SuperSecretTokenNeverExpose999';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeApiContext(
  request: Request,
  params: Record<string, string | undefined> = {},
): APIContext {
  return {
    request,
    params,
  } as unknown as APIContext;
}

describe('API routes (mocked fetch)', () => {
  const dirs: string[] = [];

  async function setupRuntime(fetchFn: typeof fetch, nowFn: () => number = () => FIXTURE_NOW_MS) {
    const dir = await mkdtemp(join(tmpdir(), 'ghcc-api-'));
    dirs.push(dir);
    const stateStore = new StateStore(join(dir, 'state.json'));
    const tokenStore: TokenStore = {
      getToken: vi.fn<TokenStore['getToken']>().mockResolvedValue(TEST_SECRET),
      reloadToken: vi.fn<TokenStore['reloadToken']>().mockResolvedValue(TEST_SECRET),
      getLogin: vi.fn<TokenStore['getLogin']>().mockResolvedValue(VIEWER_LOGIN),
      getTokenSource: vi.fn<TokenStore['getTokenSource']>().mockReturnValue('gh-cli'),
      peekToken: vi.fn<TokenStore['peekToken']>().mockReturnValue(TEST_SECRET),
    };
    const githubClient = createGitHubClient({ tokenStore, fetchFn, now: nowFn });
    const snapshotService = createSnapshotService({
      tokenStore,
      githubClient,
      stateStore,
      now: nowFn,
    });
    setRuntimeForTesting({ tokenStore, githubClient, stateStore, snapshotService });
    return { snapshotService };
  }

  afterEach(async () => {
    setRuntimeForTesting(null);
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('serves /api/health without leaking token', async () => {
    await setupRuntime(vi.fn<typeof fetch>());
    const res = await getHealth(makeApiContext(new Request('http://127.0.0.1:4321/api/health')));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TEST_SECRET);
    expect(JSON.parse(text)).toEqual({
      gh: 'ok',
      login: VIEWER_LOGIN,
      tokenSource: 'gh-cli',
    });
  });

  it('returns 304 Not Modified when If-None-Match matches Snapshot ETag', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      if (parsed.query?.includes('query Snapshot')) {
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureNoCiRollup],
              },
            },
            rateLimit: {
              limit: 5000,
              cost: 1,
              remaining: 4999,
              resetAt: '2026-11-24T13:00:00.000Z',
            },
          },
        });
      }
      return jsonResponse({
        data: {
          search: { nodes: [] },
          rateLimit: { limit: 5000, cost: 1, remaining: 4998, resetAt: '2026-11-24T13:00:00.000Z' },
        },
      });
    });

    await setupRuntime(fetchFn);

    const first = await getSnapshot(
      makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')),
    );
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await getSnapshot(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/snapshot', {
          headers: { 'if-none-match': etag! },
        }),
      ),
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('handles HTTP 200 GraphQL partial FORBIDDEN/SSO error and strips secret query params', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      if (parsed.query?.includes('query Snapshot')) {
        return jsonResponse(
          {
            data: {
              viewer: {
                login: VIEWER_LOGIN,
                pullRequests: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [fixtureNoCiRollup],
                },
              },
              rateLimit: {
                limit: 5000,
                cost: 1,
                remaining: 4990,
                resetAt: '2026-11-24T13:00:00.000Z',
              },
            },
            errors: [
              {
                type: 'FORBIDDEN',
                message: `Resource protected by organization SAML enforcement (${TEST_SECRET})`,
              },
            ],
          },
          200,
          {
            'x-github-sso':
              'required; url=https://github.com/orgs/acme/sso?authorization_token=secret123',
          },
        );
      }
      return jsonResponse({
        data: {
          search: { nodes: [] },
          rateLimit: { limit: 5000, cost: 1, remaining: 4989, resetAt: '2026-11-24T13:00:00.000Z' },
        },
      });
    });

    await setupRuntime(fetchFn);
    const res = await getSnapshot(
      makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')),
    );
    const text = await res.text();
    expect(text).not.toContain(TEST_SECRET);
    expect(text).not.toContain('authorization_token');

    const body = JSON.parse(text) as SnapshotResponse;
    expect(body.state).toBe('degraded');
    expect(body.pullRequests).toHaveLength(1);
    expect(body.warnings[0]?.code).toBe('sso-required');
    expect(body.warnings[0]?.ssoUrl).toBe('https://github.com/orgs/acme/sso');
  });

  it('handles partial section failure (review queue fails) and enters degraded with cached authored PRs', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      if (parsed.query?.includes('query Snapshot')) {
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureNoCiRollup],
              },
            },
            rateLimit: {
              limit: 5000,
              cost: 1,
              remaining: 4990,
              resetAt: '2026-11-24T13:00:00.000Z',
            },
          },
        });
      }
      if (parsed.query?.includes('query ReviewQueue')) {
        return new Response(`Search backend failure for ${TEST_SECRET}`, { status: 502 });
      }
      return jsonResponse({
        data: {
          repository: {
            pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          },
        },
      });
    });

    await setupRuntime(fetchFn);
    const res = await getSnapshot(
      makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')),
    );
    const text = await res.text();
    expect(text).not.toContain(TEST_SECRET);

    const body = JSON.parse(text) as SnapshotResponse;
    expect(body.state).toBe('degraded');
    expect(body.pullRequests).toHaveLength(1);
    expect(body.warnings[0]?.code).toBe('review-queue-failed');
  });

  it('retains cached snapshot when a subsequent fetch hits 403 rate limit', async () => {
    let nowMs = FIXTURE_NOW_MS;
    let shouldRateLimit = false;
    const resetEpoch = Math.floor((nowMs + 180_000) / 1000);

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (shouldRateLimit) {
        return new Response(`API rate limit exceeded (${TEST_SECRET})`, {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-reset': String(resetEpoch),
          },
        });
      }
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      if (parsed.query?.includes('query Snapshot')) {
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureNoCiRollup],
              },
            },
            rateLimit: {
              limit: 5000,
              cost: 1,
              remaining: 5,
              resetAt: new Date(resetEpoch * 1000).toISOString(),
            },
          },
        });
      }
      return jsonResponse({ data: { search: { nodes: [] } } });
    });

    await setupRuntime(fetchFn, () => nowMs);
    const okRes = await getSnapshot(
      makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')),
    );
    expect((await okRes.json()).state).toBe('ready');

    shouldRateLimit = true;
    nowMs += 95_000;
    const limitedRes = await getSnapshot(
      makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')),
    );
    const text = await limitedRes.text();
    expect(text).not.toContain(TEST_SECRET);
    const body = JSON.parse(text) as SnapshotResponse;
    expect(body.state).toBe('rate-limited');
    expect(body.pullRequests).toHaveLength(1);
    expect(body.warnings[0]?.code).toBe('rate-limited');
  });

  it('rejects cross-origin POST /api/refresh and allows same-origin POST /api/refresh', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          viewer: {
            login: VIEWER_LOGIN,
            pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          },
        },
      }),
    );
    await setupRuntime(fetchFn);

    const crossSite = await postRefresh(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/refresh', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
        }),
      ),
    );
    expect(crossSite.status).toBe(403);

    const foreignOrigin = await postRefresh(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/refresh', {
          method: 'POST',
          headers: { origin: 'http://evil.example:4321', host: '127.0.0.1:4321' },
        }),
      ),
    );
    expect(foreignOrigin.status).toBe(403);

    const noHeaders = await postRefresh(
      makeApiContext(new Request('http://127.0.0.1:4321/api/refresh', { method: 'POST' })),
    );
    expect(noHeaders.status).toBe(403);

    const valid = await postRefresh(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/refresh', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
          },
        }),
      ),
    );
    expect(valid.status).toBe(200);
  });

  it('allows same-origin POST on any host by default and enforces optional GHCC_ALLOWED_HOSTS allowlist', () => {
    const lanDirect = new Request('http://pr-box.local:4321/api/refresh', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin',
        origin: 'http://pr-box.local:4321',
        host: 'pr-box.local:4321',
      },
    });
    expect(isAllowedSameOriginPost(lanDirect, {})).toBe(true);
    expect(isAllowedSameOriginPost(lanDirect, { GHCC_ALLOWED_HOSTS: 'pr-box.local' })).toBe(true);

    const proxiedHttps = new Request('http://127.0.0.1:4321/api/refresh', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin',
        origin: 'https://dashboard.example',
        host: 'ghcc:4321',
        'x-forwarded-host': 'dashboard.example:443',
      },
    });
    expect(isAllowedSameOriginPost(proxiedHttps, {})).toBe(true);
    expect(isAllowedSameOriginPost(proxiedHttps, { GHCC_ALLOWED_HOSTS: 'dashboard.example' })).toBe(
      true,
    );

    const wrongPort = new Request('http://pr-box.local:4321/api/refresh', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin',
        origin: 'http://pr-box.local:9999',
        host: 'pr-box.local:4321',
      },
    });
    expect(isAllowedSameOriginPost(wrongPort, {})).toBe(false);
    expect(isAllowedSameOriginPost(wrongPort, { GHCC_ALLOWED_HOSTS: 'pr-box.local' })).toBe(false);

    const mismatchedOrigin = new Request('http://pr-box.local:4321/api/refresh', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin',
        origin: 'http://evil.example:4321',
        host: 'pr-box.local:4321',
      },
    });
    expect(isAllowedSameOriginPost(mismatchedOrigin, {})).toBe(false);

    const unlistedHost = new Request('http://other.example:4321/api/refresh', {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin',
        origin: 'http://other.example:4321',
        host: 'other.example:4321',
      },
    });
    expect(isAllowedSameOriginPost(unlistedHost, { GHCC_ALLOWED_HOSTS: 'pr-box.local' })).toBe(
      false,
    );
  });

  it('rejects invalid owner/repo/number segments on /api/pull without calling fetch', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await setupRuntime(fetchFn);

    const badOwner = await getPullDetail(
      makeApiContext(new Request('http://127.0.0.1:4321/api/pull/..%2Fetc/repo/1'), {
        owner: '../etc',
        repo: 'repo',
        number: '1',
      }),
    );
    expect(badOwner.status).toBe(400);

    const badNumber = await getPullDetail(
      makeApiContext(new Request('http://127.0.0.1:4321/api/pull/acme/repo/abc'), {
        owner: 'acme',
        repo: 'repo',
        number: 'abc',
      }),
    );
    expect(badNumber.status).toBe(400);

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('filters archived PRs out of /api/snapshot and queries review-requested with archived:false', async () => {
    const queries: string[] = [];
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      const q = parsed.query ?? '';
      queries.push(q);
      if (q.includes('query Snapshot')) {
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureArchivedRepo, fixtureNoCiRollup],
              },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          search: { nodes: [] },
        },
      });
    });

    await setupRuntime(fetchFn);
    const res = await getSnapshot(
      makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SnapshotResponse;

    expect(queries.some((q) => q.includes('archived:false review-requested:@me'))).toBe(true);
    expect(body.pullRequests.map((p) => p.key)).toEqual(['acme/docs#202']);
    expect(body.counts.ready).toBe(1);
    expect(body.counts.waiting).toBe(0);
  });

  it('synchronizes a behind PR branch via GitHub update-branch API, enforces same-origin, and invalidates snapshot cache', async () => {
    const validSha = 'a'.repeat(40);
    let snapshotFetches = 0;
    const calls: Array<{ url: string; method: string; body?: string }> = [];

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });

      if (url.endsWith('/pulls/42/update-branch') && method === 'PUT') {
        return jsonResponse(
          {
            message: 'Updating pull request branch.',
            url: 'https://api.github.com/repos/acme/core-api/pulls/42',
          },
          202,
        );
      }

      const parsed = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      if (parsed.query?.includes('query Snapshot')) {
        snapshotFetches++;
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureNoCiRollup],
              },
            },
          },
        });
      }
      return jsonResponse({ data: { search: { nodes: [] } } });
    });

    await setupRuntime(fetchFn);

    // Cross-origin POST is rejected without calling GitHub
    const forbidden = await postUpdateBranch(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/update-branch', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(forbidden.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();

    // Invalid expectedHeadSha is rejected with 400
    const badSha = await postUpdateBranch(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/update-branch', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ expectedHeadSha: 'not-a-sha' }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(badSha.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();

    // Prime snapshot cache
    await getSnapshot(makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')));
    expect(snapshotFetches).toBe(1);

    // Valid same-origin update-branch call
    const okRes = await postUpdateBranch(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/update-branch', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ expectedHeadSha: validSha }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(okRes.status).toBe(202);
    expect(await okRes.json()).toEqual({
      ok: true,
      message: 'Updating pull request branch.',
      url: 'https://api.github.com/repos/acme/core-api/pulls/42',
    });

    const putCall = calls.find((c) => c.method === 'PUT');
    expect(putCall?.url).toBe('https://api.github.com/repos/acme/core-api/pulls/42/update-branch');
    expect(JSON.parse(putCall?.body ?? '{}')).toEqual({ expected_head_sha: validSha });

    // Next snapshot fetch bypasses TTL because cache was invalidated
    await getSnapshot(makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')));
    expect(snapshotFetches).toBe(2);
  });

  it('redacts tokens and surfaces GitHub 422 errors from update-branch', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ message: `expected head sha does not match (${TEST_SECRET})` }, 422),
      );
    await setupRuntime(fetchFn);

    const res = await postUpdateBranch(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/update-branch', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
          },
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain(TEST_SECRET);
    expect(JSON.parse(text)).toEqual({
      error: 'expected head sha does not match ([REDACTED])',
    });
  });

  it('toggles PR draft state via GitHub GraphQL mutations, enforces same-origin, handles idempotency, and invalidates snapshot cache', async () => {
    let snapshotFetches = 0;
    let currentIsDraft = false;
    const queries: Array<{ query: string; variables: Record<string, unknown> }> = [];

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        query?: string;
        variables?: Record<string, unknown>;
      };
      const q = parsed.query ?? '';
      queries.push({ query: q, variables: parsed.variables ?? {} });

      if (q.includes('query PullNodeId')) {
        return jsonResponse({
          data: {
            repository: {
              pullRequest: { id: 'PR_node_42', isDraft: currentIsDraft },
            },
          },
        });
      }
      if (q.includes('mutation ConvertPullRequestToDraft')) {
        currentIsDraft = true;
        return jsonResponse({
          data: {
            convertPullRequestToDraft: {
              pullRequest: { id: 'PR_node_42', isDraft: true },
            },
          },
        });
      }
      if (q.includes('mutation MarkPullRequestReadyForReview')) {
        currentIsDraft = false;
        return jsonResponse({
          data: {
            markPullRequestReadyForReview: {
              pullRequest: { id: 'PR_node_42', isDraft: false },
            },
          },
        });
      }
      if (q.includes('query Snapshot')) {
        snapshotFetches++;
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ ...fixtureNoCiRollup, isDraft: currentIsDraft }],
              },
            },
          },
        });
      }
      return jsonResponse({ data: { search: { nodes: [] } } });
    });

    await setupRuntime(fetchFn);

    // Cross-origin POST is rejected without calling GitHub
    const forbidden = await postToggleDraft(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/draft', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
          body: JSON.stringify({ draft: true }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(forbidden.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();

    // Non-boolean draft payload is rejected with 400
    const badBody = await postToggleDraft(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/draft', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ draft: 'yes' }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(badBody.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();

    // Prime snapshot cache
    await getSnapshot(makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')));
    expect(snapshotFetches).toBe(1);

    // Convert ready PR -> draft
    const toDraftRes = await postToggleDraft(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/draft', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ draft: true }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(toDraftRes.status).toBe(200);
    expect(await toDraftRes.json()).toEqual({ ok: true, isDraft: true });
    expect(queries.some((q) => q.query.includes('mutation ConvertPullRequestToDraft'))).toBe(true);

    // Idempotent repeat when already draft skips mutation
    const mutationsBeforeRepeat = queries.filter((q) =>
      q.query.includes('mutation ConvertPullRequestToDraft'),
    ).length;
    const repeatDraftRes = await postToggleDraft(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/draft', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ draft: true }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(repeatDraftRes.status).toBe(200);
    expect(
      queries.filter((q) => q.query.includes('mutation ConvertPullRequestToDraft')).length,
    ).toBe(mutationsBeforeRepeat);

    // Next snapshot fetch bypasses TTL because cache was invalidated
    await getSnapshot(makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')));
    expect(snapshotFetches).toBe(2);

    // Mark draft PR -> ready for review
    const toReadyRes = await postToggleDraft(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/draft', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ draft: false }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(toReadyRes.status).toBe(200);
    expect(await toReadyRes.json()).toEqual({ ok: true, isDraft: false });
    expect(queries.some((q) => q.query.includes('mutation MarkPullRequestReadyForReview'))).toBe(
      true,
    );
  });

  it('redacts tokens and maps GraphQL FORBIDDEN errors on /api/pull/.../draft', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { repository: { pullRequest: { id: 'PR_node_42', isDraft: false } } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { convertPullRequestToDraft: null },
          errors: [
            {
              type: 'FORBIDDEN',
              message: `Resource not accessible by integration (${TEST_SECRET})`,
            },
          ],
        }),
      );
    await setupRuntime(fetchFn);

    const res = await postToggleDraft(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/draft', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ draft: true }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain(TEST_SECRET);
    expect(JSON.parse(text)).toEqual({
      error: 'Resource not accessible by integration ([REDACTED])',
    });
  });

  it('merges a PR via GitHub REST merge API (defaulting to squash or regular merge), enforces same-origin, and invalidates snapshot cache', async () => {
    const validSha = 'f'.repeat(40);
    let snapshotFetches = 0;
    const putCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.endsWith('/pulls/42/merge') && method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        putCalls.push({ url, body });
        return jsonResponse({
          sha: '1'.repeat(40),
          merged: true,
          message: 'Pull Request successfully merged',
        });
      }

      const parsed = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      if (parsed.query?.includes('query Snapshot')) {
        snapshotFetches++;
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureNoCiRollup],
              },
            },
          },
        });
      }
      return jsonResponse({ data: { search: { nodes: [] } } });
    });

    await setupRuntime(fetchFn);

    // Cross-origin POST is rejected without calling GitHub
    const forbidden = await postMergePull(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/merge', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
          body: JSON.stringify({ mergeMethod: 'squash' }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(forbidden.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();

    // Invalid mergeMethod is rejected with 400
    const badMethod = await postMergePull(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/merge', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ mergeMethod: 'rebase' }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(badMethod.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();

    // Prime snapshot cache
    await getSnapshot(makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')));
    expect(snapshotFetches).toBe(1);

    // Default squash merge with expectedHeadSha
    const squashRes = await postMergePull(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/merge', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ expectedHeadSha: validSha }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(squashRes.status).toBe(200);
    expect(await squashRes.json()).toEqual({
      ok: true,
      merged: true,
      sha: '1'.repeat(40),
      message: 'Pull Request successfully merged',
      mergeMethod: 'squash',
    });
    expect(putCalls[0]).toEqual({
      url: 'https://api.github.com/repos/acme/core-api/pulls/42/merge',
      body: { merge_method: 'squash', sha: validSha },
    });

    // Cache was invalidated -> next snapshot fetches fresh data
    await getSnapshot(makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')));
    expect(snapshotFetches).toBe(2);

    // Regular merge commit option
    const mergeRes = await postMergePull(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/merge', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ mergeMethod: 'merge' }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(mergeRes.status).toBe(200);
    expect(putCalls[1]).toEqual({
      url: 'https://api.github.com/repos/acme/core-api/pulls/42/merge',
      body: { merge_method: 'merge' },
    });
  });

  it('redacts tokens and surfaces GitHub 405 errors from /api/pull/.../merge', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ message: `Pull Request is not mergeable (${TEST_SECRET})` }, 405),
      );
    await setupRuntime(fetchFn);

    const res = await postMergePull(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/merge', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ mergeMethod: 'squash' }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(res.status).toBe(405);
    const text = await res.text();
    expect(text).not.toContain(TEST_SECRET);
    expect(JSON.parse(text)).toEqual({
      error: 'Pull Request is not mergeable ([REDACTED])',
    });
  });

  it('lists repository labels and updates PR labels via GitHub REST API with same-origin enforcement and cache invalidation', async () => {
    let snapshotFetches = 0;
    const putCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.endsWith('/repos/acme/core-api/labels?per_page=100') && method === 'GET') {
        return jsonResponse([
          { name: 'frontend', color: '1d76db', description: 'UI changes' },
          { name: 'backend', color: '#d73a4a', description: 'Server changes' },
        ]);
      }

      if (url.endsWith('/repos/acme/core-api/issues/42/labels') && method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        putCalls.push({ url, body });
        return jsonResponse([
          { name: 'backend', color: 'd73a4a', description: 'Server changes' },
          { name: 'frontend', color: '1d76db', description: 'UI changes' },
        ]);
      }

      const parsed = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
      if (parsed.query?.includes('query Snapshot')) {
        snapshotFetches++;
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureNoCiRollup],
              },
            },
          },
        });
      }
      return jsonResponse({ data: { search: { nodes: [] } } });
    });

    await setupRuntime(fetchFn);

    // Fetch repo labels -> sorted alphabetically with normalized hex colors
    const listRes = await getRepoLabels(
      makeApiContext(new Request('http://127.0.0.1:4321/api/repo/acme/core-api/labels'), {
        owner: 'acme',
        repo: 'core-api',
      }),
    );
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      repository: 'acme/core-api',
      labels: [
        { name: 'backend', color: 'd73a4a', description: 'Server changes' },
        { name: 'frontend', color: '1d76db', description: 'UI changes' },
      ],
    });

    // Cross-origin POST is rejected
    const forbidden = await postPullLabels(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/labels', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
          body: JSON.stringify({ labels: ['backend'] }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(forbidden.status).toBe(403);

    // Invalid body is rejected with 400
    const badBody = await postPullLabels(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/labels', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ labels: 'backend' }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(badBody.status).toBe(400);

    // Prime snapshot cache
    await getSnapshot(makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')));
    expect(snapshotFetches).toBe(1);

    // Valid same-origin label update
    const okRes = await postPullLabels(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/labels', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ labels: ['backend', 'frontend', 'Backend'] }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({
      ok: true,
      labels: [
        { name: 'backend', color: 'd73a4a', description: 'Server changes' },
        { name: 'frontend', color: '1d76db', description: 'UI changes' },
      ],
    });
    expect(putCalls[0]).toEqual({
      url: 'https://api.github.com/repos/acme/core-api/issues/42/labels',
      body: { labels: ['backend', 'frontend'] },
    });

    // Snapshot cache invalidated
    await getSnapshot(makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')));
    expect(snapshotFetches).toBe(2);
  });

  it('retries transient GitHub GraphQL timeouts with adaptive page shrink and caches repo labels and PR detail', async () => {
    const repoPullFirstArgs: number[] = [];
    let repoLabelFetches = 0;
    let pullDetailFetches = 0;

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.endsWith('/repos/acme/core-api/labels?per_page=100') && method === 'GET') {
        repoLabelFetches++;
        return jsonResponse([{ name: 'bug', color: 'd73a4a', description: 'Bug' }]);
      }

      if (url.endsWith('/repos/acme/core-api/issues/42/labels') && method === 'PUT') {
        return jsonResponse([{ name: 'bug', color: 'd73a4a', description: 'Bug' }]);
      }

      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        query?: string;
        variables?: { first?: number };
      };

      if (parsed.query?.includes('query RepoPulls')) {
        const firstArg = parsed.variables?.first ?? 0;
        repoPullFirstArgs.push(firstArg);
        // Simulate GitHub GraphQL timeout for first=12 (fails both executeGraphql attempts), succeeds when shrunk to first=6
        if (firstArg >= 12) {
          return jsonResponse({
            data: null,
            errors: [
              {
                message:
                  'Something went wrong while executing your query on 2026-11-25T16:37:08Z. Please include `TEST:123` when reporting this issue.',
              },
            ],
          });
        }
        return jsonResponse({
          data: {
            repository: {
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureNoCiRollup],
              },
            },
          },
        });
      }

      if (parsed.query?.includes('query PullDetail')) {
        pullDetailFetches++;
        return jsonResponse({
          data: {
            repository: {
              pullRequest: {
                number: 42,
                title: 'Cached detail PR',
                url: 'https://github.com/acme/core-api/pull/42',
                isDraft: false,
                bodyText: 'Body',
                baseRefName: 'main',
                headRefName: 'feat/cache',
                latestReviews: { nodes: [] },
                reviewRequests: { nodes: [] },
                commits: { nodes: [] },
                timelineItems: { nodes: [] },
              },
            },
          },
        });
      }

      if (parsed.query?.includes('query Snapshot')) {
        return jsonResponse({
          data: {
            viewer: {
              login: VIEWER_LOGIN,
              pullRequests: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [fixtureNoCiRollup],
              },
            },
          },
        });
      }

      return jsonResponse({ data: { search: { nodes: [] } } });
    });

    await setupRuntime(fetchFn);

    // Snapshot recovers from GraphQL timeout on first=12 by shrinking RepoPulls to first=6
    const snapRes = await getSnapshot(
      makeApiContext(new Request('http://127.0.0.1:4321/api/snapshot')),
    );
    expect(snapRes.status).toBe(200);
    const snapBody = (await snapRes.json()) as { state: string; warnings: unknown[] };
    expect(snapBody.state).toBe('ready');
    expect(snapBody.warnings).toHaveLength(0);
    expect(repoPullFirstArgs).toEqual([12, 12, 6]);

    // Repo labels are cached across repeated requests
    await getRepoLabels(
      makeApiContext(new Request('http://127.0.0.1:4321/api/repo/acme/core-api/labels'), {
        owner: 'acme',
        repo: 'core-api',
      }),
    );
    await getRepoLabels(
      makeApiContext(new Request('http://127.0.0.1:4321/api/repo/acme/core-api/labels'), {
        owner: 'acme',
        repo: 'core-api',
      }),
    );
    expect(repoLabelFetches).toBe(1);

    // PR detail is cached within 30s and invalidated by mutations
    await getPullDetail(
      makeApiContext(new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42'), {
        owner: 'acme',
        repo: 'core-api',
        number: '42',
      }),
    );
    await getPullDetail(
      makeApiContext(new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42'), {
        owner: 'acme',
        repo: 'core-api',
        number: '42',
      }),
    );
    expect(pullDetailFetches).toBe(1);

    await postPullLabels(
      makeApiContext(
        new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42/labels', {
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            origin: 'http://127.0.0.1:4321',
            host: '127.0.0.1:4321',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ labels: ['bug'] }),
        }),
        { owner: 'acme', repo: 'core-api', number: '42' },
      ),
    );
    await getPullDetail(
      makeApiContext(new Request('http://127.0.0.1:4321/api/pull/acme/core-api/42'), {
        owner: 'acme',
        repo: 'core-api',
        number: '42',
      }),
    );
    expect(pullDetailFetches).toBe(2);
  });
});
