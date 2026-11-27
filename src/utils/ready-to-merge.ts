import type { PrView } from '@/types/pr';

const MAINLINE_BASE_REFS = new Set(['main', 'master']);

export function isPrReadyToMerge(pr: PrView): boolean {
  if (pr.isDraft) {
    return false;
  }
  if (pr.autoMerge || pr.mergeQueue !== null) {
    return false;
  }
  if (pr.ci.state !== 'passing' && pr.ci.state !== 'none') {
    return false;
  }
  if (pr.merge.state !== 'clean') {
    return false;
  }
  if (
    pr.review.decision === 'changes-requested' ||
    pr.review.decision === 'required' ||
    pr.review.changesRequested.length > 0
  ) {
    return false;
  }
  const hasApproval = pr.review.decision === 'approved' || pr.review.approvals.length > 0;
  if (pr.review.pending.length > 0 && !hasApproval) {
    return false;
  }
  if (!MAINLINE_BASE_REFS.has(pr.baseRefName) && !hasApproval) {
    return false;
  }
  if (pr.blockers.length > 0) {
    return false;
  }
  return true;
}
