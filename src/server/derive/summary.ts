import { hasChangesRequested } from '@/server/derive/bucket';
import type {
  Bucket,
  PrCiInfo,
  PrMergeInfo,
  PrMergeQueueInfo,
  PrReviewInfo,
  PrSource,
} from '@/types/pr';

export interface SummaryInput {
  isDraft: boolean;
  sources: PrSource[];
  bucket: Bucket;
  ci: PrCiInfo;
  review: PrReviewInfo;
  merge: PrMergeInfo;
  autoMerge: boolean;
  mergeQueue: PrMergeQueueInfo | null;
  idleDays: number;
}

function formatPendingReviewers(pending: string[]): string {
  const formatted = pending
    .slice(0, 2)
    .map((handle) => (handle.startsWith('@') ? handle : `@${handle}`));
  if (pending.length > 2) {
    return `${formatted.join(', ')} +${pending.length - 2}`;
  }
  return formatted.join(', ');
}

export function deriveBlockerSummary(input: SummaryInput): string {
  const parts: string[] = [];
  const isReviewRequested = input.sources.includes('review-requested');
  const changesReq = hasChangesRequested(input.review);

  if (input.isDraft) {
    parts.push('Draft');
  }

  if (isReviewRequested && !input.isDraft) {
    parts.push(
      input.review.requestKind === 'team' ? 'Team review requested' : 'Your review requested',
    );
  }

  if (input.mergeQueue) {
    parts.push(`In merge queue (#${input.mergeQueue.position})`);
  }

  // CI signal
  if (input.ci.state === 'failing') {
    if (input.ci.failing.length > 0) {
      parts.push(`CI ${input.ci.failing.length} failing`);
    } else if (input.ci.hiddenCount > 0) {
      parts.push('CI failing (see details)');
    } else {
      parts.push('CI failing');
    }
  } else if (input.ci.state === 'pending') {
    parts.push(input.ci.pending > 0 ? `CI ${input.ci.pending} pending` : 'CI pending');
  } else if (input.ci.state === 'passing') {
    parts.push('CI passing ✓');
  } else {
    parts.push('No CI checks');
  }

  // Mergeability / branch status
  if (input.merge.state === 'conflicting') {
    parts.push('conflict with base');
  } else if (input.merge.state === 'behind') {
    parts.push('behind base');
  } else if (input.merge.state === 'blocked') {
    parts.push(
      input.review.decision === 'required' ? 'blocked by review' : 'blocked by branch rule',
    );
  } else if (input.merge.state === 'unknown' && !input.isDraft && !input.mergeQueue) {
    parts.push('merge ?');
  } else if (input.merge.state === 'clean' && !input.isDraft && !input.mergeQueue) {
    if (input.autoMerge) {
      parts.push('mergeable (auto-merge on)');
    } else if (input.bucket === 'ready') {
      parts.push('mergeable');
    }
  }

  if (input.autoMerge && !parts.some((p) => p.includes('auto-merge on'))) {
    parts.push('auto-merge on');
  }

  // Review signal
  if (changesReq) {
    const authors = input.review.changesRequested.map((a) => `@${a}`).join(', ');
    parts.push(authors ? `changes requested (${authors})` : 'changes requested');
  } else if (
    input.review.decision === 'approved' ||
    (input.review.decision === 'none' && input.review.approvals.length > 0)
  ) {
    parts.push('Approved ✓');
  }

  if (input.review.pending.length > 0) {
    parts.push(`waiting on ${formatPendingReviewers(input.review.pending)}`);
  } else if (
    input.review.decision === 'required' &&
    !parts.includes('blocked by review') &&
    !isReviewRequested
  ) {
    parts.push('review required');
  } else if (
    input.isDraft &&
    !changesReq &&
    input.review.approvals.length === 0 &&
    input.review.pending.length === 0
  ) {
    parts.push('no review requested');
  }

  if (input.bucket === 'waiting' && input.idleDays > 0) {
    parts.push(`${input.idleDays}d since update`);
  }

  return parts.join(' · ');
}
