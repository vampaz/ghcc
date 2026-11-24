import type { RawPullRequest } from '@/server/derive/types';

export const FIXTURE_NOW_MS = Date.parse('2026-11-24T12:00:00.000Z');
export const VIEWER_LOGIN = 'vampaz';

export function makeBaseRawPr(overrides: Partial<RawPullRequest> = {}): RawPullRequest {
  return {
    id: 'PR_kwDO_base_1',
    number: 101,
    title: 'feat: default fixture pull request',
    url: 'https://github.com/acme/web-app/pull/101',
    isDraft: false,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
    baseRefName: 'main',
    headRefName: 'feat/base-pr',
    headRefOid: 'oid-base-1',
    additions: 48,
    deletions: 12,
    changedFiles: 3,
    reviewDecision: 'APPROVED',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    autoMergeRequest: null,
    mergeQueueEntry: null,
    repository: { nameWithOwner: 'acme/web-app' },
    author: { login: VIEWER_LOGIN },
    latestReviews: { nodes: [] },
    reviewRequests: { nodes: [] },
    commits: {
      nodes: [
        {
          commit: {
            committedDate: '2026-11-24T08:00:00.000Z',
            statusCheckRollup: {
              state: 'SUCCESS',
              contexts: {
                totalCount: 2,
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'ci / test',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                    detailsUrl: 'https://github.com/acme/web-app/actions/runs/1',
                    startedAt: '2026-11-24T08:01:00.000Z',
                    completedAt: '2026-11-24T08:03:00.000Z',
                  },
                  {
                    __typename: 'CheckRun',
                    name: 'ci / lint',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                    detailsUrl: 'https://github.com/acme/web-app/actions/runs/2',
                    startedAt: '2026-11-24T08:01:00.000Z',
                    completedAt: '2026-11-24T08:02:00.000Z',
                  },
                ],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

// 1. mergeable: UNKNOWN
export const fixtureUnknownMergeable = makeBaseRawPr({
  id: 'PR_unknown_merge',
  number: 201,
  title: 'refactor: decouple session cache',
  url: 'https://github.com/acme/core-api/pull/201',
  repository: { nameWithOwner: 'acme/core-api' },
  headRefOid: 'sha-unknown-v1',
  mergeable: 'UNKNOWN',
  mergeStateStatus: 'UNKNOWN',
});

// 2. statusCheckRollup: null (no CI at all -> ready still reachable)
export const fixtureNoCiRollup = makeBaseRawPr({
  id: 'PR_no_ci',
  number: 202,
  title: 'docs: add quickstart runbook',
  url: 'https://github.com/acme/docs/pull/202',
  repository: { nameWithOwner: 'acme/docs' },
  headRefOid: 'sha-no-ci',
  reviewDecision: null,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  commits: {
    nodes: [
      {
        commit: {
          committedDate: '2026-11-24T10:00:00.000Z',
          statusCheckRollup: null,
        },
      },
    ],
  },
});

// 3. statusCheckRollup.state: FAILURE with hiddenCount > 0 and 0 visible failing checks
export const fixtureTruncatedFailingCi = makeBaseRawPr({
  id: 'PR_truncated_fail',
  number: 203,
  title: 'fix: stabilize shard scheduling',
  url: 'https://github.com/acme/worker/pull/203',
  repository: { nameWithOwner: 'acme/worker' },
  headRefOid: 'sha-trunc-fail',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'UNSTABLE',
  commits: {
    nodes: [
      {
        commit: {
          committedDate: '2026-11-24T09:30:00.000Z',
          statusCheckRollup: {
            state: 'FAILURE',
            contexts: {
              totalCount: 35,
              nodes: Array.from({ length: 30 }, (_, idx) => ({
                __typename: 'CheckRun' as const,
                name: `shard-${idx + 1}`,
                status: 'COMPLETED',
                conclusion: 'SUCCESS',
                detailsUrl: `https://github.com/acme/worker/actions/runs/${idx + 1}`,
                startedAt: '2026-11-24T09:31:00.000Z',
                completedAt: '2026-11-24T09:35:00.000Z',
              })),
            },
          },
        },
      },
    ],
  },
});

// 4. reviewDecision: null with two approvals (unprotected branch)
export const fixtureNullReviewDecisionTwoApprovals = makeBaseRawPr({
  id: 'PR_null_decision_approved',
  number: 204,
  title: 'feat: batch cache invalidation',
  url: 'https://github.com/vampaz/tools/pull/204',
  repository: { nameWithOwner: 'vampaz/tools' },
  headRefOid: 'sha-null-dec',
  reviewDecision: null,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  latestReviews: {
    nodes: [
      { state: 'APPROVED', submittedAt: '2026-11-24T07:00:00.000Z', author: { login: 'ana' } },
      { state: 'APPROVED', submittedAt: '2026-11-24T07:30:00.000Z', author: { login: 'leo' } },
    ],
  },
});

// 5. mergeStateStatus: BLOCKED + reviewDecision: REVIEW_REQUIRED
export const fixtureBlockedReviewRequired = makeBaseRawPr({
  id: 'PR_blocked_review_req',
  number: 205,
  title: 'feat: expose audit export endpoint',
  url: 'https://github.com/acme/core-api/pull/205',
  repository: { nameWithOwner: 'acme/core-api' },
  headRefOid: 'sha-blocked-rev',
  reviewDecision: 'REVIEW_REQUIRED',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  reviewRequests: {
    nodes: [{ asCodeOwner: true, requestedReviewer: { __typename: 'User', login: 'ana' } }],
  },
  commits: {
    nodes: [
      {
        commit: {
          committedDate: '2026-11-20T09:00:00.000Z',
          statusCheckRollup: {
            state: 'SUCCESS',
            contexts: {
              totalCount: 1,
              nodes: [
                {
                  __typename: 'StatusContext',
                  context: 'ci/buildkite',
                  state: 'SUCCESS',
                  targetUrl: 'https://buildkite.example/1',
                  description: 'Build passed',
                },
              ],
            },
          },
        },
      },
    ],
  },
});

// 6a. Direct review request
export const fixtureDirectReviewRequest = makeBaseRawPr({
  id: 'PR_direct_review',
  number: 301,
  title: 'fix: retry backoff jitter calculation',
  url: 'https://github.com/acme/core-api/pull/301',
  repository: { nameWithOwner: 'acme/core-api' },
  author: { login: 'ana' },
  headRefOid: 'sha-direct-rev',
  reviewDecision: 'REVIEW_REQUIRED',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  reviewRequests: {
    nodes: [{ asCodeOwner: false, requestedReviewer: { __typename: 'User', login: VIEWER_LOGIN } }],
  },
});

// 6b. Team-only review request
export const fixtureTeamReviewRequest = makeBaseRawPr({
  id: 'PR_team_review',
  number: 302,
  title: 'chore: upgrade telemetry sdk',
  url: 'https://github.com/acme/web-app/pull/302',
  repository: { nameWithOwner: 'acme/web-app' },
  author: { login: 'leo' },
  headRefOid: 'sha-team-rev',
  reviewDecision: 'REVIEW_REQUIRED',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  reviewRequests: {
    nodes: [
      { asCodeOwner: true, requestedReviewer: { __typename: 'Team', slug: 'frontend-core' } },
    ],
  },
});

// 7. Auto-merge enabled
export const fixtureAutoMerge = makeBaseRawPr({
  id: 'PR_auto_merge',
  number: 206,
  title: 'feat: stream compact metrics',
  url: 'https://github.com/acme/web-app/pull/206',
  repository: { nameWithOwner: 'acme/web-app' },
  headRefOid: 'sha-auto-merge',
  reviewDecision: 'APPROVED',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  autoMergeRequest: {
    enabledAt: '2026-11-24T09:00:00.000Z',
    mergeMethod: 'SQUASH',
  },
});

// 8. Merge-queue entry
export const fixtureMergeQueue = makeBaseRawPr({
  id: 'PR_merge_queue',
  number: 207,
  title: 'fix: preserve header order on retry',
  url: 'https://github.com/acme/core-api/pull/207',
  repository: { nameWithOwner: 'acme/core-api' },
  headRefOid: 'sha-mq',
  reviewDecision: 'APPROVED',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  mergeQueueEntry: {
    position: 2,
    state: 'AWAITING_CHECKS',
    estimatedTimeToMerge: 180,
  },
});

// 9a. Conflicting draft -> stays in draft
export const fixtureConflictingDraft = makeBaseRawPr({
  id: 'PR_draft_conflict',
  number: 208,
  title: 'wip: experimental streaming parser',
  url: 'https://github.com/acme/worker/pull/208',
  repository: { nameWithOwner: 'acme/worker' },
  isDraft: true,
  headRefOid: 'sha-draft-conflict',
  reviewDecision: null,
  mergeable: 'CONFLICTING',
  mergeStateStatus: 'DIRTY',
});

// 9b. Draft with changes requested -> escalates to needs-me
export const fixtureDraftChangesRequested = makeBaseRawPr({
  id: 'PR_draft_changes_req',
  number: 209,
  title: 'wip: auth token rotation',
  url: 'https://github.com/acme/core-api/pull/209',
  repository: { nameWithOwner: 'acme/core-api' },
  isDraft: true,
  headRefOid: 'sha-draft-changes',
  reviewDecision: 'CHANGES_REQUESTED',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  latestReviews: {
    nodes: [
      {
        state: 'CHANGES_REQUESTED',
        submittedAt: '2026-11-24T06:00:00.000Z',
        author: { login: 'ana' },
      },
    ],
  },
});

// 10. Archived / disabled / locked repos and closed PRs
export const fixtureArchivedRepo = makeBaseRawPr({
  id: 'PR_archived_repo',
  number: 352,
  title: 'fix: legacy responsive container',
  url: 'https://github.com/example-org/legacy-dashboard/pull/352',
  state: 'OPEN',
  closed: false,
  mergeable: 'UNKNOWN',
  mergeStateStatus: 'UNKNOWN',
  repository: {
    nameWithOwner: 'example-org/legacy-dashboard',
    isArchived: true,
    isDisabled: false,
    isLocked: false,
  },
});

export const fixtureDisabledRepo = makeBaseRawPr({
  id: 'PR_disabled_repo',
  number: 353,
  title: 'chore: disabled repo PR',
  repository: {
    nameWithOwner: 'example-org/disabled-repo',
    isArchived: false,
    isDisabled: true,
    isLocked: false,
  },
});

export const fixtureLockedRepo = makeBaseRawPr({
  id: 'PR_locked_repo',
  number: 354,
  title: 'chore: locked repo PR',
  repository: {
    nameWithOwner: 'example-org/locked-repo',
    isArchived: false,
    isDisabled: false,
    isLocked: true,
  },
});

export const fixtureClosedPr = makeBaseRawPr({
  id: 'PR_closed_pr',
  number: 355,
  title: 'fix: already closed pull request',
  state: 'CLOSED',
  closed: true,
  repository: {
    nameWithOwner: 'acme/web-app',
    isArchived: false,
    isDisabled: false,
    isLocked: false,
  },
});
