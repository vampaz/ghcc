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

export interface PrLabel {
  name: string;
  color: string;
  description: string | null;
}

export type SnoozeCondition =
  | { kind: 'until-time'; untilIso: string }
  | { kind: 'until-push'; headRefOid: string }
  | { kind: 'until-ci-change'; ciState: PrCiInfo['state']; headRefOid: string }
  | { kind: 'until-activity'; updatedAt: string };

export interface PrTriageInfo {
  pinned: boolean;
  pinnedAt?: string;
  isSnoozed: boolean;
  snoozedAt?: string;
  snoozeCondition?: SnoozeCondition;
}

export type TriageAction = 'pin' | 'unpin' | 'snooze' | 'unsnooze';

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
  labels: PrLabel[];
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
  unresolvedThreadCount?: number;
  triage?: PrTriageInfo;
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
  checkRunId?: number | null;
  workflowRunId?: number | null;
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

export interface PrReviewThreadComment {
  id: string;
  author: string;
  bodyExcerpt: string;
  bodyHtml: string;
  createdAt: string;
  url: string | null;
}

export interface PrReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  comments: PrReviewThreadComment[];
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
  bodyHtml: string;
  checksTotalCount: number;
  checks: PrDetailCheck[];
  reviewers: PrReviewerDetail[];
  reviewThreads?: PrReviewThread[];
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

export type MergeMethod = 'squash' | 'merge';

export interface MergePullResponse {
  ok: true;
  merged: true;
  sha: string;
  message: string;
  mergeMethod: MergeMethod;
}

export interface RepoLabelsResponse {
  repository: string;
  labels: PrLabel[];
}

export interface UpdateLabelsResponse {
  ok: true;
  labels: PrLabel[];
}

export interface RerunFailedChecksResponse {
  ok: true;
  scope: 'all' | 'job' | 'run';
  rerunCount: number;
  runIds: number[];
  jobId?: number;
  message: string;
}

export interface CheckAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  level: 'failure' | 'warning' | 'notice';
  title: string | null;
  message: string;
}

export interface CheckSummaryResponse {
  checkRunId: number;
  name: string;
  title: string | null;
  summary: string | null;
  annotations: CheckAnnotation[];
  failedStep: string | null;
  logExcerpt: string | null;
  logTruncated: boolean;
  logUnavailableReason: string | null;
  detailsUrl: string | null;
}

export interface UpdateTriageResponse {
  ok: true;
  key: string;
  triage: PrTriageInfo;
}

export type ReviewEvent = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';

export interface SubmitReviewResponse {
  ok: true;
  event: ReviewEvent;
  state: string;
}

export interface ThreadReplyResponse {
  ok: true;
  threadId: string;
  comment: PrReviewThreadComment;
}

export interface ThreadResolveResponse {
  ok: true;
  threadId: string;
  isResolved: boolean;
}

export interface RepoReviewerOption {
  login: string;
  kind: 'user' | 'team';
  name: string | null;
}

export interface RepoReviewersResponse {
  repository: string;
  reviewers: RepoReviewerOption[];
}

export interface UpdateReviewersResponse {
  ok: true;
  requestedUsers: string[];
  requestedTeams: string[];
}

export interface SavedFilterPreset {
  id: string;
  name: string;
  filters: {
    view: 'all' | 'mine' | 'review' | 'team';
    bucket: '' | Bucket | 'ci-failing';
    q: string;
    repos: 'all' | 'none' | string[];
    drafts: boolean;
    snoozed: boolean;
    staleOnly: boolean;
  };
  createdAt: string;
}

export interface PresetsResponse {
  presets: SavedFilterPreset[];
}
