import type { RawMergeStateStatus } from '@/server/derive/types';
import type {
  BlockerCode,
  Bucket,
  MyAction,
  PrCiInfo,
  PrMergeInfo,
  PrMergeQueueInfo,
  PrReviewInfo,
  PrSource,
} from '@/types/pr';

export interface BucketInput {
  isDraft: boolean;
  sources: PrSource[];
  ci: PrCiInfo;
  review: PrReviewInfo;
  merge: PrMergeInfo;
  effectiveMergeStateStatus: RawMergeStateStatus;
  autoMerge: boolean;
  mergeQueue: PrMergeQueueInfo | null;
}

export function hasChangesRequested(review: PrReviewInfo): boolean {
  return review.decision === 'changes-requested' || review.changesRequested.length > 0;
}

export function deriveBucket(input: BucketInput): Bucket {
  const isAuthored = input.sources.includes('authored');
  const isReviewRequested = input.sources.includes('review-requested');
  const changesReq = hasChangesRequested(input.review);

  // Rule 1: draft (unless changes are requested; WIP red CI/conflicts stay in draft).
  if (input.isDraft && !changesReq) {
    return 'draft';
  }

  // Rule 2: needs-me.
  if (
    isAuthored &&
    (changesReq || input.ci.state === 'failing' || input.merge.state === 'conflicting')
  ) {
    return 'needs-me';
  }
  if (isReviewRequested) {
    return 'needs-me';
  }

  // Rule 3: ready (authored, passing or no CI, CLEAN mergeStateStatus, auto-merge off, not queued).
  if (
    isAuthored &&
    (input.ci.state === 'passing' || input.ci.state === 'none') &&
    input.effectiveMergeStateStatus === 'CLEAN' &&
    !input.autoMerge &&
    !input.mergeQueue
  ) {
    return 'ready';
  }

  // Rule 4: waiting (everything else, including auto-merge enabled & merge queue entries).
  return 'waiting';
}

export function deriveMyAction(input: BucketInput, bucket: Bucket): MyAction {
  const isAuthored = input.sources.includes('authored');
  const isReviewRequested = input.sources.includes('review-requested');

  if (bucket === 'draft' && !hasChangesRequested(input.review)) {
    return 'none';
  }

  if (isReviewRequested && !isAuthored) {
    return 'review';
  }

  if (isAuthored) {
    if (input.merge.state === 'conflicting' || input.merge.state === 'behind') {
      return 'rebase';
    }
    if (input.ci.state === 'failing') {
      return 'fix-ci';
    }
    if (hasChangesRequested(input.review)) {
      return 'fix-ci';
    }
    if (isReviewRequested) {
      return 'review';
    }
    if (bucket === 'ready') {
      return 'merge';
    }
    if (
      bucket === 'waiting' &&
      (input.review.pending.length > 0 || input.review.decision === 'required')
    ) {
      return 'ping';
    }
  }

  if (isReviewRequested) {
    return 'review';
  }

  return 'none';
}

export function deriveBlockers(input: BucketInput): BlockerCode[] {
  const blockers: BlockerCode[] = [];

  if (input.isDraft) {
    blockers.push('draft');
  }
  if (input.ci.state === 'failing') {
    blockers.push('ci-failing');
  }
  if (input.merge.state === 'conflicting') {
    blockers.push('conflict');
  }
  if (hasChangesRequested(input.review)) {
    blockers.push('changes-requested');
  }
  if (input.ci.state === 'pending') {
    blockers.push('ci-pending');
  }
  if (input.merge.state === 'behind') {
    blockers.push('behind-base');
  }
  if (
    input.review.decision === 'required' ||
    (input.merge.state === 'blocked' && input.review.pending.length > 0)
  ) {
    blockers.push('review-required');
  }
  if (input.mergeQueue) {
    blockers.push('queue-waiting');
  }
  if (
    input.merge.state === 'blocked' &&
    !blockers.includes('review-required') &&
    !blockers.includes('changes-requested') &&
    !blockers.includes('ci-failing') &&
    !blockers.includes('ci-pending')
  ) {
    blockers.push('blocked-unknown');
  }

  return blockers;
}
