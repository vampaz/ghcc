export type Bucket = 'needs-me' | 'ready' | 'waiting' | 'draft';

export type BlockerCode =
  | 'ci-failing'
  | 'ci-pending'
  | 'review-required'
  | 'changes-requested'
  | 'conflict'
  | 'behind-base'
  | 'draft'
  | 'blocked-unknown'
  | 'queue-waiting';

export type PrSource = 'authored' | 'review-requested' | 'repo';

export type MyAction = 'review' | 'merge' | 'fix-ci' | 'rebase' | 'ping' | 'none';

export interface CiFailingCheck {
  name: string;
  url: string;
}

export interface PrCiInfo {
  state: 'passing' | 'failing' | 'pending' | 'none';
  passing: number;
  failing: CiFailingCheck[];
  pending: number;
  hiddenCount: number;
}

export interface PrReviewInfo {
  decision: 'approved' | 'changes-requested' | 'required' | 'none';
  requestKind?: 'direct' | 'team';
  approvals: string[];
  changesRequested: string[];
  pending: string[];
}

export interface PrMergeInfo {
  state: 'clean' | 'behind' | 'conflicting' | 'blocked' | 'queued' | 'draft' | 'unknown';
  source: 'fresh' | 'cached' | 'probe' | 'unknown';
  checkedAt?: string;
}

export interface PrMergeQueueInfo {
  position: number;
  state: string;
  estimatedTimeToMerge: number | null;
}

export interface PrView {
  key: string;
  owner: string;
  repo: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isDraft: boolean;
  sources: PrSource[];
  bucket: Bucket;
  myAction: MyAction;
  blockers: BlockerCode[];
  ci: PrCiInfo;
  review: PrReviewInfo;
  merge: PrMergeInfo;
  autoMerge: boolean;
  autoMergeMethod: string | null;
  mergeQueue: PrMergeQueueInfo | null;
  size: {
    additions: number;
    deletions: number;
    files: number;
  };
  createdAt: string;
  updatedAt: string;
  lastCommittedAt: string;
  ageDays: number;
  idleDays: number;
  blockerSummary: string;
}

export interface RateLimitBucket {
  remaining: number;
  limit: number;
  resetAt: string;
}

export type SnapshotState = 'ready' | 'degraded' | 'rate-limited' | 'auth-error' | 'fatal';

export type ServerLifecycleState = 'idle' | 'loading' | 'refreshing' | SnapshotState;

export type SchedulerState = 'idle' | 'scheduled' | 'in-flight' | 'backing-off';

export type WarningCode =
  | 'review-queue-failed'
  | 'repo-pulls-failed'
  | 'sso-required'
  | 'graphql-partial-error'
  | 'mergeability-cached'
  | 'rate-limited'
  | 'auth-error'
  | 'refresh-failed';

export interface SnapshotWarning {
  code: WarningCode;
  message: string;
  ssoUrl?: string;
}

export interface SnapshotCounts {
  needsMe: number;
  ready: number;
  waiting: number;
  draft: number;
}

export interface SnapshotResponse {
  fetchedAt: string;
  viewer: { login: string };
  state: SnapshotState;
  counts: SnapshotCounts;
  pullRequests: PrView[];
  rateLimit: {
    graphql: RateLimitBucket | null;
    core: RateLimitBucket | null;
  };
  warnings: SnapshotWarning[];
}

export interface PrDetailCheck {
  name: string;
  kind: 'CheckRun' | 'StatusContext';
  status: string;
  conclusion: string | null;
  bucket: 'passing' | 'failing' | 'pending';
  url: string | null;
  description: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PrTimelineItem {
  id: string;
  kind:
    | 'commit'
    | 'review'
    | 'comment'
    | 'ready_for_review'
    | 'converted_to_draft'
    | 'merged'
    | 'closed'
    | 'reopened';
  actor: string;
  createdAt: string;
  summary: string;
  state?: string;
}

export interface PrReviewerDetail {
  login: string;
  kind: 'user' | 'team';
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submittedAt: string | null;
  asCodeOwner: boolean;
}

export interface PrDetailResponse {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  isDraft: boolean;
  bodyExcerpt: string;
  checksTotalCount: number;
  checks: PrDetailCheck[];
  reviewers: PrReviewerDetail[];
  timeline: PrTimelineItem[];
  fetchedAt: string;
}

export interface HealthResponse {
  gh: 'ok' | 'error';
  login: string;
  tokenSource: 'gh-cli' | 'env';
}

export interface UpdateBranchResponse {
  ok: true;
  message: string;
  url?: string;
}

export interface ToggleDraftResponse {
  ok: true;
  isDraft: boolean;
}
