import type { APIRoute } from 'astro';
import {
  GitHubApiError,
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  validateRepoSegment,
} from '@/server/github-client';
import { sanitizeErrorMessage } from '@/server/redact';
import { getRuntime } from '@/server/runtime';
import type { RepoLabelsResponse } from '@/types/pr';

export const GET: APIRoute = async ({ params }) => {
  const { githubClient, tokenStore } = getRuntime();

  let owner: string;
  let repo: string;
  try {
    owner = validateRepoSegment(params.owner ?? '', 'owner');
    repo = validateRepoSegment(params.repo ?? '', 'repo');
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
    const labels = await githubClient.fetchRepoLabels(owner, repo);
    const body: RepoLabelsResponse = {
      repository: `${owner}/${repo}`,
      labels,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=120',
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
