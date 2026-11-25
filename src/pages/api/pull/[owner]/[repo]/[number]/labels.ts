import type { APIRoute } from 'astro';
import {
  GitHubApiError,
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  validatePullNumber,
  validateRepoSegment,
} from '@/server/github-client';
import { isAllowedSameOriginPost } from '@/server/origin-guard';
import { sanitizeErrorMessage } from '@/server/redact';
import { getRuntime } from '@/server/runtime';
import type { UpdateLabelsResponse } from '@/types/pr';

export const POST: APIRoute = async ({ params, request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(
      JSON.stringify({
        error: 'Cross-origin label update requests are forbidden',
      }),
      {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }

  const { githubClient, snapshotService, tokenStore } = getRuntime();

  let owner: string;
  let repo: string;
  let number: number;
  let labels: string[];

  try {
    owner = validateRepoSegment(params.owner ?? '', 'owner');
    repo = validateRepoSegment(params.repo ?? '', 'repo');
    number = validatePullNumber(params.number ?? '');

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
    const rawLabels = (parsed as { labels?: unknown }).labels;
    if (!Array.isArray(rawLabels)) {
      throw new GitHubApiError('labels must be an array of strings', 400);
    }
    if (rawLabels.length > 100) {
      throw new GitHubApiError('At most 100 labels may be assigned', 400);
    }
    const seenLower = new Set<string>();
    const deduped: string[] = [];
    for (const item of rawLabels) {
      if (typeof item !== 'string') {
        throw new GitHubApiError('Each label must be a string', 400);
      }
      const trimmed = item.trim();
      if (trimmed.length === 0 || trimmed.length > 100) {
        throw new GitHubApiError('Each label name must be between 1 and 100 characters', 400);
      }
      const lower = trimmed.toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        deduped.push(trimmed);
      }
    }
    labels = deduped;
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: sanitizeErrorMessage(error, tokenStore.peekToken()),
      }),
      {
        status: 400,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }

  try {
    const updated = await githubClient.setPullLabels(owner, repo, number, labels);
    githubClient.invalidatePullDetailCache?.(owner, repo, number);
    snapshotService.invalidateCache(`${owner}/${repo}`);
    const body: UpdateLabelsResponse = { ok: true, labels: updated };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const message = sanitizeErrorMessage(error, tokenStore.peekToken());
    let status = 502;
    if (error instanceof GitHubNotFoundError) {
      status = 404;
    } else if (error instanceof GitHubAuthError) {
      status = 401;
    } else if (error instanceof GitHubRateLimitError) {
      status = 429;
    } else if (error instanceof GitHubApiError) {
      status = error.status;
    }

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }
};
