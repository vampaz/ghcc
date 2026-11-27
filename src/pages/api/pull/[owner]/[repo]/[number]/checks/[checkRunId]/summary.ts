import type { APIRoute } from 'astro';
import {
  GitHubApiError,
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  validatePositiveIntId,
  validatePullNumber,
  validateRepoSegment,
} from '@/server/github-client';
import { sanitizeErrorMessage } from '@/server/redact';
import { getRuntime } from '@/server/runtime';

export const GET: APIRoute = async ({ params, request }) => {
  const { githubClient, tokenStore } = getRuntime();

  let owner: string;
  let repo: string;
  let checkRunId: number;

  try {
    owner = validateRepoSegment(params.owner ?? '', 'owner');
    repo = validateRepoSegment(params.repo ?? '', 'repo');
    validatePullNumber(params.number ?? '');
    checkRunId = validatePositiveIntId(params.checkRunId ?? '', 'checkRunId');
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

  const isActionsJob = new URL(request.url).searchParams.get('actions') === '1';

  try {
    const summary = await githubClient.fetchCheckSummary(owner, repo, checkRunId, {
      isActionsJob,
    });
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
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
