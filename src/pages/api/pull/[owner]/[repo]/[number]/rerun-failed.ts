import type { APIRoute } from 'astro';
import {
  GitHubApiError,
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  validateCommitSha,
  validatePositiveIntId,
  validatePullNumber,
  validateRepoSegment,
} from '@/server/github-client';
import { isAllowedSameOriginPost } from '@/server/origin-guard';
import { sanitizeErrorMessage } from '@/server/redact';
import { getRuntime } from '@/server/runtime';

export const POST: APIRoute = async ({ params, request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(
      JSON.stringify({
        error: 'Cross-origin workflow rerun requests are forbidden',
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
  let expectedHeadSha: string | undefined;
  let jobId: number | undefined;
  let runId: number | undefined;

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
      const obj = parsed as { expectedHeadSha?: unknown; jobId?: unknown; runId?: unknown };

      if (
        obj.expectedHeadSha !== undefined &&
        obj.expectedHeadSha !== null &&
        obj.expectedHeadSha !== ''
      ) {
        if (typeof obj.expectedHeadSha !== 'string') {
          throw new GitHubApiError('expectedHeadSha must be a string', 400);
        }
        expectedHeadSha = validateCommitSha(obj.expectedHeadSha);
      }

      if (obj.jobId !== undefined && obj.jobId !== null && obj.jobId !== '') {
        jobId = validatePositiveIntId(obj.jobId, 'jobId');
      }

      if (obj.runId !== undefined && obj.runId !== null && obj.runId !== '') {
        runId = validatePositiveIntId(obj.runId, 'runId');
      }

      if (jobId !== undefined && runId !== undefined) {
        throw new GitHubApiError('Provide either jobId or runId, not both', 400);
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
    const result = await githubClient.rerunFailedChecks(owner, repo, number, {
      ...(expectedHeadSha !== undefined ? { expectedHeadSha } : {}),
      ...(jobId !== undefined ? { jobId } : {}),
      ...(runId !== undefined ? { runId } : {}),
    });
    githubClient.invalidatePullDetailCache?.(owner, repo, number);
    snapshotService.invalidateCache(`${owner}/${repo}`);
    return new Response(JSON.stringify(result), {
      status: 202,
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
