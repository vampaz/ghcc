import type { TokenStore } from '@/server/auth';
import type { RawPullRequest } from '@/server/derive/types';
import { redactToken, sanitizeErrorMessage } from '@/server/redact';
import type {
  PrDetailCheck,
  PrDetailResponse,
  PrReviewerDetail,
  PrTimelineItem,
  RateLimitBucket,
  SnapshotWarning,
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
                startedAt
                completedAt
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
query RepoPulls($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
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

const PULL_DETAIL_QUERY = `
query PullDetail($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      title
      url
      isDraft
      bodyText
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
                    name
                    status
                    conclusion
                    detailsUrl
                    startedAt
                    completedAt
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
  fetchPullDetail(owner: string, repo: string, number: number): Promise<PrDetailResponse>;
  updatePullBranch(
    owner: string,
    repo: string,
    number: number,
    expectedHeadSha?: string,
  ): Promise<UpdateBranchResponse>;
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

export function createGitHubClient(deps: GitHubClientDeps): GitHubClient {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => Date.now());

  async function executeGraphql<TData>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<{
    data: TData;
    warnings: SnapshotWarning[];
    headerRateLimit: RateLimitBucket | null;
  }> {
    const token = await deps.tokenStore.getToken();
    let response!: Response;
    for (let attempt = 0; attempt < 2; attempt++) {
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
        throw new GitHubApiError(
          `GitHub GraphQL network error: ${sanitizeErrorMessage(error, token)}`,
          502,
        );
      }

      if ((response.status === 503 || response.status === 504) && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      break;
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

    const warnings = parseGraphqlErrors(payload.errors, ssoUrl, token);
    if (!payload.data) {
      const msg = warnings[0]?.message ?? 'GitHub GraphQL returned empty data';
      throw new GitHubApiError(msg, 502);
    }

    return { data: payload.data, warnings, headerRateLimit };
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
      const maxPages = options.maxPages ?? 6;
      const pullRequests: RawPullRequest[] = [];
      const warnings: SnapshotWarning[] = [];
      let cursor: string | null = null;
      let rateLimit: RateLimitBucket | null = null;
      let totalCost = 0;

      for (let page = 0; page < maxPages; page++) {
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

        const res: {
          data: RepoPullsData;
          warnings: SnapshotWarning[];
          headerRateLimit: RateLimitBucket | null;
        } = await executeGraphql<RepoPullsData>(REPO_PULLS_QUERY, {
          owner: safeOwner,
          repo: safeRepo,
          cursor,
        });

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

    async fetchPullDetail(owner: string, repo: string, number: number): Promise<PrDetailResponse> {
      const safeOwner = validateRepoSegment(owner, 'owner');
      const safeRepo = validateRepoSegment(repo, 'repo');
      const safeNum = validatePullNumber(number);

      interface PullDetailData {
        repository?: {
          pullRequest?: {
            number: number;
            title: string;
            url: string;
            isDraft: boolean;
            bodyText: string;
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
        throw new GitHubNotFoundError(`Pull request ${safeOwner}/${safeRepo}#${safeNum} not found`);
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

      return {
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
        checksTotalCount: rollup?.contexts.totalCount ?? checks.length,
        checks,
        reviewers: Array.from(reviewerMap.values()),
        timeline: timeline.reverse(),
        fetchedAt: new Date(now()).toISOString(),
      };
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
  };
}
