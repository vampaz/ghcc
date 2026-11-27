export type RawMergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export type RawMergeStateStatus =
  | 'BEHIND'
  | 'BLOCKED'
  | 'CLEAN'
  | 'DIRTY'
  | 'DRAFT'
  | 'HAS_HOOKS'
  | 'UNKNOWN'
  | 'UNSTABLE';

export type RawReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export interface RawCheckRunNode {
  __typename: 'CheckRun';
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RawStatusContextNode {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
  description: string | null;
}

export type RawStatusCheckContext = RawCheckRunNode | RawStatusContextNode;

export interface RawStatusCheckRollup {
  state: string;
  contexts: {
    totalCount: number;
    nodes: Array<RawStatusCheckContext | null>;
  };
}

export interface RawReviewNode {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submittedAt: string | null;
  author: { login: string } | null;
}

export interface RawReviewRequestNode {
  asCodeOwner?: boolean;
  requestedReviewer:
    | { __typename?: 'User'; login: string; slug?: undefined }
    | { __typename?: 'Team'; slug: string; login?: undefined }
    | null;
}

export interface RawPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  state?: 'OPEN' | 'CLOSED' | 'MERGED';
  closed?: boolean;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  baseRefName: string;
  baseRefOid?: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: RawReviewDecision;
  mergeable: RawMergeable;
  mergeStateStatus: RawMergeStateStatus;
  autoMergeRequest: {
    enabledAt: string;
    mergeMethod: string;
  } | null;
  mergeQueueEntry: {
    position: number;
    state: string;
    estimatedTimeToMerge: number | null;
  } | null;
  repository: {
    nameWithOwner: string;
    isArchived?: boolean;
    isDisabled?: boolean;
    isLocked?: boolean;
  };
  author?: {
    login: string;
  } | null;
  labels?: {
    nodes: Array<{
      name: string;
      color: string;
      description?: string | null;
    } | null>;
  } | null;
  latestReviews: {
    nodes: Array<RawReviewNode | null>;
  };
  reviewRequests: {
    nodes: Array<RawReviewRequestNode | null>;
  };
  reviewThreads?: {
    totalCount: number;
    nodes: Array<{ isResolved: boolean } | null>;
  } | null;
  commits: {
    nodes: Array<{
      commit: {
        committedDate: string;
        statusCheckRollup: RawStatusCheckRollup | null;
      };
    } | null>;
  };
}
