import { deriveBlockers, deriveBucket, deriveMyAction } from '@/server/derive/bucket';
import { deriveCiInfo } from '@/server/derive/checks';
import { MAX_PROBES_PER_REFRESH, resolveMergeability } from '@/server/derive/mergeability';
import { deriveBlockerSummary } from '@/server/derive/summary';
import type { RawPullRequest, RawReviewDecision } from '@/server/derive/types';
import type { ProbeMergeabilityResult } from '@/server/github-client';
import type { StateStore } from '@/server/state-store';
import type { Bucket, PrReviewInfo, PrSource, PrView, SnapshotCounts } from '@/types/pr';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RawPrInput {
  raw: RawPullRequest;
  sources: PrSource[];
}

export interface NormalizeOptions {
  viewerLogin: string;
  stateStore: StateStore;
  probeFn?: (
    owner: string,
    repo: string,
    number: number,
    etag?: string,
  ) => Promise<ProbeMergeabilityResult>;
  nowMs?: number;
}

function mapReviewDecision(raw: RawReviewDecision): PrReviewInfo['decision'] {
  if (raw === 'APPROVED') {
    return 'approved';
  }
  if (raw === 'CHANGES_REQUESTED') {
    return 'changes-requested';
  }
  if (raw === 'REVIEW_REQUIRED') {
    return 'required';
  }
  return 'none';
}

function deriveReviewInfo(
  raw: RawPullRequest,
  sources: PrSource[],
  viewerLogin: string,
): PrReviewInfo {
  const approvals: string[] = [];
  const changesRequested: string[] = [];

  for (const rev of raw.latestReviews.nodes) {
    const login = rev?.author?.login;
    if (!login) {
      continue;
    }
    if (rev.state === 'APPROVED') {
      approvals.push(login);
    } else if (rev.state === 'CHANGES_REQUESTED') {
      changesRequested.push(login);
    }
  }

  const pending: string[] = [];
  let hasDirectViewerRequest = false;
  let hasTeamRequest = false;

  for (const req of raw.reviewRequests.nodes) {
    const reviewer = req?.requestedReviewer;
    if (!reviewer) {
      continue;
    }
    if (reviewer.login) {
      pending.push(reviewer.login);
      if (reviewer.login.toLowerCase() === viewerLogin.toLowerCase()) {
        hasDirectViewerRequest = true;
      }
    } else if (reviewer.slug) {
      pending.push(`@${reviewer.slug}`);
      hasTeamRequest = true;
    }
  }

  let requestKind: PrReviewInfo['requestKind'];
  if (sources.includes('review-requested')) {
    if (hasDirectViewerRequest) {
      requestKind = 'direct';
    } else if (hasTeamRequest) {
      requestKind = 'team';
    } else {
      requestKind = 'direct';
    }
  }

  return {
    decision: mapReviewDecision(raw.reviewDecision),
    ...(requestKind ? { requestKind } : {}),
    approvals,
    changesRequested,
    pending,
  };
}

function computeWholeDays(isoDate: string, nowMs: number): number {
  const ts = Date.parse(isoDate);
  if (!Number.isFinite(ts)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - ts) / MS_PER_DAY));
}

export function isActivePullRequest(raw: RawPullRequest): boolean {
  if (raw.closed === true) {
    return false;
  }
  if (raw.state !== undefined && raw.state !== 'OPEN') {
    return false;
  }
  if (
    raw.repository.isArchived === true ||
    raw.repository.isDisabled === true ||
    raw.repository.isLocked === true
  ) {
    return false;
  }
  return true;
}

export function mergeRawPullRequests(
  authored: RawPullRequest[],
  reviewRequested: RawPullRequest[],
): RawPrInput[] {
  const merged = new Map<string, RawPrInput>();

  for (const pr of authored) {
    if (!isActivePullRequest(pr)) {
      continue;
    }
    merged.set(pr.id, { raw: pr, sources: ['authored'] });
  }

  for (const pr of reviewRequested) {
    if (!isActivePullRequest(pr)) {
      continue;
    }
    const existing = merged.get(pr.id);
    if (existing) {
      if (!existing.sources.includes('review-requested')) {
        existing.sources.push('review-requested');
      }
    } else {
      merged.set(pr.id, { raw: pr, sources: ['review-requested'] });
    }
  }

  return Array.from(merged.values());
}

const BUCKET_ORDER: Record<Bucket, number> = {
  'needs-me': 0,
  ready: 1,
  waiting: 2,
  draft: 3,
};

function priorityScore(pr: PrView): number {
  if (pr.bucket === 'needs-me') {
    if (pr.ci.state === 'failing') {
      return 0;
    }
    if (pr.merge.state === 'conflicting') {
      return 1;
    }
    if (pr.review.decision === 'changes-requested' || pr.review.changesRequested.length > 0) {
      return 2;
    }
    if (pr.review.requestKind === 'direct') {
      return 3;
    }
    return 4;
  }
  return 0;
}

export function sortPullRequests(prs: PrView[]): PrView[] {
  return [...prs].sort((a, b) => {
    const bucketDiff = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (bucketDiff !== 0) {
      return bucketDiff;
    }
    if (a.bucket === 'needs-me') {
      const scoreDiff = priorityScore(a) - priorityScore(b);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return b.idleDays - a.idleDays;
    }
    if (a.bucket === 'waiting') {
      return b.idleDays - a.idleDays;
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function computeCounts(prs: PrView[]): SnapshotCounts {
  const counts: SnapshotCounts = {
    needsMe: 0,
    ready: 0,
    waiting: 0,
    draft: 0,
  };
  for (const pr of prs) {
    if (pr.bucket === 'needs-me') {
      counts.needsMe++;
    } else if (pr.bucket === 'ready') {
      counts.ready++;
    } else if (pr.bucket === 'waiting') {
      counts.waiting++;
    } else {
      counts.draft++;
    }
  }
  return counts;
}

export async function normalizePullRequests(
  inputs: RawPrInput[],
  options: NormalizeOptions,
): Promise<{ pullRequests: PrView[]; hasCachedMergeability: boolean }> {
  const nowMs = options.nowMs ?? Date.now();
  const probeBudget = { remaining: MAX_PROBES_PER_REFRESH };
  const views: PrView[] = [];
  let hasCachedMergeability = false;

  for (const item of inputs) {
    const { raw, sources } = item;
    const [owner = '', repo = ''] = raw.repository.nameWithOwner.split('/');
    const key = `${raw.repository.nameWithOwner}#${raw.number}`;

    const lastCommit = raw.commits.nodes[0]?.commit;
    const lastCommittedAt = lastCommit?.committedDate ?? raw.updatedAt;
    const ci = deriveCiInfo(lastCommit?.statusCheckRollup ?? null, raw.url);
    const review = deriveReviewInfo(raw, sources, options.viewerLogin);
    const resolvedMerge = await resolveMergeability(raw, {
      stateStore: options.stateStore,
      probeFn: options.probeFn,
      nowMs,
      probeBudget,
    });
    if (resolvedMerge.merge.source === 'cached') {
      hasCachedMergeability = true;
    }

    const mergeQueue = raw.mergeQueueEntry
      ? {
          position: raw.mergeQueueEntry.position,
          state: raw.mergeQueueEntry.state,
          estimatedTimeToMerge: raw.mergeQueueEntry.estimatedTimeToMerge,
        }
      : null;

    const bucketInput = {
      isDraft: raw.isDraft,
      sources,
      ci,
      review,
      merge: resolvedMerge.merge,
      effectiveMergeStateStatus: resolvedMerge.effectiveMergeStateStatus,
      autoMerge: raw.autoMergeRequest !== null,
      mergeQueue,
    };

    const bucket = deriveBucket(bucketInput);
    const myAction = deriveMyAction(bucketInput, bucket);
    const blockers = deriveBlockers(bucketInput);
    const ageDays = computeWholeDays(raw.createdAt, nowMs);
    const idleDays = computeWholeDays(lastCommittedAt, nowMs);
    const blockerSummary = deriveBlockerSummary({
      isDraft: raw.isDraft,
      sources,
      bucket,
      ci,
      review,
      merge: resolvedMerge.merge,
      autoMerge: raw.autoMergeRequest !== null,
      mergeQueue,
      idleDays,
      viewerLogin: options.viewerLogin,
    });

    views.push({
      key,
      owner,
      repo,
      repository: raw.repository.nameWithOwner,
      number: raw.number,
      title: raw.title,
      url: raw.url,
      author: raw.author?.login ?? options.viewerLogin,
      baseRefName: raw.baseRefName,
      headRefName: raw.headRefName,
      headRefOid: raw.headRefOid,
      isDraft: raw.isDraft,
      sources,
      bucket,
      myAction,
      blockers,
      ci,
      review,
      merge: resolvedMerge.merge,
      autoMerge: raw.autoMergeRequest !== null,
      autoMergeMethod: raw.autoMergeRequest?.mergeMethod ?? null,
      mergeQueue,
      size: {
        additions: raw.additions,
        deletions: raw.deletions,
        files: raw.changedFiles,
      },
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      lastCommittedAt,
      ageDays,
      idleDays,
      blockerSummary,
    });
  }

  return {
    pullRequests: sortPullRequests(views),
    hasCachedMergeability,
  };
}
