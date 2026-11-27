import type { APIRoute } from 'astro';
import { GitHubApiError, validatePullNumber, validateRepoSegment } from '@/server/github-client';
import { isAllowedSameOriginPost } from '@/server/origin-guard';
import { sanitizeErrorMessage } from '@/server/redact';
import { getRuntime } from '@/server/runtime';
import type { PrCiInfo, SnoozeCondition, TriageAction, UpdateTriageResponse } from '@/types/pr';

const VALID_ACTIONS = new Set<TriageAction>(['pin', 'unpin', 'snooze', 'unsnooze']);
const VALID_CI_STATES = new Set<PrCiInfo['state']>(['passing', 'failing', 'pending', 'none']);

function parseSnoozeCondition(raw: unknown): SnoozeCondition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GitHubApiError('Snooze condition must be a JSON object', 400);
  }
  const obj = raw as Record<string, unknown>;
  switch (obj.kind) {
    case 'until-time': {
      if (typeof obj.untilIso !== 'string' || !Number.isFinite(Date.parse(obj.untilIso))) {
        throw new GitHubApiError('untilIso must be a valid ISO timestamp', 400);
      }
      return { kind: 'until-time', untilIso: new Date(Date.parse(obj.untilIso)).toISOString() };
    }
    case 'until-push': {
      if (typeof obj.headRefOid !== 'string' || obj.headRefOid.trim().length === 0) {
        throw new GitHubApiError('headRefOid is required for until-push snooze', 400);
      }
      return { kind: 'until-push', headRefOid: obj.headRefOid.trim() };
    }
    case 'until-ci-change': {
      if (
        typeof obj.ciState !== 'string' ||
        !VALID_CI_STATES.has(obj.ciState as PrCiInfo['state'])
      ) {
        throw new GitHubApiError('ciState must be passing, failing, pending, or none', 400);
      }
      if (typeof obj.headRefOid !== 'string' || obj.headRefOid.trim().length === 0) {
        throw new GitHubApiError('headRefOid is required for until-ci-change snooze', 400);
      }
      return {
        kind: 'until-ci-change',
        ciState: obj.ciState as PrCiInfo['state'],
        headRefOid: obj.headRefOid.trim(),
      };
    }
    case 'until-activity': {
      if (typeof obj.updatedAt !== 'string' || !Number.isFinite(Date.parse(obj.updatedAt))) {
        throw new GitHubApiError('updatedAt must be a valid ISO timestamp', 400);
      }
      return { kind: 'until-activity', updatedAt: obj.updatedAt };
    }
    default:
      throw new GitHubApiError('Invalid snooze condition kind', 400);
  }
}

export const POST: APIRoute = async ({ params, request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(
      JSON.stringify({
        error: 'Cross-origin triage requests are forbidden',
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

  const { snapshotService, stateStore, tokenStore } = getRuntime();

  let owner: string;
  let repo: string;
  let number: number;
  let action: TriageAction;
  let condition: SnoozeCondition | undefined;

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
    const obj = parsed as { action?: unknown; condition?: unknown };
    if (typeof obj.action !== 'string' || !VALID_ACTIONS.has(obj.action as TriageAction)) {
      throw new GitHubApiError('action must be pin, unpin, snooze, or unsnooze', 400);
    }
    action = obj.action as TriageAction;
    if (action === 'snooze') {
      condition = parseSnoozeCondition(obj.condition);
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

  const prKey = `${owner}/${repo}#${number}`;
  const nowIso = new Date().toISOString();

  try {
    const existing = await stateStore.getPrTriage(prKey);
    let nextEntry = existing ? { ...existing } : {};

    if (action === 'pin') {
      // Pinning surfaces the PR immediately, clearing any active snooze.
      nextEntry = { pinned: true, pinnedAt: nowIso };
    } else if (action === 'unpin') {
      delete nextEntry.pinned;
      delete nextEntry.pinnedAt;
    } else if (action === 'snooze' && condition) {
      // Snoozing hides the PR from active focus, clearing any pin.
      nextEntry = { snoozed: { condition, snoozedAt: nowIso } };
    } else if (action === 'unsnooze') {
      delete nextEntry.snoozed;
    }

    const normalizedEntry = nextEntry.pinned || nextEntry.snoozed ? nextEntry : null;
    const triage = await snapshotService.applyLocalTriageUpdate(prKey, normalizedEntry);
    const responseBody: UpdateTriageResponse = {
      ok: true,
      key: prKey,
      triage,
    };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: sanitizeErrorMessage(error, tokenStore.peekToken()),
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }
};
