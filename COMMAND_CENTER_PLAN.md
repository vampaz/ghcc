# ghcc — GitHub Command Center Roadmap & Group 1 Implementation Plan

This document captures the long-term roadmap for evolving `ghcc` from a PR triage dashboard into a full GitHub Command Center, followed by a refined, build-ready implementation plan for **Group 1: Close the Action Loop**.

---

## Roadmap Overview

### Group 1 — Close the Action Loop _(Active Focus — Refined Below)_

Eliminate context-switching back to GitHub tabs during daily PR triage.

1. **One-click "Re-run failed jobs"** — Re-run failed GitHub Actions workflow runs or individual failed jobs from PR cards and the inspector.
2. **Inline CI failure summary** — Inspect check annotations, outputs, and bounded GitHub Actions job log tails inside the PR inspector.
3. **Snooze, Pin & Inbox Zero** — Server-persisted per-PR pinning and conditional snoozing (until time, next push, CI state change, or new activity) with an Inbox Zero empty state.
4. **Unresolved review threads & quick review** — Surface unresolved thread counts on cards, inspect/reply/resolve threads in the inspector, submit quick reviews (`Approve`, `Comment`, `Request changes`), and manage reviewers.
5. **Command Palette (`Cmd+K`), Bulk Actions & Saved Presets** — Keyboard-first command palette, multi-select bulk actions with bounded concurrency, and persisted filter presets.

### Group 2 — Cross-Repo & Dependency Intelligence _(Backlog)_

- **Cross-repo ticket / mission grouping** — Detect shared ticket keys (`[SEC-16]`, `[BE-520]`, `[FE-421]`), dependency labels (`Depends on FE`), and stacked base branches to group related PRs into coordinated ship units with merge order.
- **Merge conflict / blast-radius radar** — Compare changed file paths across open PRs and warn before merging when another open PR edits the same files.
- **Broken-`master` / shared CI outage detector** — Detect when multiple unrelated PRs fail the same CI check concurrently and surface a single top-level incident banner.
- **Flake tracker** — Track checks that fail and later pass on the same `headRefOid` across polls and badge known flaky checks.

### Group 3 — Live Mission-Control Awareness _(Backlog)_

- **Snapshot diffs & "what just changed"** — Diff consecutive polls to highlight newly green, newly approved, or newly conflicted PRs, plus opt-in browser/desktop notifications.
- **Auto-merge / "arm when green"** — Arm PRs to squash-merge automatically via GitHub Auto-Merge (or a local armed queue with undo) once required checks and approvals pass.
- **Reviewer load & bottleneck view** — Show pending review load across teammates and highlight the lightest-loaded CODEOWNER when requesting reviews.
- **Ship / deploy radar** — Track PRs merged to `master` that have not yet shipped via releases, tags, or deploy workflows/labels.

### Group 4 — Local Execution & Ambitious Ideas _(Backlog)_

- **Local Git & worktree bridge** — Map open PR branches to local checkouts/worktrees in a configured workspace root, showing local dirty status with one-click IDE open, worktree creation, or local rebase.
- **Pluggable agent dispatch** — Trigger local CLI/agent workflows from a PR card (investigate failing CI, pre-review diff, resolve conflict) and surface run status on the card.
- **CI & cycle-time flight recorder** — Persist lightweight historical snapshot metrics (SQLite/JSONL) for 7-day CI health sparklines, time-to-first-review trends, and aging PR reports.
- **Zen Triage Mode** — Full-focus single-PR keyboard loop strictly for `Needs You` (`a` approve, `m` merge, `r` rerun CI, `z` snooze, `Space` next) ending in Inbox Zero.

---

## Group 1 — Refined Implementation Plan: Close the Action Loop

### Guiding Architecture & Guardrails

All Group 1 features follow existing `ghcc` conventions:

- **Same-origin `POST` protection**: Every new mutating endpoint validates `isAllowedSameOriginPost(request)` (`src/server/origin-guard.ts`).
- **Strict input validation & secret hygiene**: Validate `owner`/`repo` (`SAFE_SEGMENT_RE`), PR `number` (`SAFE_NUMBER_RE`), numeric IDs, GraphQL node IDs, and SHAs (`SAFE_SHA_RE`). Never forward `Authorization` headers across cross-origin redirects (critical for GitHub Actions log downloads). Pass all error strings and log excerpts through `redactToken` / `sanitizeErrorMessage`.
- **Explicit finite state machines**: Model every async action and interactive flow with discriminated-union states + pure transition functions in `src/composables/` (matching `PrSyncState`, `PrDraftState`, `PrMergeState`, `PrLabelsState`).
- **Rate-limit discipline**: Keep background `SNAPSHOT_QUERY` lean; load heavy per-PR data (job logs, full thread comments, repo collaborators) strictly on demand when inspected or triggered.
- **Persistence**: Store local user triage state (pins, snoozes, saved presets) atomically in `.cache/state.json` via `StateStore` so state survives browser reloads, LAN multi-device access, and Docker container restarts.

### Recommended Delivery Sequence

Implement Group 1 as five vertical slices, ordered from highest daily leverage + lowest risk to broader cross-cutting UI:

| Phase  | Slice                                             | Primary Value                                                 | Depends On                                               |
| ------ | ------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| **1A** | Re-run Failed Checks                              | Immediately unblock flaky CI without leaving `ghcc`           | —                                                        |
| **1B** | Inline CI Failure Summary                         | Diagnose _why_ CI failed before clicking re-run               | 1A (`CheckRun` IDs + workflow run linkage)               |
| **1C** | Snooze, Pin & Inbox Zero                          | Cut 66-PR noise down to actionable focus                      | `StateStore` optional `triage` field                     |
| **1D** | Unresolved Threads & Quick Review                 | Complete review triage inside the inspector                   | —                                                        |
| **1E** | Command Palette (`Cmd+K`), Bulk Actions & Presets | Keyboard speed & multi-PR batch operations across all actions | 1A, 1C, 1D (exposes all actions in `Cmd+K` and bulk bar) |

---

### Phase 1A — One-Click "Re-run Failed Jobs"

#### Behavior & UX

- **PR Card (`PrCard.vue`)**: When `pr.ci.state === 'failing'`, show a compact `Re-run CI` action button (next to `Sync`) that re-runs all failed GitHub Actions workflow runs for `pr.headRefOid`.
- **PR Inspector (`PrInspectorBody.vue`)**:
  - Header action in the `Checks` section: `Re-run failed` button (re-runs all failed Actions runs on the PR).
  - Per-check row action: on individual failing GitHub Actions `CheckRun` rows, show a compact `Re-run` icon button to re-run just that job (leaving other passing jobs untouched).
  - Non-Actions checks (external CI / `StatusContext`) do not show a fake re-run button; if a PR only has external failing checks, show a clear inline note when triggered (`No re-runnable GitHub Actions runs found for this commit`).
- **Feedback & Reconciliation**: Button transitions `idle -> rerunning -> queued` (then clears automatically on the next snapshot refresh when `headRefOid` changes or checks move out of `failing`), scheduling a post-action snapshot refresh (reusing the `DEFAULT_SYNC_REFRESH_DELAY_MS` pattern).

#### Server & GitHub API

- **GraphQL (`PULL_DETAIL_QUERY`)**: Extend `... on CheckRun` with:
  - `databaseId` (the Actions `job_id` / check run ID)
  - `checkSuite { workflowRun { databaseId } }` (the Actions `run_id`)
  - Keep `PR_FIELDS_FRAGMENT` unchanged to avoid inflating snapshot GraphQL cost.
- **New API routes**:
  - `POST /api/pull/{owner}/{repo}/{number}/rerun-failed`
    - Body (optional): `{ expectedHeadSha?: string; jobId?: number; runId?: number }`.
    - When `jobId` is provided: `POST /repos/{owner}/{repo}/actions/jobs/{jobId}/rerun`.
    - When `runId` is provided: `POST /repos/{owner}/{repo}/actions/runs/{runId}/rerun-failed-jobs`.
    - When neither is provided (PR-wide button): list completed workflow runs for `head_sha` via `GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}&per_page=100`, filter to failed/timed-out/cancelled runs (`failure`, `timed_out`, `startup_failure`), and call `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs` for each unique failed run (bounded concurrency = 3).
    - Response: `{ ok: true, rerunCount: number, failedRunIds: number[], skippedExternal: boolean, message: string }`.
- **Token permissions**: Requires `Actions: Read and write` (fine-grained PAT) or `repo` + `workflow` (classic PAT / `gh`). Return structured `403` error guidance when missing.

#### Client State Machine

- `PrRerunState`:
  - `{ status: 'idle' }`
  - `{ status: 'rerunning'; headRefOid: string; scope: 'all' | 'job'; targetId?: number }`
  - `{ status: 'queued'; headRefOid: string; message: string }`
  - `{ status: 'error'; headRefOid: string; error: string }`

#### Verification

- Unit tests: `transitionPrRerunState`, GitHub client rerun calls, partial failure aggregation, `403` permission mapping, SHA/ID validation.
- Component tests: card button visibility/states, inspector per-job rerun button, error alert display.
- Playwright E2E: click `Re-run CI` on failing PR card and per-job rerun in inspector with mocked POST route.

---

### Phase 1B — Inline CI Failure Summary

#### Behavior & UX

- **On-demand expansion inside `PrInspectorBody.vue`**:
  - Failing `CheckRun` rows get an inline `Logs / Output` disclosure toggle next to the `details` GitHub link.
  - Expanding fetches and displays:
    1. **Check output summary** (`title`, `summary`) when present.
    2. **Annotations** (file path, line range, level, message — up to 25).
    3. **Actions job log excerpt** (for GitHub Actions jobs): failed step name(s), error lines (`##[error]`, assertion failures), and a clean plain-text tail (default last 80 lines, ANSI stripped) inside a scrollable `<pre><code>` block with a `Copy` button and direct `Open full logs on GitHub` link.
  - Zero eager log fetching on snapshot load or inspector open—only fetched when the user expands a specific failing check.

#### Server & GitHub API

- **New API route**:
  - `GET /api/pull/{owner}/{repo}/{number}/checks/{checkRunId}/summary`
    - Fetches check run details (`GET /repos/{owner}/{repo}/check-runs/{checkRunId}`) and annotations (`GET /repos/{owner}/{repo}/check-runs/{checkRunId}/annotations?per_page=25`).
    - If `isActionsJob` (app slug `github-actions` or query param `workflowRunId` present), requests `GET /repos/{owner}/{repo}/actions/jobs/{checkRunId}/logs` with `redirect: 'manual'`.
    - **Security boundary on redirect**: validate the `Location` URL is `https:` and belongs to GitHub/Azure Pipelines log storage (or explicitly strip `Authorization` and `Cookie` headers before fetching the redirect target), enforce a hard byte cap (e.g., 2 MB max read, abort stream beyond cap), strip ANSI control codes, extract failing step/error tail, and run `redactToken`.
    - Cache completed check summaries in memory (LRU, e.g. 50 entries, 10-minute TTL) since completed job logs are immutable.
    - Response: `{ checkRunId: number; name: string; title: string | null; summary: string | null; annotations: CheckAnnotation[]; logExcerpt: string | null; logTruncated: boolean; failedStep: string | null; logUnavailableReason?: string; detailsUrl: string | null }`.

#### Client State Machine

- Per-check `CheckSummaryState`: `'idle' | 'loading' | 'ready' | 'error'` stored by `${prKey}:${checkRunId}` with retry button on failure.

#### Verification

- Unit tests: redirect header stripping (verify `Authorization` is never sent to redirected blob URL), byte-cap truncation, ANSI stripping, error-tail extraction, token redaction, LRU cache behavior.
- Component tests: expand failing check row, render annotations + `<pre>` log tail, copy button, unavailable-log fallback for non-Actions checks.
- Playwright E2E: expand failing check in inspector and verify inline error summary renders cleanly at desktop and mobile widths.

---

### Phase 1C — Snooze, Pin & Inbox Zero

#### Behavior & UX

- **Pinning**:
  - Pin button on PR card (hover/focus or action bar) and in inspector header; keyboard shortcut `p` on focused card.
  - Pinned PRs sort to the top of the Action Queue with a subtle pin badge, respecting active filters (repo, search, ownership view).
- **Snoozing**:
  - Snooze popover button on PR card and inspector; keyboard shortcut `z` on focused card.
  - Snooze options:
    - **Until next push** (`headRefOid` changes)
    - **Until CI changes** (`ci.state` or `headRefOid` changes)
    - **Until new activity** (`updatedAt` changes)
    - **For 2 hours**
    - **Tomorrow 9:00 AM** (local browser timezone converted to ISO timestamp)
    - **Next Monday 9:00 AM**
  - Snoozed PRs are hidden from the default Action Queue and excluded from active `Needs You` triage clutter (while remaining discoverable via a `Show snoozed (N)` toggle in `FilterBar`, matching `Include drafts (N)`).
  - When a snooze condition triggers on a subsequent snapshot poll, the PR automatically wakes up and re-enters the queue with a subtle `woke up` indicator (or simply normal active state).
  - Showing snoozed PRs displays a muted `snoozed · until push` / `snoozed · 3h left` tag and a one-click `Unsnooze` action.
- **Inbox Zero State**:
  - When `Needs You` (or the active queue with no search mismatch) reaches `0` active PRs, display a clean, calm **Inbox Zero** card showing how many PRs are snoozed / waiting on others / ready to merge with quick jump buttons.

#### Server & Persistence (`StateStore`)

- Extend `PersistedState` in `src/server/state-store.ts` (backward-compatible optional field so existing `.cache/state.json` upgrades seamlessly):
  ```ts
  export type SnoozeCondition =
    | { kind: 'until-time'; untilIso: string }
    | { kind: 'until-push'; headRefOid: string }
    | { kind: 'until-ci-change'; ciState: PrCiInfo['state']; headRefOid: string }
    | { kind: 'until-activity'; updatedAt: string };

  export interface PrTriageEntry {
    pinned?: boolean;
    pinnedAt?: string;
    snoozed?: {
      condition: SnoozeCondition;
      snoozedAt: string;
    };
  }
  ```
- Pure derivation helper `src/server/derive/triage.ts`:
  - Evaluates each entry against the live `PrView` + `nowMs`.
  - Automatically clears expired/triggered snoozes and prunes closed PR keys on clean (non-degraded) snapshots.
  - Attaches `triage: { pinned: boolean; snoozedUntilLabel: string | null; snoozeKind: SnoozeCondition['kind'] | null; isSnoozed: boolean }` onto `PrView` (or returns `triage` alongside `SnapshotResponse`—attaching directly to `PrView` keeps sorting/filtering/testing simple).
- **New API routes**:
  - `POST /api/pull/{owner}/{repo}/{number}/triage`
    - Body: `{ action: 'pin' | 'unpin' | 'snooze' | 'unsnooze'; condition?: SnoozeCondition }`.
    - Validates condition fields, updates `StateStore` atomically, updates in-memory snapshot immediately (zero GitHub API calls!), bumps snapshot ETag, and returns updated triage state.

#### Verification

- Unit tests: `evaluateSnoozeWakeup` for all 4 condition kinds, clock edge cases, auto-pruning on clean vs degraded snapshots, `StateStore` round-trip persistence & migration from v1 cache.
- Component tests: pin sorting order, snooze popover options, `Show snoozed (N)` toggle, Inbox Zero empty state, `p` and `z` shortcuts.
- Playwright E2E: pin a PR, snooze a PR, toggle `Show snoozed`, unsnooze, verify persistence across page reload.

---

### Phase 1D — Unresolved Review Threads & Quick Review

#### Behavior & UX

- **PR Card (`PrCard.vue`)**:
  - Compact badge when unresolved threads exist (e.g. `2 unresolved`), only shown if > 0.
- **PR Inspector (`PrInspectorBody.vue`)**:
  - **Quick Review bar** (hidden for PRs authored by `viewer.login` for Approve/Request changes, while still allowing `Comment`):
    - Compact segmented action: `Approve`, `Comment`, `Request changes` + expandable markdown textarea + `Submit review` button.
    - Submitting `Approve` with an empty body works in one confirmation click; `Request changes` and `Comment` require a non-empty body.
  - **Reviewer management** in the `Reviewers` section:
    - `Edit reviewers` popover (matching `LabelPicker.vue` UX) to request or remove individual users/teams from cached repo assignable users/collaborators.
  - **Unresolved Threads section**:
    - Lists unresolved review threads (file path + line number, outdated badge if applicable, sanitized comment HTML via `sanitizePrBodyHtml`, direct GitHub link).
    - Per-thread inline **Reply** form and **Resolve / Unresolve** toggle button.

#### Server & GitHub API

- **GraphQL cost check**:
  - In `PULL_DETAIL_QUERY` (single PR on demand): add `reviewThreads(first: 50)` with `id`, `isResolved`, `isOutdated`, `path`, `line`, `originalLine`, and `comments(first: 10) { nodes { id author { login } bodyHTML bodyText createdAt url } }`.
  - In `PR_FIELDS_FRAGMENT` (snapshot): test real GraphQL cost of adding `reviewThreads(first: 20) { totalCount nodes { isResolved } }`. If cost increases noticeably or risks hitting GitHub's node limit on large orgs, keep full thread data in `PULL_DETAIL_QUERY` only or cap strictly (e.g., `first: 10` or measure live cost first).
- **New API routes**:
  - `POST /api/pull/{owner}/{repo}/{number}/review`
    - Body: `{ event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'; body?: string }`.
    - Calls `POST /repos/{owner}/{repo}/pulls/{number}/reviews`.
  - `POST /api/pull/{owner}/{repo}/{number}/threads/{threadId}/reply`
    - Body: `{ body: string }`.
    - Calls GraphQL `addPullRequestReviewThreadReply`.
  - `POST /api/pull/{owner}/{repo}/{number}/threads/{threadId}/resolve`
    - Body: `{ resolved: boolean }`.
    - Calls GraphQL `resolveReviewThread` or `unresolveReviewThread`.
  - `GET /api/repo/{owner}/{repo}/reviewers`
    - Fetches assignable users (`GET /repos/{owner}/{repo}/collaborators?per_page=100` or GraphQL `assignableUsers(first: 100)`) cached 5 minutes per repo (matching `RepoLabelsState`).
  - `POST /api/pull/{owner}/{repo}/{number}/reviewers`
    - Body: `{ addUsers?: string[]; removeUsers?: string[]; addTeams?: string[]; removeTeams?: string[] }`.
    - Calls GitHub `requested_reviewers` REST POST/DELETE endpoints.

#### Client State Machines

- `PrReviewSubmitState`: `'idle' | 'submitting' | 'submitted' | 'error'`
- `ThreadActionState` (per thread ID): `'idle' | 'replying' | 'resolving' | 'error'`
- `PrReviewersState`: `'idle' | 'saving' | 'error'` + `RepoReviewersState`: `'idle' | 'loading' | 'ready' | 'error'`

#### Verification

- Unit tests: GraphQL query/mutation payload parsing, own-PR approval guard, thread HTML sanitization, reviewer diff calculation, state machine transitions.
- Component tests: quick review submission validation (empty body allowed for approve, blocked for comment/request changes), inline thread reply & resolve, reviewer picker.
- Playwright E2E: inspect PR, reply to + resolve an unresolved thread, submit an approval review.

---

### Phase 1E — Command Palette (`Cmd+K`), Bulk Actions & Saved Filter Presets

#### Behavior & UX

- **Command Palette (`CommandPaletteDialog.vue`)**:
  - Triggered by `Cmd+K` (macOS) / `Ctrl+K` (Linux/Windows) or a subtle header button; closes on `Esc` or backdrop click using native `<dialog>`.
  - Instant keyboard-navigable (`ArrowUp`/`ArrowDown`/`Enter`) sections:
    1. **Active PR actions** (when a PR is focused or inspected): Sync, Re-run failed CI, Squash / Merge, Toggle Draft, Edit Labels, Pin, Snooze, Quick Approve, Open on GitHub.
    2. **Saved & built-in filter presets**: `Morning Triage` (`Needs You`, no drafts, no snoozed), `Failing CI`, `Stale > 3d`, `Ready to Merge`, plus any user-saved presets.
    3. **Bulk commands**: `Select all visible`, `Sync all behind in view`, `Re-run all failing CI in view`, `Clear selection`.
    4. **Jump to PR**: fuzzy search across all open PRs (`key`, `title`, `author`, `headRefName`, `labels`).
    5. **App controls**: Force refresh, toggle theme, toggle drafts, toggle snoozed, reset filters.
- **Multi-Select & Bulk Action Bar (`BulkActionBar.vue`)**:
  - Toggle selection via checkbox on cards (visible on hover, when any PR is selected, or via `x` shortcut on focused card; `Shift+Click` range select).
  - Floating bottom bar appears only when `selectedKeys.size > 0`:
    - Shows `N selected` + `Select all visible` / `Clear`.
    - Contextual actions with eligible counts:
      - `Sync behind (k)`
      - `Re-run failed CI (k)`
      - `Labels…` (add/remove a label across selected PRs)
      - `Snooze…`
      - `Mark Draft` / `Mark Ready`
  - **Safe execution**:
    - Runs client-orchestrated or server-batch calls with bounded concurrency (max 2–3 in flight), live progress counter (`3 / 7 synced`), cancel button, and clear per-PR error summary if any fail.
    - Immediately stops remaining items on `401`, `403` rate-limit, or network offline.
    - **Deliberately excludes bulk Merge** from v1 bulk actions to prevent accidental multi-PR merges without individual confirmation.
- **Saved Filter Presets**:
  - Persist named presets in `.cache/state.json` via `GET/POST/DELETE /api/presets` (name + `DashboardFilters` + `showSnoozed` + optional `staleOnly`).
  - Compact `Presets` menu in `FilterBar` with `Save current view…` and delete option for user-created presets.

#### Client State Machines

- `CommandPaletteState`: `{ status: 'closed' } | { status: 'open'; query: string; activeIndex: number }`
- `BulkActionState`:
  - `{ status: 'idle' }`
  - `{ status: 'running'; actionLabel: string; total: number; completed: number; succeeded: string[]; failed: Array<{ key: string; error: string }>; cancelled: boolean }`
  - `{ status: 'done'; actionLabel: string; total: number; succeeded: string[]; failed: Array<{ key: string; error: string }>; cancelled: boolean }`

#### Verification

- Unit tests: command ranking/filtering, range selection logic, bulk runner concurrency + early abort on rate limit/auth error, preset serialization & `StateStore` persistence.
- Component tests: `Cmd+K` keyboard navigation, bulk bar eligible counts, cancel mid-run, save/apply/delete preset.
- Playwright E2E: open `Cmd+K`, jump to PR, select multiple PRs, run bulk sync, save & apply a custom filter preset.

---

## Locked Decisions

The following choices are finalized for Group 1:

1. **Delivery cadence**: Ship each phase (**1A → 1B → 1C → 1D → 1E**) sequentially as verified, standalone commits.
2. **Snooze KPI impact (Phase 1C)**: Exclude snoozed PRs from the `NEEDS YOU` KPI count so you can reach `0` (Inbox Zero), and display a secondary `(+N snoozed)` indicator when snoozed PRs exist.
3. **Unresolved thread count on cards (Phase 1D)**: Measure real GraphQL query cost first; include an unresolved count badge on PR cards only if cost stays low, otherwise keep unresolved threads inspector-only.
4. **Quick Approve safety (Phase 1D)**: Use a lightweight two-step inline confirmation for `Approve` (no modal, prevents accidental clicks); require a non-empty body for `Request changes` and `Comment`.
5. **Bulk actions scope (Phase 1E)**: Keep **Bulk Merge** excluded (support Sync, Re-run CI, Labels, Draft/Ready, Snooze, and Pin).
