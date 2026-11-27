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
import type { ReviewEvent } from '@/types/pr';

const VALID_EVENTS = new Set<ReviewEvent>(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']);

export const POST: APIRoute = async ({ params, request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(JSON.stringify({ error: 'Cross-origin review requests are forbidden' }), {
      status: 403,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  const { githubClient, snapshotService, tokenStore } = getRuntime();

  let owner: string;
  let repo: string;
  let number: number;
  let event: ReviewEvent;
  let body: string | undefined;

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
    const obj = parsed as { event?: unknown; body?: unknown };
    if (typeof obj.event !== 'string' || !VALID_EVENTS.has(obj.event as ReviewEvent)) {
      throw new GitHubApiError('event must be APPROVE, COMMENT, or REQUEST_CHANGES', 400);
    }
    event = obj.event as ReviewEvent;
    if (obj.body !== undefined && obj.body !== null) {
      if (typeof obj.body !== 'string') {
        throw new GitHubApiError('body must be a string', 400);
      }
      body = obj.body;
    }
    if (event !== 'APPROVE' && (!body || body.trim().length === 0)) {
      throw new GitHubApiError('A review comment body is required for this review action', 400);
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
    const result = await githubClient.submitPullReview(owner, repo, number, event, body);
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
