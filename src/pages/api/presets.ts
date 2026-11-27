import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { GitHubApiError } from '@/server/github-client';
import { isAllowedSameOriginPost } from '@/server/origin-guard';
import { sanitizeErrorMessage } from '@/server/redact';
import { getRuntime } from '@/server/runtime';
import type { Bucket, PresetsResponse, SavedFilterPreset } from '@/types/pr';

const VALID_VIEWS = new Set(['all', 'mine', 'review', 'team']);
const VALID_BUCKETS = new Set<'' | Bucket | 'ci-failing'>([
  '',
  'needs-me',
  'ready',
  'waiting',
  'draft',
  'ci-failing',
]);

function parsePresetFilters(raw: unknown): SavedFilterPreset['filters'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GitHubApiError('filters must be a JSON object', 400);
  }
  const obj = raw as Record<string, unknown>;
  const view =
    typeof obj.view === 'string' && VALID_VIEWS.has(obj.view)
      ? (obj.view as SavedFilterPreset['filters']['view'])
      : 'all';
  const bucket =
    typeof obj.bucket === 'string' && VALID_BUCKETS.has(obj.bucket as '' | Bucket | 'ci-failing')
      ? (obj.bucket as SavedFilterPreset['filters']['bucket'])
      : '';
  const q = typeof obj.q === 'string' ? obj.q.slice(0, 200) : '';
  let repos: 'all' | 'none' | string[] = 'all';
  if (obj.repos === 'none') {
    repos = 'none';
  } else if (Array.isArray(obj.repos) && obj.repos.every((item) => typeof item === 'string')) {
    repos = Array.from(new Set(obj.repos.map((r) => r.trim()).filter(Boolean))).sort();
  }
  return {
    view,
    bucket,
    q,
    repos,
    drafts: Boolean(obj.drafts),
    snoozed: Boolean(obj.snoozed),
    staleOnly: Boolean(obj.staleOnly),
  };
}

export const GET: APIRoute = async () => {
  const { stateStore } = getRuntime();
  const presets = await stateStore.getPresets();
  const body: PresetsResponse = { presets };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(JSON.stringify({ error: 'Cross-origin preset requests are forbidden' }), {
      status: 403,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  const { stateStore, tokenStore } = getRuntime();

  try {
    const rawBody = await request.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new GitHubApiError('Invalid JSON request body', 400);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new GitHubApiError('Request body must be a JSON object', 400);
    }
    const obj = parsed as { name?: unknown; filters?: unknown };
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (name.length === 0 || name.length > 60) {
      throw new GitHubApiError('Preset name must be between 1 and 60 characters', 400);
    }

    const preset: SavedFilterPreset = {
      id: `preset-${randomUUID().slice(0, 8)}`,
      name,
      filters: parsePresetFilters(obj.filters),
      createdAt: new Date().toISOString(),
    };
    const presets = await stateStore.savePreset(preset);
    return new Response(JSON.stringify({ preset, presets }), {
      status: 201,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const status = error instanceof GitHubApiError ? error.status : 500;
    return new Response(
      JSON.stringify({ error: sanitizeErrorMessage(error, tokenStore.peekToken()) }),
      {
        status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(JSON.stringify({ error: 'Cross-origin preset requests are forbidden' }), {
      status: 403,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  const { stateStore, tokenStore } = getRuntime();

  try {
    const rawBody = await request.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new GitHubApiError('Invalid JSON request body', 400);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new GitHubApiError('Request body must be a JSON object', 400);
    }
    const id =
      typeof (parsed as { id?: unknown }).id === 'string'
        ? (parsed as { id: string }).id.trim()
        : '';
    if (!id) {
      throw new GitHubApiError('Preset id is required', 400);
    }
    const presets = await stateStore.deletePreset(id);
    return new Response(JSON.stringify({ presets }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const status = error instanceof GitHubApiError ? error.status : 500;
    return new Response(
      JSON.stringify({ error: sanitizeErrorMessage(error, tokenStore.peekToken()) }),
      {
        status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }
};
