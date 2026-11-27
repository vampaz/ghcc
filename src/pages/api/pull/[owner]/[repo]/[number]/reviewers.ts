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

function parseStringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new GitHubApiError(`${label} must be an array of strings`, 400);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export const POST: APIRoute = async ({ params, request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(
      JSON.stringify({ error: 'Cross-origin reviewer update requests are forbidden' }),
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
  let addUsers: string[];
  let removeUsers: string[];
  let addTeams: string[];
  let removeTeams: string[];

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
    const obj = parsed as Record<string, unknown>;
    addUsers = parseStringList(obj.addUsers, 'addUsers');
    removeUsers = parseStringList(obj.removeUsers, 'removeUsers');
    addTeams = parseStringList(obj.addTeams, 'addTeams');
    removeTeams = parseStringList(obj.removeTeams, 'removeTeams');

    if (
      addUsers.length === 0 &&
      removeUsers.length === 0 &&
      addTeams.length === 0 &&
      removeTeams.length === 0
    ) {
      throw new GitHubApiError('At least one reviewer change is required', 400);
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: sanitizeErrorMessage(error, tokenStore.peekToken()) }),
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
    const result = await githubClient.updatePullReviewers(owner, repo, number, {
      addUsers,
      removeUsers,
      addTeams,
      removeTeams,
    });
    githubClient.invalidatePullDetailCache?.(owner, repo, number);
    snapshotService.invalidateCache(`${owner}/${repo}`);
    return new Response(JSON.stringify(result), {
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
