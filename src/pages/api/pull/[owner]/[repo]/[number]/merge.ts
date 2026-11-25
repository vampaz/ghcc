import type { APIRoute } from 'astro';
import {
  GitHubApiError,
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  validateCommitSha,
  validatePullNumber,
  validateRepoSegment,
} from '@/server/github-client';
import { isAllowedSameOriginPost } from '@/server/origin-guard';
import { sanitizeErrorMessage } from '@/server/redact';
import { getRuntime } from '@/server/runtime';
import type { MergeMethod } from '@/types/pr';

export const POST: APIRoute = async ({ params, request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(
      JSON.stringify({
        error: 'Cross-origin merge requests are forbidden',
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
  let mergeMethod: MergeMethod = 'squash';
  let expectedHeadSha: string | undefined;

  try {
    owner = validateRepoSegment(params.owner ?? '', 'owner');
    repo = validateRepoSegment(params.repo ?? '', 'repo');
    number = validatePullNumber(params.number ?? '');

    const rawBody = await request.text();
    if (rawBody.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new GitHubApiError('Invalid JSON request body', 400);
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new GitHubApiError('Request body must be a JSON object', 400);
      }
      const methodValue = (parsed as { mergeMethod?: unknown }).mergeMethod;
      if (methodValue !== undefined && methodValue !== null && methodValue !== '') {
        if (methodValue !== 'squash' && methodValue !== 'merge') {
          throw new GitHubApiError('mergeMethod must be "squash" or "merge"', 400);
        }
        mergeMethod = methodValue;
      }
      const shaValue = (parsed as { expectedHeadSha?: unknown }).expectedHeadSha;
      if (shaValue !== undefined && shaValue !== null && shaValue !== '') {
        if (typeof shaValue !== 'string') {
          throw new GitHubApiError('expectedHeadSha must be a string', 400);
        }
        expectedHeadSha = validateCommitSha(shaValue);
      }
    }
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
    const result = await githubClient.mergePullRequest(owner, repo, number, {
      mergeMethod,
      expectedHeadSha,
    });
    snapshotService.invalidateCache();
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
