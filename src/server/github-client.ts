import type { TokenStore } from '@/server/auth';
import type { RawPullRequest } from '@/server/derive/types';
import { redactToken, sanitizeErrorMessage } from '@/server/redact';
import { sanitizePrBodyHtml } from '@/server/sanitize-pr-html';
import type {
  MergeMethod,
  MergePullResponse,
  PrDetailCheck,
  PrDetailResponse,
  PrLabel,
  PrReviewerDetail,
  PrTimelineItem,
  RateLimitBucket,
  RerunFailedChecksResponse,
  SnapshotWarning,
  ToggleDraftResponse,
  UpdateBranchResponse,
} from '@/types/pr';

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const GITHUB_REST_BASE = 'https://api.github.com';
const SAFE_SEGMENT_RE = /^[\w.-]+$/;
const SAFE_NUMBER_RE = /^[1-9]\d*$/;
const SAFE_SHA_RE = /^[0-9a-f]{40}$/i;

const PR_FIELDS_FRAGMENT = `
fragment PrFields on PullRequest {
  id
  number
  title
  url
  state
  closed
  isDraft
  createdAt
  updatedAt
  baseRefName
  baseRefOid
  headRefName
  headRefOid
  additions
  deletions
  changedFiles
  reviewDecision
  mergeable
  mergeStateStatus
  autoMergeRequest {
    enabledAt
    mergeMethod
  }
  mergeQueueEntry {
    position
    state
    estimatedTimeToMerge
  }
  repository {
    nameWithOwner
    isArchived
    isDisabled
    isLocked
  }
  author {
    login
  }
  labels(first: 20) {
    nodes {
      name
      color
      description
    }
  }
  latestReviews(first: 20) {
    nodes {
      state
      submittedAt
      author {
        login
      }
    }
  }
  reviewRequests(first: 20) {
    nodes {
      asCodeOwner
      requestedReviewer {
        __typename
        ... on User {
          login
        }
        ... on Team {
          slug
        }
      }
    }
  }
  commits(last: 1) {
    nodes {
      commit {
        committedDate
        statusCheckRollup {
          state
          contexts(first: 30) {
            totalCount
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
                detailsUrl
              }
              ... on StatusContext {
                context
                state
                targetUrl
              }
            }
          }
        }
      }
    }
  }
}
`;

const SNAPSHOT_QUERY = `
query Snapshot($cursor: String) {
  viewer {
    login
    pullRequests(
      states: OPEN
      first: 25
      after: $cursor
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...PrFields
      }
    }
  }
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
}
${PR_FIELDS_FRAGMENT}
`;

const REVIEW_QUEUE_QUERY = `
query ReviewQueue {
  search(query: "is:pr is:open archived:false review-requested:@me", type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        ...PrFields
      }
    }
  }
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
}
${PR_FIELDS_FRAGMENT}
`;

const REPO_PULLS_QUERY = `
query RepoPulls($owner: String!, $repo: String!, $cursor: String, $first: Int = 12) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      states: OPEN
      first: $first
      after: $cursor
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...PrFields
      }
    }
  }
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
}
${PR_FIELDS_FRAGMENT}
`;

const PULL_DETAIL_QUERY = `
query PullDetail($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      title
      url
      isDraft
      bodyText
      bodyHTML
      baseRefName
      headRefName
      latestReviews(first: 30) {
        nodes {
          state
          submittedAt
          author {
            login
          }
        }
      }
      reviewRequests(first: 30) {
        nodes {
          asCodeOwner
          requestedReviewer {
            __typename
            ... on User {
              login
            }
            ... on Team {
              slug
            }
          }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                totalCount
                nodes {
                  __typename
                  ... on CheckRun {
                    databaseId
                    name
                    status
                    conclusion
                    detailsUrl
                    startedAt
                    completedAt
                    checkSuite {
                      workflowRun {
                        databaseId
                      }
                    }
                  }
                  ... on StatusContext {
                    context
                    state
                    targetUrl
                    description
                  }
                }
              }
            }
          }
        }
      }
      timelineItems(
        last: 5
        itemTypes: [
          PULL_REQUEST_COMMIT
          PULL_REQUEST_REVIEW
          ISSUE_COMMENT
          READY_FOR_REVIEW_EVENT
          CONVERT_TO_DRAFT_EVENT
          MERGED_EVENT
          CLOSED_EVENT
          REOPENED_EVENT
        ]
      ) {
        nodes {
          __typename
          ... on PullRequestCommit {
            commit {
              abbreviatedOid
              messageHeadline
              committedDate
              author {
                user {
                  login
                }
                name
              }
            }
          }
          ... on PullRequestReview {
            id
            state
            submittedAt
            author {
              login
            }
          }
          ... on IssueComment {
            id
            createdAt
            bodyText
            author {
              login
            }
          }
          ... on ReadyForReviewEvent {
            id
            createdAt
            actor {
              login
            }
          }
          ... on ConvertToDraftEvent {
            id
            createdAt
            actor {
              login
            }
          }
          ... on MergedEvent {
            id
            createdAt
            actor {
              login
            }
          }
          ... on ClosedEvent {
            id
            createdAt
            actor {
              login
            }
          }
          ... on ReopenedEvent {
            id
            createdAt
            actor {
              login
            }
          }
        }
      }
    }
  }
}
`;

const PULL_NODE_ID_QUERY = `
query PullNodeId($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      isDraft
    }
  }
}
`;

const CONVERT_PR_TO_DRAFT_MUTATION = `
mutation ConvertPullRequestToDraft($pullRequestId: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

const MARK_PR_READY_MUTATION = `
mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

export class GitHubRateLimitError extends Error {
  readonly resetAt: string;

  constructor(message: string, resetAt: string) {
    super(message);
    this.name = 'GitHubRateLimitError';
    this.resetAt = resetAt;
  }
}

export class GitHubNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubNotFoundError';
  }
}

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 502) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export function validateRepoSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT_RE.test(value) || value === '.' || value === '..') {
    throw new GitHubApiError(`Invalid ${label} segment`, 400);
  }
  return value;
}

export function validatePullNumber(value: string | number): number {
  const str = String(value);
  if (!SAFE_NUMBER_RE.test(str)) {
    throw new GitHubApiError('Invalid pull request number', 400);
  }
  return Number(str);
}

export function validateCommitSha(value: string): string {
  const trimmed = value.trim();
  if (!SAFE_SHA_RE.test(trimmed)) {
    throw new GitHubApiError('Invalid expectedHeadSha', 400);
  }
  return trimmed.toLowerCase();
}

export function validatePositiveIntId(value: unknown, label: string): number {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && SAFE_NUMBER_RE.test(value.trim())
        ? Number(value.trim())
        : NaN;
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new GitHubApiError(`Invalid ${label}`, 400);
  }
  return num;
}

function parseRateLimitHeaders(headers: Headers): RateLimitBucket | null {
  const remaining = headers.get('x-ratelimit-remaining');
  const limit = headers.get('x-ratelimit-limit');
  const reset = headers.get('x-ratelimit-reset');
  if (remaining === null || limit === null || reset === null) {
    return null;
  }
  const remNum = Number(remaining);
  const limNum = Number(limit);
  const resetNum = Number(reset);
  if (!Number.isFinite(remNum) || !Number.isFinite(limNum) || !Number.isFinite(resetNum)) {
    return null;
  }
  return {
    remaining: remNum,
    limit: limNum,
    resetAt: new Date(resetNum * 1000).toISOString(),
  };
}

function parseResetAtFromResponse(headers: Headers, nowMs: number): string {
  const headerBucket = parseRateLimitHeaders(headers);
  if (headerBucket) {
    return headerBucket.resetAt;
  }
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return new Date(nowMs + seconds * 1000).toISOString();
    }
  }
  return new Date(nowMs + 60_000).toISOString();
}

function parseSsoHeader(headerValue: string | null): string | undefined {
  if (!headerValue) {
    return undefined;
  }
  const match = headerValue.match(/url=([^\s;]+)/i);
  if (!match?.[1]) {
    return undefined;
  }
  try {
    const parsed = new URL(match[1]);
    if (parsed.protocol === 'https:' && parsed.hostname === 'github.com') {
      // Strip query parameters like authorization_token so no ephemeral credential leaks.
      return `${parsed.origin}${parsed.pathname}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

interface GraphQLErrorItem {
  type?: string;
  message?: string;
  path?: Array<string | number>;
}

interface GraphQLRawResponse<TData> {
  data?: TData;
  errors?: GraphQLErrorItem[];
}

export interface AuthoredPullsResult {
  login: string;
  pullRequests: RawPullRequest[];
  rateLimit: RateLimitBucket | null;
  warnings: SnapshotWarning[];
  cost: number;
}

export interface ReviewQueueResult {
  pullRequests: RawPullRequest[];
  rateLimit: RateLimitBucket | null;
  warnings: SnapshotWarning[];
  cost: number;
}

export type ProbeMergeabilityResult =
  | {
      status: 'ok';
      mergeable: boolean | null;
      mergeableState: string | null;
      etag?: string;
      coreRateLimit: RateLimitBucket | null;
    }
  | {
      status: 'not-modified';
      coreRateLimit: RateLimitBucket | null;
    }
  | {
      status: 'unavailable';
      coreRateLimit: RateLimitBucket | null;
    };

export interface DraftBranchCompareItem {
  key: string;
  owner: string;
  repo: string;
  baseRefName: string;
  baseRefOid: string;
  headRefOid: string;
}

export interface DraftBranchCompareResult {
  behindByByKey: Record<string, number>;
  rateLimit: RateLimitBucket | null;
}

export interface GitHubClient {
  fetchAuthoredPulls(options?: { maxPages?: number }): Promise<AuthoredPullsResult>;
  fetchReviewQueue(): Promise<ReviewQueueResult>;
  fetchRepoPulls(
    owner: string,
    repo: string,
    options?: { maxPages?: number },
  ): Promise<ReviewQueueResult>;
  probeMergeability(
    owner: string,
    repo: string,
    number: number,
    etag?: string,
  ): Promise<ProbeMergeabilityResult>;
  compareDraftBranches?(items: DraftBranchCompareItem[]): Promise<DraftBranchCompareResult>;
  fetchPullDetail(owner: string, repo: string, number: number): Promise<PrDetailResponse>;
  updatePullBranch(
    owner: string,
    repo: string,
    number: number,
    expectedHeadSha?: string,
  ): Promise<UpdateBranchResponse>;
  setPullDraftState(
    owner: string,
    repo: string,
    number: number,
    isDraft: boolean,
  ): Promise<ToggleDraftResponse>;
  mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    options?: { mergeMethod?: MergeMethod; expectedHeadSha?: string },
  ): Promise<MergePullResponse>;
  fetchRepoLabels(owner: string, repo: string): Promise<PrLabel[]>;
  setPullLabels(owner: string, repo: string, number: number, labels: string[]): Promise<PrLabel[]>;
  rerunFailedChecks(
    owner: string,
    repo: string,
    number: number,
    options?: { expectedHeadSha?: string; jobId?: number; runId?: number },
  ): Promise<RerunFailedChecksResponse>;
  invalidatePullDetailCache?(owner?: string, repo?: string, number?: number): void;
}

export interface GitHubClientDeps {
  tokenStore: TokenStore;
  fetchFn?: typeof fetch;
  now?: () => number;
}

function parseGraphqlErrors(
  errors: GraphQLErrorItem[] | undefined,
  ssoUrl: string | undefined,
  token: string,
): SnapshotWarning[] {
  if (!errors || errors.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const warnings: SnapshotWarning[] = [];

  for (const item of errors) {
    const msg = redactToken(item.message ?? 'Unknown GraphQL partial error', token);
    const isSso =
      item.type === 'FORBIDDEN' || /\bsaml\b|\bsso\b|resource protected by organization/i.test(msg);
    const code = isSso ? 'sso-required' : 'graphql-partial-error';
    const key = `${code}:${msg}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    warnings.push({
      code,
      message: msg,
      ...(isSso && ssoUrl ? { ssoUrl } : {}),
    });
  }

  return warnings;
}

function mapCheckToDetail(node: Record<string, unknown>): PrDetailCheck | null {
  const typename = node.__typename;
  if (typename === 'CheckRun') {
    const status = String(node.status ?? 'UNKNOWN');
    const conclusion = node.conclusion ? String(node.conclusion) : null;
    let bucket: PrDetailCheck['bucket'] = 'passing';
    if (status !== 'COMPLETED') {
      bucket = 'pending';
    } else if (
      conclusion === 'FAILURE' ||
      conclusion === 'TIMED_OUT' ||
      conclusion === 'ACTION_REQUIRED' ||
      conclusion === 'STARTUP_FAILURE' ||
      conclusion === 'CANCELLED'
    ) {
      bucket = 'failing';
    }
    const checkRunId =
      typeof node.databaseId === 'number' && Number.isSafeInteger(node.databaseId)
        ? node.databaseId
        : null;
    const checkSuite =
      node.checkSuite && typeof node.checkSuite === 'object'
        ? (node.checkSuite as { workflowRun?: { databaseId?: unknown } | null })
        : null;
    const rawWorkflowRunId = checkSuite?.workflowRun?.databaseId;
    const workflowRunId =
      typeof rawWorkflowRunId === 'number' && Number.isSafeInteger(rawWorkflowRunId)
        ? rawWorkflowRunId
        : null;
    return {
      name: String(node.name ?? 'check'),
      kind: 'CheckRun',
      status,
      conclusion,
      bucket,
      url: typeof node.detailsUrl === 'string' ? node.detailsUrl : null,
      description: null,
      startedAt: typeof node.startedAt === 'string' ? node.startedAt : null,
      completedAt: typeof node.completedAt === 'string' ? node.completedAt : null,
      checkRunId,
      workflowRunId,
    };
  }
  if (typename === 'StatusContext') {
    const state = String(node.state ?? 'PENDING');
    let bucket: PrDetailCheck['bucket'] = 'pending';
    if (state === 'SUCCESS') {
      bucket = 'passing';
    } else if (state === 'FAILURE' || state === 'ERROR') {
      bucket = 'failing';
    }
    return {
      name: String(node.context ?? 'status'),
      kind: 'StatusContext',
      status: state,
      conclusion: state,
      bucket,
      url: typeof node.targetUrl === 'string' ? node.targetUrl : null,
      description: typeof node.description === 'string' ? node.description : null,
      startedAt: null,
      completedAt: null,
    };
  }
  return null;
}

function mapTimelineNode(node: Record<string, unknown>, index: number): PrTimelineItem | null {
  const typename = String(node.__typename ?? '');
  if (typename === 'PullRequestCommit') {
    const commit = (node.commit ?? {}) as Record<string, unknown>;
    const author = (commit.author ?? {}) as Record<string, unknown>;
    const user = (author.user ?? {}) as Record<string, unknown>;
    const oid = String(commit.abbreviatedOid ?? index);
    return {
      id: `commit-${oid}`,
      kind: 'commit',
      actor: String(user.login ?? author.name ?? 'unknown'),
      createdAt: String(commit.committedDate ?? ''),
      summary: `${oid}: ${String(commit.messageHeadline ?? 'Commit')}`,
    };
  }
  if (typename === 'PullRequestReview') {
    const author = (node.author ?? {}) as Record<string, unknown>;
    const state = String(node.state ?? 'COMMENTED');
    return {
      id: String(node.id ?? `review-${index}`),
      kind: 'review',
      actor: String(author.login ?? 'ghost'),
      createdAt: String(node.submittedAt ?? ''),
      summary: `Submitted review (${state.toLowerCase().replace(/_/g, ' ')})`,
      state,
    };
  }
  if (typename === 'IssueComment') {
    const author = (node.author ?? {}) as Record<string, unknown>;
    const body = String(node.bodyText ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    const excerpt = body.length > 140 ? `${body.slice(0, 137)}...` : body || 'Commented';
    return {
      id: String(node.id ?? `comment-${index}`),
      kind: 'comment',
      actor: String(author.login ?? 'ghost'),
      createdAt: String(node.createdAt ?? ''),
      summary: excerpt,
    };
  }

  const eventMap: Record<string, { kind: PrTimelineItem['kind']; summary: string }> = {
    ReadyForReviewEvent: { kind: 'ready_for_review', summary: 'Marked ready for review' },
    ConvertToDraftEvent: { kind: 'converted_to_draft', summary: 'Converted to draft' },
    MergedEvent: { kind: 'merged', summary: 'Merged pull request' },
    ClosedEvent: { kind: 'closed', summary: 'Closed pull request' },
    ReopenedEvent: { kind: 'reopened', summary: 'Reopened pull request' },
  };
  const mapped = eventMap[typename];
  if (!mapped) {
    return null;
  }
  const actor = (node.actor ?? {}) as Record<string, unknown>;
  return {
    id: String(node.id ?? `${typename}-${index}`),
    kind: mapped.kind,
    actor: String(actor.login ?? 'ghost'),
    createdAt: String(node.createdAt ?? ''),
    summary: mapped.summary,
  };
}

function mapGraphqlStrictError(
  errors: GraphQLErrorItem[],
  token: string,
  fallbackMessage: string,
): GitHubApiError | GitHubNotFoundError {
  const first = errors[0];
  const msg = redactToken(first?.message?.trim() || fallbackMessage, token);
  if (first?.type === 'NOT_FOUND') {
    return new GitHubNotFoundError(msg);
  }
  if (first?.type === 'FORBIDDEN' || /forbidden|not authorized|permission|saml|sso/i.test(msg)) {
    return new GitHubApiError(msg, 403);
  }
  if (first?.type === 'UNPROCESSABLE' || /draft|already|cannot|closed|merged/i.test(msg)) {
    return new GitHubApiError(msg, 422);
  }
  return new GitHubApiError(msg, 502);
}

const FAILED_WORKFLOW_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'startup_failure',
  'cancelled',
  'action_required',
]);

interface ActionsWorkflowRunItem {
  id?: unknown;
  workflow_id?: unknown;
  run_number?: unknown;
  status?: unknown;
  conclusion?: unknown;
  created_at?: unknown;
}

export function selectFailedLatestWorkflowRunIds(runs: ActionsWorkflowRunItem[]): number[] {
  const latestByWorkflow = new Map<
    string,
    { id: number; createdMs: number; runNumber: number; status: string; conclusion: string | null }
  >();

  for (const run of runs) {
    if (typeof run?.id !== 'number' || !Number.isSafeInteger(run.id) || run.id <= 0) {
      continue;
    }
    const wfKey =
      typeof run.workflow_id === 'number' && Number.isSafeInteger(run.workflow_id)
        ? `wf:${run.workflow_id}`
        : `run:${run.id}`;
    const createdMs = typeof run.created_at === 'string' ? Date.parse(run.created_at) : NaN;
    const normalizedCreatedMs = Number.isFinite(createdMs) ? createdMs : 0;
    const runNumber = typeof run.run_number === 'number' ? run.run_number : 0;
    const status = typeof run.status === 'string' ? run.status.toLowerCase() : '';
    const conclusion = typeof run.conclusion === 'string' ? run.conclusion.toLowerCase() : null;

    const existing = latestByWorkflow.get(wfKey);
    const isNewer =
      !existing ||
      normalizedCreatedMs > existing.createdMs ||
      (normalizedCreatedMs === existing.createdMs &&
        (runNumber > existing.runNumber ||
          (runNumber === existing.runNumber && run.id > existing.id)));

    if (isNewer) {
      latestByWorkflow.set(wfKey, {
        id: run.id,
        createdMs: normalizedCreatedMs,
        runNumber,
        status,
        conclusion,
      });
    }
  }

  const failedIds: number[] = [];
  for (const entry of latestByWorkflow.values()) {
    if (
      entry.status === 'completed' &&
      entry.conclusion !== null &&
      FAILED_WORKFLOW_CONCLUSIONS.has(entry.conclusion)
    ) {
      failedIds.push(entry.id);
    }
  }
  return failedIds;
}

function mapActionsError(
  response: Response,
  rawText: string,
  token: string,
  nowMs: number,
  fallbackLabel: string,
): GitHubAuthError | GitHubNotFoundError | GitHubRateLimitError | GitHubApiError {
  const coreRateLimit = parseRateLimitHeaders(response.headers);
  if (response.status === 401) {
    return new GitHubAuthError(`GitHub rejected token (${fallbackLabel}: 401 Unauthorized)`);
  }
  if (response.status === 404) {
    return new GitHubNotFoundError(`${fallbackLabel}: resource not found or inaccessible`);
  }
  if (response.status === 403 || response.status === 429) {
    const isRateLimit =
      response.status === 429 ||
      coreRateLimit?.remaining === 0 ||
      response.headers.has('retry-after');
    if (isRateLimit) {
      return new GitHubRateLimitError(
        `GitHub REST rate limit exceeded (HTTP ${response.status})`,
        parseResetAtFromResponse(response.headers, nowMs),
      );
    }
  }

  let parsedMessage: string | null = null;
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText) as { message?: unknown };
      if (typeof parsed?.message === 'string' && parsed.message.trim().length > 0) {
        parsedMessage = parsed.message.trim();
      }
    } catch {
      parsedMessage = null;
    }
  }

  const baseMessage = parsedMessage ?? `${fallbackLabel} (HTTP ${response.status})`;
  if (response.status === 403 && !/actions|permission/i.test(baseMessage)) {
    return new GitHubApiError(
      redactToken(`${baseMessage} (requires Actions write permission on your GitHub token)`, token),
      403,
    );
  }
  return new GitHubApiError(redactToken(baseMessage, token), response.status);
}

const PULL_DETAIL_CACHE_TTL_MS = 30_000;
const REPO_LABELS_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_REPO_PULLS_PAGE_SIZE = 12;
const MIN_REPO_PULLS_PAGE_SIZE = 6;
const TRANSIENT_GRAPHQL_RE =
  /something went wrong while executing your query|timed?\s*out|bad gateway|service unavailable/i;

function isTransientGraphqlError(error: unknown): boolean {
  if (!(error instanceof GitHubApiError)) {
    return false;
  }
  if (error.status === 502 || error.status === 503 || error.status === 504) {
    return true;
  }
  return TRANSIENT_GRAPHQL_RE.test(error.message);
}

export function createGitHubClient(deps: GitHubClientDeps): GitHubClient {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => Date.now());

  const pullDetailCache = new Map<string, { fetchedAtMs: number; value: PrDetailResponse }>();
  const pullDetailInFlight = new Map<string, Promise<PrDetailResponse>>();
  const repoLabelsCache = new Map<string, { fetchedAtMs: number; value: PrLabel[] }>();
  const repoLabelsInFlight = new Map<string, Promise<PrLabel[]>>();

  function invalidatePullDetailCache(owner?: string, repo?: string, number?: number): void {
    if (owner === undefined || repo === undefined || number === undefined) {
      pullDetailCache.clear();
      return;
    }
    pullDetailCache.delete(`${owner}/${repo}#${number}`);
  }

  async function executeGraphql<TData>(
    query: string,
    variables: Record<string, unknown> = {},
    options: { allowRetry?: boolean; strictErrors?: boolean } = {},
  ): Promise<{
    data: TData;
    warnings: SnapshotWarning[];
    headerRateLimit: RateLimitBucket | null;
  }> {
    const token = await deps.tokenStore.getToken();
    const maxAttempts = options.allowRetry === false ? 1 : 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetchFn(GITHUB_GRAPHQL_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'ghcc/0.1',
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (error) {
        if (attempt + 1 < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        throw new GitHubApiError(
          `GitHub GraphQL network error: ${sanitizeErrorMessage(error, token)}`,
          502,
        );
      }

      if (
        (response.status === 502 || response.status === 503 || response.status === 504) &&
        attempt + 1 < maxAttempts
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }

      const headerRateLimit = parseRateLimitHeaders(response.headers);
      const ssoUrl = parseSsoHeader(response.headers.get('x-github-sso'));

      if (response.status === 401) {
        throw new GitHubAuthError('GitHub rejected token (401 Unauthorized)');
      }

      if (response.status === 403 || response.status === 429) {
        const bodyText = redactToken(await response.text().catch(() => ''), token);
        const isRateLimit =
          response.status === 429 ||
          headerRateLimit?.remaining === 0 ||
          response.headers.has('retry-after') ||
          /rate limit/i.test(bodyText);
        if (isRateLimit) {
          const resetAt = parseResetAtFromResponse(response.headers, now());
          throw new GitHubRateLimitError(
            `GitHub rate limit exceeded (HTTP ${response.status})`,
            resetAt,
          );
        }
        throw new GitHubApiError(
          `GitHub API forbidden (HTTP 403)${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
          403,
        );
      }

      if (!response.ok) {
        const bodyText = redactToken(await response.text().catch(() => ''), token);
        throw new GitHubApiError(
          `GitHub GraphQL error HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
          response.status,
        );
      }

      let payload: GraphQLRawResponse<TData>;
      try {
        payload = (await response.json()) as GraphQLRawResponse<TData>;
      } catch (error) {
        throw new GitHubApiError(
          `Invalid JSON from GitHub GraphQL: ${sanitizeErrorMessage(error, token)}`,
          502,
        );
      }

      if (options.strictErrors && payload.errors && payload.errors.length > 0) {
        throw mapGraphqlStrictError(payload.errors, token, 'GitHub GraphQL mutation failed');
      }

      const warnings = parseGraphqlErrors(payload.errors, ssoUrl, token);
      if (!payload.data) {
        const msg = warnings[0]?.message ?? 'GitHub GraphQL returned empty data';
        if (attempt + 1 < maxAttempts && TRANSIENT_GRAPHQL_RE.test(msg)) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        throw new GitHubApiError(msg, 502);
      }

      return { data: payload.data, warnings, headerRateLimit };
    }

    throw new GitHubApiError('GitHub GraphQL request failed after retries', 502);
  }

  return {
    async fetchAuthoredPulls(options = {}): Promise<AuthoredPullsResult> {
      const maxPages = options.maxPages ?? 10;
      const pullRequests: RawPullRequest[] = [];
      const warnings: SnapshotWarning[] = [];
      let cursor: string | null = null;
      let login = '';
      let rateLimit: RateLimitBucket | null = null;
      let totalCost = 0;

      for (let page = 0; page < maxPages; page++) {
        interface SnapshotPageData {
          viewer?: {
            login: string;
            pullRequests: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              nodes: Array<RawPullRequest | null>;
            };
          };
          rateLimit?: {
            limit: number;
            cost: number;
            remaining: number;
            resetAt: string;
          };
        }

        const res: {
          data: SnapshotPageData;
          warnings: SnapshotWarning[];
          headerRateLimit: RateLimitBucket | null;
        } = await executeGraphql<SnapshotPageData>(SNAPSHOT_QUERY, { cursor });

        warnings.push(...res.warnings);

        if (res.data.rateLimit) {
          rateLimit = {
            remaining: res.data.rateLimit.remaining,
            limit: res.data.rateLimit.limit,
            resetAt: res.data.rateLimit.resetAt,
          };
          totalCost += res.data.rateLimit.cost ?? 0;
        } else if (res.headerRateLimit) {
          rateLimit = res.headerRateLimit;
        }

        if (res.data.viewer) {
          login = res.data.viewer.login;
          for (const node of res.data.viewer.pullRequests.nodes) {
            if (node) {
              pullRequests.push(node);
            }
          }
          const pageInfo = res.data.viewer.pullRequests.pageInfo;
          if (!pageInfo.hasNextPage || !pageInfo.endCursor) {
            break;
          }
          cursor = pageInfo.endCursor;
        } else {
          break;
        }
      }

      return { login, pullRequests, rateLimit, warnings, cost: totalCost };
    },

    async fetchReviewQueue(): Promise<ReviewQueueResult> {
      interface ReviewQueueData {
        search?: {
          nodes: Array<RawPullRequest | Record<string, never> | null>;
        };
        rateLimit?: {
          limit: number;
          cost: number;
          remaining: number;
          resetAt: string;
        };
      }

      const res = await executeGraphql<ReviewQueueData>(REVIEW_QUEUE_QUERY);
      const pullRequests: RawPullRequest[] = [];
      for (const node of res.data.search?.nodes ?? []) {
        if (node && 'id' in node && typeof node.id === 'string') {
          pullRequests.push(node as RawPullRequest);
        }
      }

      const rateLimit = res.data.rateLimit
        ? {
            remaining: res.data.rateLimit.remaining,
            limit: res.data.rateLimit.limit,
            resetAt: res.data.rateLimit.resetAt,
          }
        : res.headerRateLimit;

      return {
        pullRequests,
        rateLimit,
        warnings: res.warnings,
        cost: res.data.rateLimit?.cost ?? 0,
      };
    },

    async fetchRepoPulls(owner: string, repo: string, options = {}): Promise<ReviewQueueResult> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      let maxPages = options.maxPages ?? 12;
      const pullRequests: RawPullRequest[] = [];
      const warnings: SnapshotWarning[] = [];
      let cursor: string | null = null;
      let rateLimit: RateLimitBucket | null = null;
      let totalCost = 0;
      let pageSize = DEFAULT_REPO_PULLS_PAGE_SIZE;

      interface RepoPullsData {
        repository?: {
          pullRequests: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<RawPullRequest | null>;
          };
        } | null;
        rateLimit?: {
          limit: number;
          cost: number;
          remaining: number;
          resetAt: string;
        };
      }

      for (let page = 0; page < maxPages; page++) {
        let res!: {
          data: RepoPullsData;
          warnings: SnapshotWarning[];
          headerRateLimit: RateLimitBucket | null;
        };

        while (true) {
          try {
            res = await executeGraphql<RepoPullsData>(REPO_PULLS_QUERY, {
              owner: safeOwner,
              repo: safeRepo,
              cursor,
              first: pageSize,
            });
            break;
          } catch (error) {
            if (isTransientGraphqlError(error) && pageSize > MIN_REPO_PULLS_PAGE_SIZE) {
              pageSize = Math.max(MIN_REPO_PULLS_PAGE_SIZE, Math.floor(pageSize / 2));
              maxPages = Math.min(24, maxPages * 2);
              continue;
            }
            throw error;
          }
        }

        warnings.push(...res.warnings);

        if (res.data.rateLimit) {
          rateLimit = {
            remaining: res.data.rateLimit.remaining,
            limit: res.data.rateLimit.limit,
            resetAt: res.data.rateLimit.resetAt,
          };
          totalCost += res.data.rateLimit.cost ?? 0;
        } else if (res.headerRateLimit) {
          rateLimit = res.headerRateLimit;
        }

        const prConn = res.data.repository?.pullRequests;
        if (!prConn) {
          break;
        }

        for (const node of prConn.nodes) {
          if (node) {
            pullRequests.push(node);
          }
        }

        if (!prConn.pageInfo.hasNextPage || !prConn.pageInfo.endCursor) {
          break;
        }
        cursor = prConn.pageInfo.endCursor;
      }

      return { pullRequests, rateLimit, warnings, cost: totalCost };
    },

    async probeMergeability(
      owner: string,
      repo: string,
      number: number,
      etag?: string,
    ): Promise<ProbeMergeabilityResult> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const safeNum = validatePullNumber(number);
      const token = await deps.tokenStore.getToken();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ghcc/0.1',
      };
      if (etag) {
        headers['If-None-Match'] = etag;
      }

      let response: Response;
      try {
        response = await fetchFn(
          `${GITHUB_REST_BASE}/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/pulls/${safeNum}`,
          { method: 'GET', headers },
        );
      } catch {
        return { status: 'unavailable', coreRateLimit: null };
      }

      const coreRateLimit = parseRateLimitHeaders(response.headers);

      if (response.status === 401) {
        throw new GitHubAuthError('GitHub rejected token on REST probe (401 Unauthorized)');
      }

      if (response.status === 304) {
        return { status: 'not-modified', coreRateLimit };
      }

      if (response.status === 403 || response.status === 429) {
        const isRateLimit =
          response.status === 429 ||
          coreRateLimit?.remaining === 0 ||
          response.headers.has('retry-after');
        if (isRateLimit) {
          throw new GitHubRateLimitError(
            `GitHub REST rate limit exceeded (HTTP ${response.status})`,
            parseResetAtFromResponse(response.headers, now()),
          );
        }
        return { status: 'unavailable', coreRateLimit };
      }

      if (!response.ok) {
        return { status: 'unavailable', coreRateLimit };
      }

      const body = (await response.json()) as {
        mergeable?: boolean | null;
        mergeable_state?: string | null;
      };
      const respEtag = response.headers.get('etag') ?? undefined;
      return {
        status: 'ok',
        mergeable: body.mergeable ?? null,
        mergeableState: body.mergeable_state ?? null,
        // Only surface an ETag when mergeable is non-null per §5.
        etag: body.mergeable !== null && body.mergeable !== undefined ? respEtag : undefined,
        coreRateLimit,
      };
    },

    async compareDraftBranches(items: DraftBranchCompareItem[]): Promise<DraftBranchCompareResult> {
      const MAX_COMPARE_BATCH = 25;
      const groups = new Map<
        string,
        { owner: string; repo: string; baseRefName: string; items: DraftBranchCompareItem[] }
      >();

      for (const item of items) {
        if (
          !SAFE_SEGMENT_RE.test(item.owner) ||
          !SAFE_SEGMENT_RE.test(item.repo) ||
          !item.baseRefName.trim() ||
          !SAFE_SHA_RE.test(item.headRefOid)
        ) {
          continue;
        }
        const groupKey = `${item.owner}/${item.repo}\0${item.baseRefName}`;
        let group = groups.get(groupKey);
        if (!group) {
          group = {
            owner: item.owner,
            repo: item.repo,
            baseRefName: item.baseRefName,
            items: [],
          };
          groups.set(groupKey, group);
        }
        group.items.push(item);
      }

      const chunks: Array<{
        owner: string;
        repo: string;
        baseRefName: string;
        items: DraftBranchCompareItem[];
      }> = [];
      for (const group of groups.values()) {
        for (let offset = 0; offset < group.items.length; offset += MAX_COMPARE_BATCH) {
          chunks.push({
            owner: group.owner,
            repo: group.repo,
            baseRefName: group.baseRefName,
            items: group.items.slice(offset, offset + MAX_COMPARE_BATCH),
          });
        }
      }

      const behindByByKey: Record<string, number> = {};
      let latestRateLimit: RateLimitBucket | null = null;

      if (chunks.length === 0) {
        return { behindByByKey, rateLimit: latestRateLimit };
      }

      interface CompareBatchData {
        rateLimit?: RateLimitBucket;
        repository?: {
          ref?: Record<string, { behindBy?: number | null } | null> | null;
        } | null;
      }

      const queue = [...chunks];
      const concurrency = Math.min(2, queue.length);

      async function runWorker(): Promise<void> {
        while (queue.length > 0) {
          const chunk = queue.shift();
          if (!chunk) {
            continue;
          }
          const varDefs = ['$owner: String!', '$repo: String!', '$baseRef: String!'];
          const selections: string[] = [];
          const variables: Record<string, unknown> = {
            owner: chunk.owner,
            repo: chunk.repo,
            baseRef: `refs/heads/${chunk.baseRefName}`,
          };
          for (let i = 0; i < chunk.items.length; i++) {
            varDefs.push(`$h${i}: String!`);
            selections.push(`c${i}: compare(headRef: $h${i}) { behindBy }`);
            variables[`h${i}`] = chunk.items[i]!.headRefOid;
          }
          const query = `
            query CompareDraftBranches(${varDefs.join(', ')}) {
              rateLimit {
                remaining
                limit
                resetAt
              }
              repository(owner: $owner, name: $repo) {
                ref(qualifiedName: $baseRef) {
                  ${selections.join('\n')}
                }
              }
            }
          `;
          try {
            const { data, headerRateLimit } = await executeGraphql<CompareBatchData>(
              query,
              variables,
              { strictErrors: false },
            );
            latestRateLimit = data.rateLimit ?? headerRateLimit ?? latestRateLimit;
            const refObj = data.repository?.ref;
            if (!refObj) {
              continue;
            }
            for (let i = 0; i < chunk.items.length; i++) {
              const behindBy = refObj[`c${i}`]?.behindBy;
              if (typeof behindBy === 'number' && Number.isFinite(behindBy)) {
                behindByByKey[chunk.items[i]!.key] = behindBy;
              }
            }
          } catch (error) {
            if (error instanceof GitHubAuthError || error instanceof GitHubRateLimitError) {
              throw error;
            }
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
      return { behindByByKey, rateLimit: latestRateLimit };
    },

    invalidatePullDetailCache(owner: string, repo: string, number: number): void {
      invalidatePullDetailCache(owner, repo, number);
    },

    async fetchPullDetail(owner: string, repo: string, number: number): Promise<PrDetailResponse> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const safeNum = validatePullNumber(number);
      const cacheKey = `${safeOwner}/${safeRepo}#${safeNum}`;
      const cached = pullDetailCache.get(cacheKey);
      if (cached && now() - cached.fetchedAtMs < PULL_DETAIL_CACHE_TTL_MS) {
        return cached.value;
      }
      const existingFlight = pullDetailInFlight.get(cacheKey);
      if (existingFlight) {
        return existingFlight;
      }

      const loadPromise = (async (): Promise<PrDetailResponse> => {
        interface PullDetailData {
          repository?: {
            pullRequest?: {
              number: number;
              title: string;
              url: string;
              isDraft: boolean;
              bodyText: string;
              bodyHTML?: string | null;
              baseRefName: string;
              headRefName: string;
              latestReviews: {
                nodes: Array<{
                  state: PrReviewerDetail['state'];
                  submittedAt: string | null;
                  author: { login: string } | null;
                } | null>;
              };
              reviewRequests: {
                nodes: Array<{
                  asCodeOwner?: boolean;
                  requestedReviewer:
                    | { __typename: 'User'; login: string }
                    | { __typename: 'Team'; slug: string }
                    | null;
                } | null>;
              };
              commits: {
                nodes: Array<{
                  commit: {
                    statusCheckRollup: {
                      contexts: {
                        totalCount: number;
                        nodes: Array<Record<string, unknown> | null>;
                      };
                    } | null;
                  };
                } | null>;
              };
              timelineItems: {
                nodes: Array<Record<string, unknown> | null>;
              };
            } | null;
          } | null;
        }

        const res = await executeGraphql<PullDetailData>(PULL_DETAIL_QUERY, {
          owner: safeOwner,
          repo: safeRepo,
          number: safeNum,
        });

        const pr = res.data.repository?.pullRequest;
        if (!pr) {
          throw new GitHubNotFoundError(
            `Pull request ${safeOwner}/${safeRepo}#${safeNum} not found`,
          );
        }

        const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup ?? null;
        const checks: PrDetailCheck[] = [];
        for (const node of rollup?.contexts.nodes ?? []) {
          if (node) {
            const mapped = mapCheckToDetail(node);
            if (mapped) {
              checks.push(mapped);
            }
          }
        }

        const reviewerMap = new Map<string, PrReviewerDetail>();
        for (const rev of pr.latestReviews.nodes) {
          if (!rev?.author?.login) {
            continue;
          }
          reviewerMap.set(`user:${rev.author.login}`, {
            login: rev.author.login,
            kind: 'user',
            state: rev.state,
            submittedAt: rev.submittedAt,
            asCodeOwner: false,
          });
        }
        for (const req of pr.reviewRequests.nodes) {
          if (!req?.requestedReviewer) {
            continue;
          }
          if (req.requestedReviewer.__typename === 'User') {
            const existing = reviewerMap.get(`user:${req.requestedReviewer.login}`);
            reviewerMap.set(`user:${req.requestedReviewer.login}`, {
              login: req.requestedReviewer.login,
              kind: 'user',
              state: 'PENDING',
              submittedAt: existing?.submittedAt ?? null,
              asCodeOwner: Boolean(req.asCodeOwner),
            });
          } else if (req.requestedReviewer.__typename === 'Team') {
            reviewerMap.set(`team:${req.requestedReviewer.slug}`, {
              login: `@${req.requestedReviewer.slug}`,
              kind: 'team',
              state: 'PENDING',
              submittedAt: null,
              asCodeOwner: Boolean(req.asCodeOwner),
            });
          }
        }

        const timeline: PrTimelineItem[] = [];
        const tlNodes = pr.timelineItems.nodes;
        for (let i = 0; i < tlNodes.length; i++) {
          const node = tlNodes[i];
          if (!node) {
            continue;
          }
          const item = mapTimelineNode(node, i);
          if (item) {
            timeline.push(item);
          }
        }

        const rawBody = (pr.bodyText ?? '').trim();
        const bodyExcerpt = rawBody.length > 420 ? `${rawBody.slice(0, 417)}...` : rawBody;
        const bodyHtml = sanitizePrBodyHtml(pr.bodyHTML, rawBody);

        const detail: PrDetailResponse = {
          key: `${safeOwner}/${safeRepo}#${pr.number}`,
          owner: safeOwner,
          repo: safeRepo,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          baseRefName: pr.baseRefName,
          headRefName: pr.headRefName,
          isDraft: pr.isDraft,
          bodyExcerpt,
          bodyHtml,
          checksTotalCount: rollup?.contexts.totalCount ?? checks.length,
          checks,
          reviewers: Array.from(reviewerMap.values()),
          timeline: timeline.reverse(),
          fetchedAt: new Date(now()).toISOString(),
        };
        pullDetailCache.set(cacheKey, { fetchedAtMs: now(), value: detail });
        return detail;
      })();

      pullDetailInFlight.set(cacheKey, loadPromise);
      try {
        return await loadPromise;
      } finally {
        pullDetailInFlight.delete(cacheKey);
      }
    },

    async updatePullBranch(
      owner: string,
      repo: string,
      number: number,
      expectedHeadSha?: string,
    ): Promise<UpdateBranchResponse> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const safeNum = validatePullNumber(number);
      const safeSha =
        expectedHeadSha !== undefined ? validateCommitSha(expectedHeadSha) : undefined;
      const token = await deps.tokenStore.getToken();

      let response: Response;
      try {
        response = await fetchFn(
          `${GITHUB_REST_BASE}/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/pulls/${safeNum}/update-branch`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'ghcc/0.1',
            },
            body: JSON.stringify(safeSha ? { expected_head_sha: safeSha } : {}),
          },
        );
      } catch (error) {
        throw new GitHubApiError(
          `Network error updating pull request branch: ${sanitizeErrorMessage(error, token)}`,
          502,
        );
      }

      const coreRateLimit = parseRateLimitHeaders(response.headers);

      if (response.status === 401) {
        throw new GitHubAuthError('GitHub rejected token when updating branch (401 Unauthorized)');
      }

      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `Pull request ${safeOwner}/${safeRepo}#${safeNum} not found or inaccessible`,
        );
      }

      if (response.status === 403 || response.status === 429) {
        const isRateLimit =
          response.status === 429 ||
          coreRateLimit?.remaining === 0 ||
          response.headers.has('retry-after');
        if (isRateLimit) {
          throw new GitHubRateLimitError(
            `GitHub REST rate limit exceeded (HTTP ${response.status})`,
            parseResetAtFromResponse(response.headers, now()),
          );
        }
      }

      const rawText = await response.text();
      let parsedBody: { message?: unknown; url?: unknown } | null = null;
      if (rawText) {
        try {
          parsedBody = JSON.parse(rawText) as { message?: unknown; url?: unknown };
        } catch {
          parsedBody = null;
        }
      }

      if (!response.ok) {
        const rawMessage =
          typeof parsedBody?.message === 'string' && parsedBody.message.trim().length > 0
            ? parsedBody.message.trim()
            : `GitHub update-branch failed (HTTP ${response.status})`;
        throw new GitHubApiError(redactToken(rawMessage, token), response.status);
      }

      const message =
        typeof parsedBody?.message === 'string' && parsedBody.message.trim().length > 0
          ? redactToken(parsedBody.message.trim(), token)
          : 'Updating pull request branch.';

      return {
        ok: true,
        message,
        ...(typeof parsedBody?.url === 'string' ? { url: parsedBody.url } : {}),
      };
    },

    async setPullDraftState(
      owner: string,
      repo: string,
      number: number,
      isDraft: boolean,
    ): Promise<ToggleDraftResponse> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const safeNum = validatePullNumber(number);

      interface PullNodeIdData {
        repository?: {
          pullRequest?: {
            id: string;
            isDraft: boolean;
          } | null;
        } | null;
      }

      const lookup = await executeGraphql<PullNodeIdData>(
        PULL_NODE_ID_QUERY,
        { owner: safeOwner, repo: safeRepo, number: safeNum },
        { strictErrors: true },
      );

      const pr = lookup.data.repository?.pullRequest;
      if (!pr) {
        throw new GitHubNotFoundError(
          `Pull request ${safeOwner}/${safeRepo}#${safeNum} not found or inaccessible`,
        );
      }

      if (pr.isDraft === isDraft) {
        return { ok: true, isDraft: pr.isDraft };
      }

      interface DraftMutationData {
        convertPullRequestToDraft?: {
          pullRequest?: { id: string; isDraft: boolean } | null;
        } | null;
        markPullRequestReadyForReview?: {
          pullRequest?: { id: string; isDraft: boolean } | null;
        } | null;
      }

      const mutation = isDraft ? CONVERT_PR_TO_DRAFT_MUTATION : MARK_PR_READY_MUTATION;
      const res = await executeGraphql<DraftMutationData>(
        mutation,
        { pullRequestId: pr.id },
        { allowRetry: false, strictErrors: true },
      );

      const updated = isDraft
        ? res.data.convertPullRequestToDraft?.pullRequest
        : res.data.markPullRequestReadyForReview?.pullRequest;

      if (!updated) {
        throw new GitHubApiError('GitHub did not return updated pull request draft state', 502);
      }

      return { ok: true, isDraft: updated.isDraft };
    },

    async mergePullRequest(
      owner: string,
      repo: string,
      number: number,
      options: { mergeMethod?: MergeMethod; expectedHeadSha?: string } = {},
    ): Promise<MergePullResponse> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const safeNum = validatePullNumber(number);
      const mergeMethod: MergeMethod = options.mergeMethod === 'merge' ? 'merge' : 'squash';
      const safeSha =
        options.expectedHeadSha !== undefined
          ? validateCommitSha(options.expectedHeadSha)
          : undefined;
      const token = await deps.tokenStore.getToken();

      let response: Response;
      try {
        response = await fetchFn(
          `${GITHUB_REST_BASE}/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/pulls/${safeNum}/merge`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'ghcc/0.1',
            },
            body: JSON.stringify({
              merge_method: mergeMethod,
              ...(safeSha ? { sha: safeSha } : {}),
            }),
          },
        );
      } catch (error) {
        throw new GitHubApiError(
          `Network error merging pull request: ${sanitizeErrorMessage(error, token)}`,
          502,
        );
      }

      const coreRateLimit = parseRateLimitHeaders(response.headers);

      if (response.status === 401) {
        throw new GitHubAuthError(
          'GitHub rejected token when merging pull request (401 Unauthorized)',
        );
      }

      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `Pull request ${safeOwner}/${safeRepo}#${safeNum} not found or inaccessible`,
        );
      }

      if (response.status === 403 || response.status === 429) {
        const isRateLimit =
          response.status === 429 ||
          coreRateLimit?.remaining === 0 ||
          response.headers.has('retry-after');
        if (isRateLimit) {
          throw new GitHubRateLimitError(
            `GitHub REST rate limit exceeded (HTTP ${response.status})`,
            parseResetAtFromResponse(response.headers, now()),
          );
        }
      }

      const rawText = await response.text();
      let parsedBody: { sha?: unknown; merged?: unknown; message?: unknown } | null = null;
      if (rawText) {
        try {
          parsedBody = JSON.parse(rawText) as {
            sha?: unknown;
            merged?: unknown;
            message?: unknown;
          };
        } catch {
          parsedBody = null;
        }
      }

      if (!response.ok || parsedBody?.merged === false) {
        const rawMessage =
          typeof parsedBody?.message === 'string' && parsedBody.message.trim().length > 0
            ? parsedBody.message.trim()
            : `GitHub merge failed (HTTP ${response.status})`;
        throw new GitHubApiError(
          redactToken(rawMessage, token),
          response.ok ? 409 : response.status,
        );
      }

      const message =
        typeof parsedBody?.message === 'string' && parsedBody.message.trim().length > 0
          ? redactToken(parsedBody.message.trim(), token)
          : 'Pull Request successfully merged';

      return {
        ok: true,
        merged: true,
        sha: typeof parsedBody?.sha === 'string' ? parsedBody.sha : '',
        message,
        mergeMethod,
      };
    },

    async fetchRepoLabels(owner: string, repo: string): Promise<PrLabel[]> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const cacheKey = `${safeOwner}/${safeRepo}`;
      const cached = repoLabelsCache.get(cacheKey);
      if (cached && now() - cached.fetchedAtMs < REPO_LABELS_CACHE_TTL_MS) {
        return cached.value;
      }
      const existingFlight = repoLabelsInFlight.get(cacheKey);
      if (existingFlight) {
        return existingFlight;
      }

      const loadPromise = (async (): Promise<PrLabel[]> => {
        const token = await deps.tokenStore.getToken();

        let response: Response;
        try {
          response = await fetchFn(
            `${GITHUB_REST_BASE}/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/labels?per_page=100`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'ghcc/0.1',
              },
            },
          );
        } catch (error) {
          throw new GitHubApiError(
            `Network error loading repository labels: ${sanitizeErrorMessage(error, token)}`,
            502,
          );
        }

        const coreRateLimit = parseRateLimitHeaders(response.headers);
        if (response.status === 401) {
          throw new GitHubAuthError('GitHub rejected token loading labels (401 Unauthorized)');
        }
        if (response.status === 404) {
          throw new GitHubNotFoundError(
            `Repository ${safeOwner}/${safeRepo} labels not found or inaccessible`,
          );
        }
        if (response.status === 403 || response.status === 429) {
          const isRateLimit =
            response.status === 429 ||
            coreRateLimit?.remaining === 0 ||
            response.headers.has('retry-after');
          if (isRateLimit) {
            throw new GitHubRateLimitError(
              `GitHub REST rate limit exceeded (HTTP ${response.status})`,
              parseResetAtFromResponse(response.headers, now()),
            );
          }
        }
        if (!response.ok) {
          const bodyText = redactToken(await response.text().catch(() => ''), token);
          throw new GitHubApiError(
            `GitHub labels fetch failed (HTTP ${response.status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`,
            response.status,
          );
        }

        const payload = (await response.json()) as Array<{
          name?: unknown;
          color?: unknown;
          description?: unknown;
        }>;
        if (!Array.isArray(payload)) {
          repoLabelsCache.set(cacheKey, { fetchedAtMs: now(), value: [] });
          return [];
        }

        const safeHex = /^[0-9a-f]{6}$/i;
        const labels = payload
          .filter((item) => typeof item?.name === 'string' && item.name.trim().length > 0)
          .map((item) => {
            const rawColor =
              typeof item.color === 'string' ? item.color.trim().replace(/^#/, '') : '';
            return {
              name: String(item.name),
              color: safeHex.test(rawColor) ? rawColor.toLowerCase() : '64748b',
              description:
                typeof item.description === 'string' && item.description.trim().length > 0
                  ? item.description.trim()
                  : null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        repoLabelsCache.set(cacheKey, { fetchedAtMs: now(), value: labels });
        return labels;
      })();

      repoLabelsInFlight.set(cacheKey, loadPromise);
      try {
        return await loadPromise;
      } finally {
        repoLabelsInFlight.delete(cacheKey);
      }
    },

    async setPullLabels(
      owner: string,
      repo: string,
      number: number,
      labels: string[],
    ): Promise<PrLabel[]> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const safeNum = validatePullNumber(number);
      const token = await deps.tokenStore.getToken();

      let response: Response;
      try {
        response = await fetchFn(
          `${GITHUB_REST_BASE}/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/issues/${safeNum}/labels`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'ghcc/0.1',
            },
            body: JSON.stringify({ labels }),
          },
        );
      } catch (error) {
        throw new GitHubApiError(
          `Network error updating pull request labels: ${sanitizeErrorMessage(error, token)}`,
          502,
        );
      }

      const coreRateLimit = parseRateLimitHeaders(response.headers);
      if (response.status === 401) {
        throw new GitHubAuthError('GitHub rejected token updating labels (401 Unauthorized)');
      }
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `Pull request ${safeOwner}/${safeRepo}#${safeNum} not found or inaccessible`,
        );
      }
      if (response.status === 403 || response.status === 429) {
        const isRateLimit =
          response.status === 429 ||
          coreRateLimit?.remaining === 0 ||
          response.headers.has('retry-after');
        if (isRateLimit) {
          throw new GitHubRateLimitError(
            `GitHub REST rate limit exceeded (HTTP ${response.status})`,
            parseResetAtFromResponse(response.headers, now()),
          );
        }
      }

      const rawText = await response.text();
      let parsedBody: unknown = null;
      if (rawText) {
        try {
          parsedBody = JSON.parse(rawText);
        } catch {
          parsedBody = null;
        }
      }

      if (!response.ok) {
        const errObj =
          parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
            ? (parsedBody as { message?: unknown })
            : null;
        const rawMessage =
          typeof errObj?.message === 'string' && errObj.message.trim().length > 0
            ? errObj.message.trim()
            : `GitHub label update failed (HTTP ${response.status})`;
        throw new GitHubApiError(redactToken(rawMessage, token), response.status);
      }

      if (!Array.isArray(parsedBody)) {
        return [];
      }
      const safeHex = /^[0-9a-f]{6}$/i;
      return parsedBody
        .filter(
          (item): item is { name: string; color?: unknown; description?: unknown } =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as { name?: unknown }).name === 'string' &&
            (item as { name: string }).name.trim().length > 0,
        )
        .map((item) => {
          const rawColor =
            typeof item.color === 'string' ? item.color.trim().replace(/^#/, '') : '';
          return {
            name: item.name,
            color: safeHex.test(rawColor) ? rawColor.toLowerCase() : '64748b',
            description:
              typeof item.description === 'string' && item.description.trim().length > 0
                ? item.description.trim()
                : null,
          };
        });
    },

    async rerunFailedChecks(
      owner: string,
      repo: string,
      number: number,
      options: { expectedHeadSha?: string; jobId?: number; runId?: number } = {},
    ): Promise<RerunFailedChecksResponse> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const safeNum = validatePullNumber(number);

      if (options.jobId !== undefined && options.runId !== undefined) {
        throw new GitHubApiError('Provide either jobId or runId, not both', 400);
      }

      const safeJobId =
        options.jobId !== undefined ? validatePositiveIntId(options.jobId, 'jobId') : undefined;
      const safeRunId =
        options.runId !== undefined ? validatePositiveIntId(options.runId, 'runId') : undefined;
      const safeSha =
        options.expectedHeadSha !== undefined
          ? validateCommitSha(options.expectedHeadSha)
          : undefined;
      const token = await deps.tokenStore.getToken();

      const restHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ghcc/0.1',
      };

      async function postActionsRerun(url: string, fallbackLabel: string): Promise<void> {
        let response: Response;
        try {
          response = await fetchFn(url, {
            method: 'POST',
            headers: restHeaders,
          });
        } catch (error) {
          throw new GitHubApiError(
            `Network error (${fallbackLabel}): ${sanitizeErrorMessage(error, token)}`,
            502,
          );
        }

        if (!response.ok) {
          const rawText = await response.text().catch(() => '');
          throw mapActionsError(response, rawText, token, now(), fallbackLabel);
        }
      }

      const repoBase = `${GITHUB_REST_BASE}/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}`;

      if (safeJobId !== undefined) {
        await postActionsRerun(
          `${repoBase}/actions/jobs/${safeJobId}/rerun`,
          `Re-running job ${safeJobId}`,
        );
        return {
          ok: true,
          scope: 'job',
          rerunCount: 1,
          runIds: [],
          jobId: safeJobId,
          message: 'Re-run requested for failed job.',
        };
      }

      if (safeRunId !== undefined) {
        await postActionsRerun(
          `${repoBase}/actions/runs/${safeRunId}/rerun-failed-jobs`,
          `Re-running workflow run ${safeRunId}`,
        );
        return {
          ok: true,
          scope: 'run',
          rerunCount: 1,
          runIds: [safeRunId],
          message: 'Re-run requested for failed jobs in workflow run.',
        };
      }

      let headSha = safeSha;
      if (!headSha) {
        let prResponse: Response;
        try {
          prResponse = await fetchFn(`${repoBase}/pulls/${safeNum}`, {
            method: 'GET',
            headers: restHeaders,
          });
        } catch (error) {
          throw new GitHubApiError(
            `Network error loading pull request head commit: ${sanitizeErrorMessage(error, token)}`,
            502,
          );
        }
        if (!prResponse.ok) {
          const rawText = await prResponse.text().catch(() => '');
          throw mapActionsError(
            prResponse,
            rawText,
            token,
            now(),
            `Pull request ${safeOwner}/${safeRepo}#${safeNum}`,
          );
        }
        const prBody = (await prResponse.json()) as { head?: { sha?: unknown } };
        if (typeof prBody?.head?.sha !== 'string') {
          throw new GitHubApiError('Could not determine pull request head commit SHA', 502);
        }
        headSha = validateCommitSha(prBody.head.sha);
      }

      let runsResponse: Response;
      try {
        runsResponse = await fetchFn(
          `${repoBase}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=100`,
          {
            method: 'GET',
            headers: restHeaders,
          },
        );
      } catch (error) {
        throw new GitHubApiError(
          `Network error listing workflow runs: ${sanitizeErrorMessage(error, token)}`,
          502,
        );
      }

      if (!runsResponse.ok) {
        const rawText = await runsResponse.text().catch(() => '');
        throw mapActionsError(runsResponse, rawText, token, now(), 'Listing GitHub Actions runs');
      }

      const runsPayload = (await runsResponse.json()) as {
        workflow_runs?: ActionsWorkflowRunItem[];
      };
      const eligibleRunIds = selectFailedLatestWorkflowRunIds(
        Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [],
      );

      if (eligibleRunIds.length === 0) {
        throw new GitHubApiError(
          'No re-runnable failed GitHub Actions runs found for this commit.',
          409,
        );
      }

      const queue = [...eligibleRunIds];
      const succeededRunIds: number[] = [];
      const errors: unknown[] = [];
      let fatalError: unknown = null;

      async function worker(): Promise<void> {
        while (queue.length > 0 && !fatalError) {
          const runId = queue.shift();
          if (runId === undefined) {
            continue;
          }
          try {
            await postActionsRerun(
              `${repoBase}/actions/runs/${runId}/rerun-failed-jobs`,
              `Re-running workflow run ${runId}`,
            );
            succeededRunIds.push(runId);
          } catch (error) {
            if (error instanceof GitHubAuthError || error instanceof GitHubRateLimitError) {
              fatalError = error;
              return;
            }
            errors.push(error);
          }
        }
      }

      const concurrency = Math.min(3, queue.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (fatalError) {
        throw fatalError;
      }

      if (succeededRunIds.length === 0) {
        throw errors[0] ?? new GitHubApiError('Failed to re-run failed GitHub Actions runs.', 502);
      }

      const runWord = succeededRunIds.length === 1 ? 'workflow run' : 'workflow runs';
      const partialNote =
        errors.length > 0
          ? ` (${errors.length} ${errors.length === 1 ? 'run' : 'runs'} could not be re-run)`
          : '';

      return {
        ok: true,
        scope: 'all',
        rerunCount: succeededRunIds.length,
        runIds: succeededRunIds,
        message: `Re-run requested for ${succeededRunIds.length} failed ${runWord}${partialNote}.`,
      };
    },
  };
}
