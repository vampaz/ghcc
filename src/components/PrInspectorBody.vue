<template>
  <div class="inspector-body">
    <div v-if="pr" class="inspector-meta">
      <p class="summary-callout">{{ pr.blockerSummary }}</p>
      <div class="branch-line mono-num">
        <span>{{ pr.headRefName }}</span>
        <CarbonIcon name="arrow-right" :size="12" />
        <span>{{ pr.baseRefName }}</span>
        <span class="meta-sep">·</span>
        <span>by @{{ pr.author }}</span>
      </div>

      <div v-if="!pr.isDraft" class="draft-callout">
        <div class="draft-callout-row">
          <span class="draft-callout-label">Merge pull request</span>
          <MergeControl
            :pr="pr"
            :merge-state="mergeState"
            @request-merge="(target, method) => $emit('request-merge', target, method)"
          />
        </div>
        <p v-if="mergeState.status === 'error'" class="sync-error-note" role="alert">
          {{ mergeState.error }}
        </p>
      </div>

      <div class="draft-callout">
        <div class="draft-callout-row">
          <span class="draft-callout-label">Pull request status</span>
          <DraftToggle
            :pr-key="pr.key"
            :is-draft="pr.isDraft"
            :draft-state="draftState"
            @toggle="$emit('toggle-draft', pr, $event)"
          />
        </div>
        <p v-if="draftState.status === 'error'" class="sync-error-note" role="alert">
          {{ draftState.error }}
        </p>
      </div>

      <div class="draft-callout">
        <div class="draft-callout-row">
          <span class="draft-callout-label">Labels</span>
          <LabelPicker
            :pr="pr"
            :repo-labels-state="repoLabelsState"
            :label-state="labelState"
            @load-labels="$emit('load-labels', $event)"
            @retry-load="$emit('retry-load-labels', $event)"
            @update-labels="(target, labels) => $emit('update-labels', target, labels)"
          />
        </div>
        <div v-if="pr.labels.length > 0" class="inspector-labels-list">
          <span
            v-for="label in pr.labels"
            :key="label.name"
            class="pr-label-pill"
            :style="{ '--label-color': `#${label.color}` }"
            :title="label.description ?? label.name"
          >
            <span class="pr-label-dot" aria-hidden="true"></span>
            <span>{{ label.name }}</span>
          </span>
        </div>
        <p v-else class="empty-note">No labels applied.</p>
        <p v-if="labelState.status === 'error'" class="sync-error-note" role="alert">
          {{ labelState.error }}
        </p>
      </div>

      <div class="draft-callout">
        <div class="draft-callout-row">
          <span class="draft-callout-label">Focus</span>
          <div class="inspector-triage-actions">
            <button
              type="button"
              class="inspector-pin-btn"
              :class="{ active: isPrPinned(pr) }"
              :aria-pressed="isPrPinned(pr) ? 'true' : 'false'"
              :aria-disabled="triageState.status === 'saving' ? 'true' : undefined"
              @click="$emit('toggle-pin', pr)"
            >
              <CarbonIcon :name="isPrPinned(pr) ? 'pin-filled' : 'pin'" :size="13" />
              <span>{{ isPrPinned(pr) ? 'Pinned' : 'Pin' }}</span>
            </button>
            <SnoozePicker
              :pr="pr"
              :now-ms="nowMs"
              :triage-state="triageState"
              @snooze="(target, condition) => $emit('snooze', target, condition)"
              @unsnooze="$emit('unsnooze', $event)"
            />
          </div>
        </div>
        <p v-if="isPrSnoozed(pr)" class="empty-note">
          {{ formatSnoozeBadge(pr.triage?.snoozeCondition, nowMs) }}
        </p>
        <p v-if="triageState.status === 'error'" class="sync-error-note" role="alert">
          {{ triageState.error }}
        </p>
      </div>

      <div v-if="showSyncAction" class="sync-callout">
        <div class="sync-callout-row">
          <button
            type="button"
            class="sync-action-btn"
            :class="{
              synced: syncState.status === 'synced',
              syncing: syncState.status === 'syncing',
            }"
            :aria-disabled="isSyncBusy ? 'true' : undefined"
            :aria-label="syncAriaLabel"
            @click="onSyncClick"
          >
            <progress
              v-if="syncState.status === 'syncing'"
              class="loading-spinner"
              aria-label="Syncing branch"
            ></progress>
            <CarbonIcon
              v-else
              :name="syncState.status === 'synced' ? 'checkmark' : 'renew'"
              :size="14"
            />
            <span>{{ syncButtonText }}</span>
          </button>
          <span class="sync-hint">Merges {{ pr.baseRefName }} into {{ pr.headRefName }}</span>
        </div>
        <p v-if="syncState.status === 'error'" class="sync-error-note" role="alert">
          {{ syncState.error }}
        </p>
      </div>
    </div>

    <div v-if="inspector.status === 'loading'" class="state-box">
      Loading checks, reviewers, and timeline...
    </div>

    <div v-else-if="inspector.status === 'error'" class="state-box error-box" role="alert">
      <p>{{ inspector.error }}</p>
      <button v-if="pr" type="button" class="retry-btn" @click="$emit('retry', pr)">Retry</button>
    </div>

    <template v-else-if="inspector.status === 'open'">
      <section class="detail-section" :aria-labelledby="descriptionHeadingId">
        <h2 :id="descriptionHeadingId" class="detail-heading">Description</h2>
        <PrMarkdownBody
          v-if="inspector.detail.bodyHtml"
          :html="inspector.detail.bodyHtml"
          :pr-url="pr?.url ?? inspector.detail.url"
          :pr-key="pr?.key ?? inspector.detail.key"
          :resolved-theme="resolvedTheme"
          @open-mermaid="$emit('open-mermaid', $event)"
        />
        <p v-else-if="inspector.detail.bodyExcerpt" class="body-excerpt">
          {{ inspector.detail.bodyExcerpt }}
        </p>
        <p v-else class="empty-note">No description provided.</p>
      </section>

      <section class="detail-section" :aria-labelledby="checksHeadingId">
        <div class="detail-heading-row">
          <h2 :id="checksHeadingId" class="detail-heading">
            Checks
            <span class="mono-num detail-count">
              {{ inspector.detail.checks.length }}
              <template v-if="inspector.detail.checksTotalCount > inspector.detail.checks.length">
                / {{ inspector.detail.checksTotalCount }}
              </template>
            </span>
          </h2>
          <div class="detail-heading-actions">
            <button
              v-if="showRerunAllAction"
              type="button"
              class="checks-rerun-btn"
              :class="{
                queued: isRerunAllQueued,
                rerunning: isRerunAllPending,
              }"
              :aria-disabled="isRerunAllBusy ? 'true' : undefined"
              :aria-label="rerunAllAriaLabel"
              @click="onRerunAllClick"
            >
              <progress
                v-if="isRerunAllPending"
                class="loading-spinner"
                aria-label="Re-running failed checks"
              ></progress>
              <CarbonIcon v-else :name="isRerunAllQueued ? 'checkmark' : 'renew'" :size="12" />
              <span>{{ rerunAllButtonText }}</span>
            </button>
            <button
              v-if="checkGroups.length > 1"
              type="button"
              class="checks-toggle-all-btn"
              :aria-expanded="allGroupsExpanded ? 'true' : 'false'"
              @click="toggleAllCheckGroups"
            >
              {{ allGroupsExpanded ? 'Collapse all' : 'Expand all' }}
            </button>
          </div>
        </div>

        <p v-if="rerunState.status === 'queued'" class="rerun-status-note" role="status">
          {{ rerunState.message }}
        </p>

        <p v-if="rerunState.status === 'error'" class="sync-error-note" role="alert">
          {{ rerunState.error }}
        </p>

        <p v-if="inspector.detail.checks.length === 0" class="empty-note">No checks reported.</p>

        <div v-else class="check-groups">
          <details
            v-for="group in checkGroups"
            :key="`${pr?.key ?? 'pr'}-${group.id}`"
            class="check-group"
            :data-bucket="group.bucket"
            :open="openGroupIds.has(group.id)"
            @toggle="onGroupToggle(group.id, $event)"
          >
            <summary class="check-group-summary">
              <span class="check-group-chevron" aria-hidden="true">
                <CarbonIcon name="chevron-down" :size="14" />
              </span>
              <span class="check-badge" :data-bucket="group.bucket">{{ group.bucket }}</span>
              <span class="check-group-label">{{ group.label }}</span>
              <span class="check-group-counts mono-num">
                <span v-if="group.failingCount > 0" class="group-count-fail">
                  {{ group.failingCount }} fail
                </span>
                <span v-if="group.pendingCount > 0" class="group-count-pend">
                  {{ group.pendingCount }} pend
                </span>
                <span v-if="group.passingCount > 0" class="group-count-pass">
                  {{ group.passingCount }} pass
                </span>
              </span>
            </summary>

            <ul role="list" class="detail-list check-group-list">
              <li
                v-for="(item, idx) in group.items"
                :key="`${item.check.kind}-${item.check.name}-${idx}`"
                class="detail-row detail-check-item"
              >
                <div class="detail-row-main">
                  <span class="check-badge" :data-bucket="item.check.bucket">{{
                    item.check.bucket
                  }}</span>
                  <span
                    class="detail-name"
                    :title="item.displayName !== item.check.name ? item.check.name : undefined"
                  >
                    {{ item.displayName }}
                  </span>
                  <span
                    v-if="flakyCountForCheck(item.check.name) > 0"
                    class="flaky-check-badge mono-num"
                    :title="`Flipped between failing and passing on the same commit ${flakyCountForCheck(item.check.name)} time(s) recently`"
                  >
                    flaky · {{ flakyCountForCheck(item.check.name) }}×
                  </span>
                  <span
                    v-if="
                      hasInlineSummary(item.check) || isRerunnableJob(item.check) || item.check.url
                    "
                    class="detail-row-actions"
                  >
                    <button
                      v-if="hasInlineSummary(item.check)"
                      type="button"
                      class="check-logs-btn"
                      :class="{ expanded: isCheckExpanded(item.check.checkRunId!) }"
                      :aria-expanded="isCheckExpanded(item.check.checkRunId!) ? 'true' : 'false'"
                      :aria-label="`${isCheckExpanded(item.check.checkRunId!) ? 'Hide' : 'Show'} failure output for ${item.check.name}`"
                      @click="toggleCheckSummary(item.check)"
                    >
                      <CarbonIcon name="terminal" :size="12" />
                      <span>{{ isRerunnableJob(item.check) ? 'Logs' : 'Output' }}</span>
                    </button>
                    <button
                      v-if="isRerunnableJob(item.check)"
                      type="button"
                      class="check-rerun-btn"
                      :class="{
                        queued: isJobQueued(item.check.checkRunId!),
                        rerunning: isJobRerunning(item.check.checkRunId!),
                      }"
                      :aria-disabled="
                        isJobButtonDisabled(item.check.checkRunId!) ? 'true' : undefined
                      "
                      :aria-label="`Re-run ${item.check.name}`"
                      :title="`Re-run job ${item.check.name}`"
                      @click="onRerunJobClick(item.check.checkRunId!)"
                    >
                      <progress
                        v-if="isJobRerunning(item.check.checkRunId!)"
                        class="loading-spinner"
                        aria-label="Re-running job"
                      ></progress>
                      <CarbonIcon
                        v-else
                        :name="isJobQueued(item.check.checkRunId!) ? 'checkmark' : 'renew'"
                        :size="12"
                      />
                      <span>{{ jobRerunLabel(item.check.checkRunId!) }}</span>
                    </button>
                    <a
                      v-if="item.check.url"
                      :href="item.check.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="detail-link"
                    >
                      <span>details</span>
                      <CarbonIcon name="launch" :size="12" />
                    </a>
                  </span>
                </div>

                <div
                  v-if="hasInlineSummary(item.check) && isCheckExpanded(item.check.checkRunId!)"
                  class="check-summary-panel"
                >
                  <template
                    v-for="state in [getCheckSummaryState(item.check.checkRunId!)]"
                    :key="item.check.checkRunId!"
                  >
                    <div v-if="state.status === 'loading'" class="check-summary-loading">
                      Loading failure output...
                    </div>

                    <div
                      v-else-if="state.status === 'error'"
                      class="check-summary-error"
                      role="alert"
                    >
                      <span>{{ state.error }}</span>
                      <button
                        type="button"
                        class="check-summary-retry-btn"
                        @click="retryCheckSummary(item.check)"
                      >
                        Retry
                      </button>
                    </div>

                    <div v-else-if="state.status === 'ready'" class="check-summary-ready">
                      <div v-if="state.summary.failedStep" class="check-failed-step">
                        <span class="check-failed-step-label">Failed step</span>
                        <span class="mono-num check-failed-step-name">{{
                          state.summary.failedStep
                        }}</span>
                      </div>

                      <div
                        v-if="state.summary.title || state.summary.summary"
                        class="check-output-meta"
                      >
                        <p v-if="state.summary.title" class="check-output-title">
                          {{ state.summary.title }}
                        </p>
                        <p v-if="state.summary.summary" class="check-output-summary">
                          {{ state.summary.summary }}
                        </p>
                      </div>

                      <ul
                        v-if="state.summary.annotations.length > 0"
                        role="list"
                        class="check-annotations-list"
                      >
                        <li
                          v-for="(ann, annIdx) in state.summary.annotations"
                          :key="`${ann.path}-${ann.startLine}-${annIdx}`"
                          class="check-annotation-item"
                        >
                          <div class="check-annotation-head">
                            <span class="check-annotation-level" :data-level="ann.level">{{
                              ann.level
                            }}</span>
                            <span v-if="ann.path" class="check-annotation-path mono-num">
                              {{ formatAnnotationLocation(ann) }}
                            </span>
                            <span v-if="ann.title" class="check-annotation-title">{{
                              ann.title
                            }}</span>
                          </div>
                          <p class="check-annotation-message">{{ ann.message }}</p>
                        </li>
                      </ul>

                      <div v-if="state.summary.logExcerpt" class="check-log-block">
                        <div class="check-log-toolbar">
                          <span class="check-log-label">
                            Log excerpt
                            <template v-if="state.summary.logTruncated"> (tail)</template>
                          </span>
                          <button
                            type="button"
                            class="check-log-copy-btn"
                            @click="
                              copyLogExcerpt(item.check.checkRunId!, state.summary.logExcerpt)
                            "
                          >
                            {{ copiedCheckId === item.check.checkRunId ? 'Copied' : 'Copy' }}
                          </button>
                        </div>
                        <pre
                          class="check-log-pre app-scroll"
                        ><code>{{ state.summary.logExcerpt }}</code></pre>
                      </div>

                      <p v-if="state.summary.logUnavailableReason" class="check-summary-note">
                        {{ state.summary.logUnavailableReason }}
                      </p>

                      <p
                        v-if="
                          !state.summary.title &&
                          !state.summary.summary &&
                          state.summary.annotations.length === 0 &&
                          !state.summary.logExcerpt &&
                          !state.summary.logUnavailableReason
                        "
                        class="check-summary-note"
                      >
                        No failure output or annotations were reported for this check.
                      </p>
                    </div>
                  </template>
                </div>
              </li>
            </ul>
          </details>
        </div>
      </section>

      <section class="detail-section" aria-label="Reviewers">
        <div class="detail-heading-row">
          <h2 class="detail-heading">
            Reviewers
            <span class="mono-num detail-count">{{ inspector.detail.reviewers.length }}</span>
          </h2>
          <ReviewerPicker
            v-if="pr"
            :pr="pr"
            :current-reviewers="inspector.detail.reviewers"
            :repo-reviewers-state="repoReviewersState"
            :pr-reviewers-state="prReviewersState"
            @load-reviewers="$emit('load-reviewers', $event)"
            @retry-load="$emit('retry-load-reviewers', $event)"
            @update-reviewers="(target, changes) => $emit('update-reviewers', target, changes)"
          />
        </div>
        <p v-if="prReviewersState.status === 'error'" class="sync-error-note" role="alert">
          {{ prReviewersState.error }}
        </p>
        <p v-if="inspector.detail.reviewers.length === 0" class="empty-note">No reviewers yet.</p>
        <ul v-else role="list" class="detail-list">
          <li
            v-for="rev in inspector.detail.reviewers"
            :key="`${rev.kind}-${rev.login}`"
            class="detail-row"
          >
            <span class="rev-state" :data-state="rev.state">{{ rev.state }}</span>
            <span class="detail-name">
              {{ rev.kind === 'team' ? rev.login : `@${rev.login}` }}
              <span v-if="rev.asCodeOwner" class="codeowner-note">code owner</span>
            </span>
          </li>
        </ul>

        <div v-if="pr" class="quick-review-box">
          <div class="quick-review-head">
            <span class="draft-callout-label">Quick review</span>
            <div class="quick-review-triggers">
              <button
                v-if="!isOwnPr"
                type="button"
                class="qr-btn qr-approve-btn"
                :class="{ active: quickReview.status === 'confirm-approve' }"
                :aria-disabled="reviewSubmitState.status === 'submitting' ? 'true' : undefined"
                @click="startQuickApprove"
              >
                Approve
              </button>
              <button
                type="button"
                class="qr-btn"
                :class="{
                  active: quickReview.status === 'compose' && quickReview.event === 'COMMENT',
                }"
                :aria-disabled="reviewSubmitState.status === 'submitting' ? 'true' : undefined"
                @click="startQuickCompose('COMMENT')"
              >
                Comment
              </button>
              <button
                v-if="!isOwnPr"
                type="button"
                class="qr-btn qr-changes-btn"
                :class="{
                  active:
                    quickReview.status === 'compose' && quickReview.event === 'REQUEST_CHANGES',
                }"
                :aria-disabled="reviewSubmitState.status === 'submitting' ? 'true' : undefined"
                @click="startQuickCompose('REQUEST_CHANGES')"
              >
                Request changes
              </button>
            </div>
          </div>

          <div v-if="quickReview.status === 'confirm-approve'" class="quick-review-form">
            <label :for="reviewTextareaId" class="visually-hidden">Optional approval note</label>
            <textarea
              :id="reviewTextareaId"
              v-model="quickReview.body"
              rows="2"
              class="quick-review-textarea"
              placeholder="Optional approval comment..."
            ></textarea>
            <div class="quick-review-form-actions">
              <button
                type="button"
                class="qr-submit-btn qr-submit-approve"
                :disabled="reviewSubmitState.status === 'submitting'"
                @click="submitQuickReview('APPROVE', quickReview.body)"
              >
                {{
                  reviewSubmitState.status === 'submitting' ? 'Submitting...' : 'Confirm approval'
                }}
              </button>
              <button type="button" class="qr-cancel-btn" @click="cancelQuickReview">Cancel</button>
            </div>
          </div>

          <div v-else-if="quickReview.status === 'compose'" class="quick-review-form">
            <label :for="reviewTextareaId" class="visually-hidden">Review comment</label>
            <textarea
              :id="reviewTextareaId"
              v-model="quickReview.body"
              rows="3"
              class="quick-review-textarea"
              :placeholder="
                quickReview.event === 'REQUEST_CHANGES'
                  ? 'Describe requested changes (required)...'
                  : 'Write a review comment (required)...'
              "
            ></textarea>
            <div class="quick-review-form-actions">
              <button
                type="button"
                class="qr-submit-btn"
                :class="{ 'qr-submit-changes': quickReview.event === 'REQUEST_CHANGES' }"
                :disabled="
                  reviewSubmitState.status === 'submitting' || quickReview.body.trim().length === 0
                "
                @click="submitQuickReview(quickReview.event, quickReview.body)"
              >
                {{
                  reviewSubmitState.status === 'submitting'
                    ? 'Submitting...'
                    : quickReview.event === 'REQUEST_CHANGES'
                      ? 'Submit changes requested'
                      : 'Post comment'
                }}
              </button>
              <button type="button" class="qr-cancel-btn" @click="cancelQuickReview">Cancel</button>
            </div>
          </div>

          <p
            v-if="reviewSubmitState.status === 'submitted'"
            class="rerun-status-note"
            role="status"
          >
            {{ reviewSubmitState.message }}
          </p>
          <p v-if="reviewSubmitState.status === 'error'" class="sync-error-note" role="alert">
            {{ reviewSubmitState.error }}
          </p>
        </div>
      </section>

      <section
        v-if="allReviewThreads.length > 0"
        class="detail-section"
        aria-label="Review threads"
      >
        <div class="detail-heading-row">
          <h2 class="detail-heading">
            Review Threads
            <span class="mono-num detail-count"> {{ unresolvedThreads.length }} unresolved </span>
          </h2>
          <button
            v-if="resolvedThreadCount > 0"
            type="button"
            class="checks-toggle-all-btn"
            :aria-pressed="showResolvedThreads ? 'true' : 'false'"
            @click="showResolvedThreads = !showResolvedThreads"
          >
            {{ showResolvedThreads ? 'Hide resolved' : `Show resolved (${resolvedThreadCount})` }}
          </button>
        </div>

        <p v-if="visibleReviewThreads.length === 0" class="empty-note">
          All review threads are resolved.
        </p>

        <ul v-else role="list" class="thread-list">
          <li
            v-for="thread in visibleReviewThreads"
            :key="thread.id"
            class="thread-card"
            :class="{ resolved: thread.isResolved }"
          >
            <div class="thread-head">
              <span class="thread-path mono-num">{{ formatThreadLocation(thread) }}</span>
              <span class="thread-badges">
                <span v-if="thread.isOutdated" class="thread-tag">outdated</span>
                <span v-if="thread.isResolved" class="thread-tag resolved-tag">resolved</span>
              </span>
              <div class="thread-head-actions">
                <button
                  v-if="pr"
                  type="button"
                  class="thread-action-btn"
                  @click="toggleReplyBox(thread.id)"
                >
                  Reply
                </button>
                <button
                  v-if="pr"
                  type="button"
                  class="thread-action-btn"
                  :disabled="isThreadBusy(thread.id)"
                  @click="onToggleThreadResolved(thread)"
                >
                  {{
                    getThreadState(thread.id).status === 'resolving'
                      ? 'Saving...'
                      : thread.isResolved
                        ? 'Unresolve'
                        : 'Resolve'
                  }}
                </button>
              </div>
            </div>

            <div class="thread-comments">
              <div v-for="comment in thread.comments" :key="comment.id" class="thread-comment">
                <div class="thread-comment-meta">
                  <span class="timeline-actor">@{{ comment.author }}</span>
                  <span class="timeline-age mono-num">{{
                    formatRelativeAge(comment.createdAt, nowMs)
                  }}</span>
                  <a
                    v-if="comment.url"
                    :href="comment.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="detail-link"
                  >
                    <span>GitHub</span>
                    <CarbonIcon name="launch" :size="11" />
                  </a>
                </div>
                <PrMarkdownBody
                  v-if="comment.bodyHtml"
                  :html="comment.bodyHtml"
                  :pr-url="comment.url ?? pr?.url ?? inspector.detail.url"
                  :pr-key="pr?.key ?? inspector.detail.key"
                  :resolved-theme="resolvedTheme"
                  @open-mermaid="$emit('open-mermaid', $event)"
                />
                <p v-else class="body-excerpt">{{ comment.bodyExcerpt }}</p>
              </div>
            </div>

            <div v-if="pr && openReplyThreadId === thread.id" class="thread-reply-form">
              <label :for="`reply-${thread.id}`" class="visually-hidden">Reply to thread</label>
              <textarea
                :id="`reply-${thread.id}`"
                v-model="replyDrafts[thread.id]"
                rows="2"
                class="quick-review-textarea"
                placeholder="Write a reply..."
              ></textarea>
              <div class="quick-review-form-actions">
                <button
                  type="button"
                  class="qr-submit-btn"
                  :disabled="
                    isThreadBusy(thread.id) || !(replyDrafts[thread.id] ?? '').trim().length
                  "
                  @click="submitThreadReply(thread.id)"
                >
                  {{
                    getThreadState(thread.id).status === 'replying' ? 'Sending...' : 'Send reply'
                  }}
                </button>
                <button type="button" class="qr-cancel-btn" @click="openReplyThreadId = null">
                  Cancel
                </button>
              </div>
            </div>

            <p
              v-if="getThreadState(thread.id).status === 'error'"
              class="sync-error-note"
              role="alert"
            >
              {{ (getThreadState(thread.id) as { status: 'error'; error: string }).error }}
            </p>
          </li>
        </ul>
      </section>

      <section class="detail-section" aria-label="Recent timeline">
        <h2 class="detail-heading">Recent Timeline (Last 5)</h2>
        <p v-if="inspector.detail.timeline.length === 0" class="empty-note">No timeline events.</p>
        <ul v-else role="list" class="detail-list">
          <li v-for="item in inspector.detail.timeline" :key="item.id" class="timeline-row">
            <div class="timeline-top">
              <span class="timeline-actor">@{{ item.actor }}</span>
              <span class="timeline-age mono-num">{{
                formatRelativeAge(item.createdAt, nowMs)
              }}</span>
            </div>
            <div class="timeline-summary">{{ item.summary }}</div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import DraftToggle from '@/components/DraftToggle.vue';
import LabelPicker from '@/components/LabelPicker.vue';
import MergeControl from '@/components/MergeControl.vue';
import PrMarkdownBody from '@/components/PrMarkdownBody.vue';
import ReviewerPicker from '@/components/ReviewerPicker.vue';
import SnoozePicker from '@/components/SnoozePicker.vue';
import {
  checkSummaryKey,
  IDLE_CHECK_SUMMARY_STATE,
  IDLE_PR_DRAFT_STATE,
  IDLE_PR_LABELS_STATE,
  IDLE_PR_MERGE_STATE,
  IDLE_PR_RERUN_STATE,
  IDLE_PR_REVIEW_SUBMIT_STATE,
  IDLE_PR_REVIEWERS_STATE,
  IDLE_PR_SYNC_STATE,
  IDLE_PR_TRIAGE_STATE,
  IDLE_REPO_LABELS_STATE,
  IDLE_REPO_REVIEWERS_STATE,
  IDLE_THREAD_ACTION_STATE,
  type CheckSummaryState,
  type InspectorState,
  type PrDraftState,
  type PrLabelsState,
  type PrMergeState,
  type PrRerunState,
  type PrReviewersState,
  type PrReviewSubmitState,
  type PrSyncState,
  type PrTriageState,
  type RepoLabelsState,
  type RepoReviewersState,
  type ThreadActionState,
} from '@/composables/use-dashboard-state';
import type { ResolvedTheme } from '@/composables/use-theme';
import type {
  CheckAnnotation,
  FlakyCheckSummary,
  MergeMethod,
  PrDetailCheck,
  PrReviewThread,
  PrView,
  ReviewEvent,
  SnoozeCondition,
} from '@/types/pr';
import { type CheckGroup, groupDetailChecks } from '@/utils/check-groups';
import { formatRelativeAge } from '@/utils/format';
import { formatSnoozeBadge, isPrPinned, isPrSnoozed } from '@/utils/triage';

interface Props {
  pr: PrView | null;
  inspector: InspectorState;
  nowMs: number;
  viewerLogin?: string;
  resolvedTheme?: ResolvedTheme;
  syncState?: PrSyncState;
  draftState?: PrDraftState;
  mergeState?: PrMergeState;
  repoLabelsState?: RepoLabelsState;
  labelState?: PrLabelsState;
  rerunState?: PrRerunState;
  checkSummaryStates?: Record<string, CheckSummaryState>;
  triageState?: PrTriageState;
  reviewSubmitState?: PrReviewSubmitState;
  threadActionStates?: Record<string, ThreadActionState>;
  repoReviewersState?: RepoReviewersState;
  prReviewersState?: PrReviewersState;
  flakyChecks?: FlakyCheckSummary[];
}

const props = withDefaults(defineProps<Props>(), {
  viewerLogin: '',
  resolvedTheme: 'dark',
  syncState: () => IDLE_PR_SYNC_STATE,
  draftState: () => IDLE_PR_DRAFT_STATE,
  mergeState: () => IDLE_PR_MERGE_STATE,
  repoLabelsState: () => IDLE_REPO_LABELS_STATE,
  labelState: () => IDLE_PR_LABELS_STATE,
  rerunState: () => IDLE_PR_RERUN_STATE,
  checkSummaryStates: () => ({}),
  triageState: () => IDLE_PR_TRIAGE_STATE,
  reviewSubmitState: () => IDLE_PR_REVIEW_SUBMIT_STATE,
  threadActionStates: () => ({}),
  repoReviewersState: () => IDLE_REPO_REVIEWERS_STATE,
  prReviewersState: () => IDLE_PR_REVIEWERS_STATE,
  flakyChecks: () => [],
});

const emit = defineEmits<{
  retry: [pr: PrView];
  sync: [pr: PrView];
  'rerun-checks': [pr: PrView, options?: { jobId?: number; runId?: number }];
  'load-check-summary': [
    pr: PrView,
    checkRunId: number,
    options?: { isActionsJob?: boolean; force?: boolean },
  ];
  'toggle-draft': [pr: PrView, nextDraft: boolean];
  'request-merge': [pr: PrView, method: MergeMethod];
  'load-labels': [pr: PrView];
  'retry-load-labels': [pr: PrView];
  'update-labels': [pr: PrView, labels: string[]];
  'toggle-pin': [pr: PrView];
  snooze: [pr: PrView, condition: SnoozeCondition];
  unsnooze: [pr: PrView];
  'submit-review': [pr: PrView, event: ReviewEvent, body?: string];
  'reply-thread': [pr: PrView, threadId: string, body: string];
  'resolve-thread': [pr: PrView, threadId: string, resolved: boolean];
  'load-reviewers': [pr: PrView];
  'retry-load-reviewers': [pr: PrView];
  'update-reviewers': [
    pr: PrView,
    changes: {
      addUsers?: string[];
      removeUsers?: string[];
      addTeams?: string[];
      removeTeams?: string[];
    },
  ];
  'open-mermaid': [source: string];
}>();

const showSyncAction = computed<boolean>(
  () =>
    Boolean(props.pr) && (props.pr?.merge.state === 'behind' || props.syncState.status !== 'idle'),
);

const flakyCountByCheck = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  const repo = props.pr?.repository;
  if (!repo) {
    return map;
  }
  for (const item of props.flakyChecks) {
    if (item.repository === repo && item.flakeCount > 0) {
      map.set(item.checkName, item.flakeCount);
    }
  }
  for (const name of props.pr?.ci.flakyChecks ?? []) {
    if (!map.has(name)) {
      map.set(name, 1);
    }
  }
  return map;
});

function flakyCountForCheck(name: string): number {
  return flakyCountByCheck.value.get(name) ?? 0;
}

const isSyncBusy = computed<boolean>(
  () => props.syncState.status === 'syncing' || props.syncState.status === 'synced',
);

const syncButtonText = computed<string>(() => {
  const base = props.pr?.baseRefName ?? 'base';
  if (props.syncState.status === 'syncing') {
    return `Syncing with ${base}`;
  }
  if (props.syncState.status === 'synced') {
    return `Synced with ${base}`;
  }
  return `Sync with ${base}`;
});

const syncAriaLabel = computed<string>(() => {
  if (!props.pr) {
    return syncButtonText.value;
  }
  return `${syncButtonText.value} for ${props.pr.key}`;
});

const descriptionHeadingId = `description-heading-${useId()}`;
const checksHeadingId = `checks-heading-${useId()}`;
const reviewTextareaId = `quick-review-body-${useId()}`;

type QuickReviewMode =
  | { status: 'idle' }
  | { status: 'confirm-approve'; body: string }
  | { status: 'compose'; event: 'COMMENT' | 'REQUEST_CHANGES'; body: string };

const quickReview = ref<QuickReviewMode>({ status: 'idle' });
const showResolvedThreads = ref<boolean>(false);
const openReplyThreadId = ref<string | null>(null);
const replyDrafts = ref<Record<string, string>>({});

const isOwnPr = computed<boolean>(() => {
  if (!props.pr || !props.viewerLogin) {
    return false;
  }
  return props.pr.author.toLowerCase() === props.viewerLogin.toLowerCase();
});

const allReviewThreads = computed<PrReviewThread[]>(() => {
  if (props.inspector.status !== 'open') {
    return [];
  }
  return props.inspector.detail.reviewThreads ?? [];
});

const unresolvedThreads = computed<PrReviewThread[]>(() =>
  allReviewThreads.value.filter((t) => !t.isResolved),
);

const resolvedThreadCount = computed<number>(
  () => allReviewThreads.value.length - unresolvedThreads.value.length,
);

const visibleReviewThreads = computed<PrReviewThread[]>(() =>
  showResolvedThreads.value ? allReviewThreads.value : unresolvedThreads.value,
);

function startQuickApprove(): void {
  if (props.reviewSubmitState.status === 'submitting') {
    return;
  }
  quickReview.value =
    quickReview.value.status === 'confirm-approve'
      ? { status: 'idle' }
      : { status: 'confirm-approve', body: '' };
}

function startQuickCompose(event: 'COMMENT' | 'REQUEST_CHANGES'): void {
  if (props.reviewSubmitState.status === 'submitting') {
    return;
  }
  if (quickReview.value.status === 'compose' && quickReview.value.event === event) {
    quickReview.value = { status: 'idle' };
    return;
  }
  quickReview.value = { status: 'compose', event, body: '' };
}

function cancelQuickReview(): void {
  quickReview.value = { status: 'idle' };
}

function submitQuickReview(event: ReviewEvent, body: string): void {
  if (!props.pr) {
    return;
  }
  emit('submit-review', props.pr, event, body);
  quickReview.value = { status: 'idle' };
}

function getThreadState(threadId: string): ThreadActionState {
  return props.threadActionStates[threadId] ?? IDLE_THREAD_ACTION_STATE;
}

function isThreadBusy(threadId: string): boolean {
  const st = getThreadState(threadId).status;
  return st === 'replying' || st === 'resolving';
}

function formatThreadLocation(thread: PrReviewThread): string {
  const line = thread.line ?? thread.originalLine;
  return line ? `${thread.path}:${line}` : thread.path;
}

function toggleReplyBox(threadId: string): void {
  openReplyThreadId.value = openReplyThreadId.value === threadId ? null : threadId;
}

function submitThreadReply(threadId: string): void {
  if (!props.pr) {
    return;
  }
  const body = (replyDrafts.value[threadId] ?? '').trim();
  if (!body) {
    return;
  }
  emit('reply-thread', props.pr, threadId, body);
  replyDrafts.value = { ...replyDrafts.value, [threadId]: '' };
  openReplyThreadId.value = null;
}

function onToggleThreadResolved(thread: PrReviewThread): void {
  if (!props.pr || isThreadBusy(thread.id)) {
    return;
  }
  emit('resolve-thread', props.pr, thread.id, !thread.isResolved);
}

const checkGroups = computed<CheckGroup[]>(() => {
  if (props.inspector.status !== 'open') {
    return [];
  }
  return groupDetailChecks(props.inspector.detail.checks);
});

const openGroupIds = ref<Set<string>>(new Set());

watch(
  () => [props.pr?.key ?? null, props.inspector.status === 'open' ? props.inspector.detail : null],
  () => {
    openGroupIds.value = new Set(checkGroups.value.filter((g) => g.defaultOpen).map((g) => g.id));
  },
  { immediate: true },
);

const allGroupsExpanded = computed<boolean>(
  () =>
    checkGroups.value.length > 0 && checkGroups.value.every((g) => openGroupIds.value.has(g.id)),
);

function onGroupToggle(groupId: string, event: Event): void {
  const details = event.target as HTMLDetailsElement | null;
  if (!details) {
    return;
  }
  const next = new Set(openGroupIds.value);
  if (details.open) {
    next.add(groupId);
  } else {
    next.delete(groupId);
  }
  openGroupIds.value = next;
}

function toggleAllCheckGroups(): void {
  if (allGroupsExpanded.value) {
    openGroupIds.value = new Set();
  } else {
    openGroupIds.value = new Set(checkGroups.value.map((g) => g.id));
  }
}

function onSyncClick(): void {
  if (!props.pr || isSyncBusy.value) {
    return;
  }
  emit('sync', props.pr);
}

const hasFailingChecks = computed<boolean>(() => {
  if (props.inspector.status === 'open') {
    return props.inspector.detail.checks.some((check) => check.bucket === 'failing');
  }
  return props.pr?.ci.state === 'failing';
});

const showRerunAllAction = computed<boolean>(
  () => Boolean(props.pr) && (hasFailingChecks.value || props.rerunState.status !== 'idle'),
);

const isRerunAllPending = computed<boolean>(
  () => props.rerunState.status === 'rerunning' && props.rerunState.jobId === null,
);

const isRerunAllQueued = computed<boolean>(
  () => props.rerunState.status === 'queued' && props.rerunState.jobId === null,
);

const isRerunAllBusy = computed<boolean>(
  () => props.rerunState.status === 'rerunning' || isRerunAllQueued.value,
);

const rerunAllButtonText = computed<string>(() => {
  if (isRerunAllPending.value) {
    return 'Re-running';
  }
  if (isRerunAllQueued.value) {
    return 'Queued';
  }
  return 'Re-run failed';
});

const rerunAllAriaLabel = computed<string>(() => {
  if (!props.pr) {
    return rerunAllButtonText.value;
  }
  return `${rerunAllButtonText.value} checks for ${props.pr.key}`;
});

function onRerunAllClick(): void {
  if (!props.pr || isRerunAllBusy.value) {
    return;
  }
  emit('rerun-checks', props.pr);
}

function isRerunnableJob(check: PrDetailCheck): boolean {
  return (
    Boolean(props.pr) &&
    check.kind === 'CheckRun' &&
    check.bucket === 'failing' &&
    typeof check.checkRunId === 'number' &&
    typeof check.workflowRunId === 'number'
  );
}

function isJobRerunning(jobId: number): boolean {
  return props.rerunState.status === 'rerunning' && props.rerunState.jobId === jobId;
}

function isJobQueued(jobId: number): boolean {
  return props.rerunState.status === 'queued' && props.rerunState.jobId === jobId;
}

function isJobButtonDisabled(jobId: number): boolean {
  return props.rerunState.status === 'rerunning' || isJobQueued(jobId);
}

function jobRerunLabel(jobId: number): string {
  if (isJobRerunning(jobId)) {
    return 'Re-running';
  }
  if (isJobQueued(jobId)) {
    return 'Queued';
  }
  return 'Re-run';
}

function onRerunJobClick(jobId: number): void {
  if (!props.pr || isJobButtonDisabled(jobId)) {
    return;
  }
  emit('rerun-checks', props.pr, { jobId });
}

const expandedCheckIds = ref<Set<number>>(new Set());
const copiedCheckId = ref<number | null>(null);
let copiedTimer: number | null = null;

watch(
  () => props.pr?.key ?? null,
  () => {
    expandedCheckIds.value = new Set();
    copiedCheckId.value = null;
    quickReview.value = { status: 'idle' };
    showResolvedThreads.value = false;
    openReplyThreadId.value = null;
  },
);

onUnmounted(() => {
  if (typeof window !== 'undefined' && copiedTimer !== null) {
    window.clearTimeout(copiedTimer);
    copiedTimer = null;
  }
});

function hasInlineSummary(check: PrDetailCheck): boolean {
  return (
    Boolean(props.pr) &&
    check.kind === 'CheckRun' &&
    check.bucket === 'failing' &&
    typeof check.checkRunId === 'number'
  );
}

function isCheckExpanded(checkRunId: number): boolean {
  return expandedCheckIds.value.has(checkRunId);
}

function getCheckSummaryState(checkRunId: number): CheckSummaryState {
  if (!props.pr) {
    return IDLE_CHECK_SUMMARY_STATE;
  }
  return (
    props.checkSummaryStates[checkSummaryKey(props.pr.key, checkRunId)] ?? IDLE_CHECK_SUMMARY_STATE
  );
}

function toggleCheckSummary(check: PrDetailCheck): void {
  if (!props.pr || typeof check.checkRunId !== 'number') {
    return;
  }
  const next = new Set(expandedCheckIds.value);
  if (next.has(check.checkRunId)) {
    next.delete(check.checkRunId);
  } else {
    next.add(check.checkRunId);
    emit('load-check-summary', props.pr, check.checkRunId, {
      isActionsJob: typeof check.workflowRunId === 'number',
    });
  }
  expandedCheckIds.value = next;
}

function retryCheckSummary(check: PrDetailCheck): void {
  if (!props.pr || typeof check.checkRunId !== 'number') {
    return;
  }
  emit('load-check-summary', props.pr, check.checkRunId, {
    isActionsJob: typeof check.workflowRunId === 'number',
    force: true,
  });
}

function formatAnnotationLocation(ann: CheckAnnotation): string {
  if (!ann.startLine) {
    return ann.path;
  }
  if (ann.endLine && ann.endLine !== ann.startLine) {
    return `${ann.path}:${ann.startLine}-${ann.endLine}`;
  }
  return `${ann.path}:${ann.startLine}`;
}

async function copyLogExcerpt(checkRunId: number, text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    copiedCheckId.value = checkRunId;
    if (typeof window !== 'undefined') {
      if (copiedTimer !== null) {
        window.clearTimeout(copiedTimer);
      }
      copiedTimer = window.setTimeout(() => {
        copiedTimer = null;
        if (copiedCheckId.value === checkRunId) {
          copiedCheckId.value = null;
        }
      }, 2_000);
    }
  } catch {
    // Ignore clipboard rejection in restricted contexts.
  }
}
</script>

<style scoped>
.inspector-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.inspector-meta {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.summary-callout {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: 0.4rem;
  background-color: var(--bg-surface-muted);
  font-size: 0.875rem;
  font-weight: 500;
}

.branch-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

.draft-callout {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.15rem;
  padding: 0.45rem 0.65rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.draft-callout-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 0.75rem;
}

.draft-callout-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-secondary);
}

.inspector-labels-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.inspector-triage-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.inspector-pin-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-block-size: 2rem;
  padding: 0.25rem 0.55rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.inspector-pin-btn:hover {
  border-color: var(--border-strong);
  color: var(--ink-primary);
}

.inspector-pin-btn.active {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.sync-callout {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.15rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.sync-callout-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.sync-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-block-size: 2rem;
  min-inline-size: 2rem;
  padding: 0.25rem 0.7rem;
  border-radius: 0.375rem;
  border: 1px solid var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.sync-action-btn:hover:not([aria-disabled='true']) {
  background-color: var(--accent-blue);
  color: #ffffff;
}

.sync-action-btn.synced {
  border-color: var(--accent-emerald);
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
}

.sync-action-btn[aria-disabled='true'] {
  cursor: default;
  opacity: 0.85;
}

.sync-hint {
  font-size: 0.75rem;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

.sync-error-note {
  margin: 0;
  padding: 0.4rem 0.55rem;
  border-radius: 0.35rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.body-excerpt {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--ink-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.state-box {
  padding: 1rem;
  border-radius: 0.4rem;
  background-color: var(--bg-surface-muted);
  font-size: 0.8125rem;
  color: var(--ink-secondary);
}

.error-box {
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}

.retry-btn {
  min-height: 2rem;
  padding: 0.25rem 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  cursor: pointer;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.detail-heading {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-secondary);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.detail-count {
  color: var(--ink-muted);
}

.empty-note {
  margin: 0;
  font-size: 0.8rem;
  color: var(--ink-muted);
}

.detail-heading-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.detail-heading-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.checks-rerun-btn,
.check-rerun-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-block-size: 1.5rem;
  padding: 0.15rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px solid var(--accent-amber);
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.checks-rerun-btn:hover:not([aria-disabled='true']),
.check-rerun-btn:hover:not([aria-disabled='true']) {
  background-color: var(--accent-amber);
  color: light-dark(#ffffff, #0b1017);
}

.checks-rerun-btn.queued,
.check-rerun-btn.queued {
  border-color: var(--accent-emerald);
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
}

.checks-rerun-btn[aria-disabled='true'],
.check-rerun-btn[aria-disabled='true'] {
  cursor: default;
  opacity: 0.85;
}

.check-rerun-btn {
  flex: 0 0 auto;
}

.rerun-status-note {
  margin: 0;
  padding: 0.4rem 0.55rem;
  border-radius: 0.35rem;
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.checks-toggle-all-btn {
  min-block-size: 1.5rem;
  padding: 0.15rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.checks-toggle-all-btn:hover {
  border-color: var(--border-strong);
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

.check-groups {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.check-group {
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.check-group[data-bucket='failing'] {
  border-color: color-mix(in srgb, var(--accent-red) 45%, var(--border-subtle));
}

.check-group-summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-block-size: 2.15rem;
  padding: 0.38rem 0.55rem;
  border-radius: 0.35rem;
  cursor: pointer;
  user-select: none;
  font-size: 0.8rem;
  transition: background-color 120ms ease;
}

.check-group[open] > .check-group-summary {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.check-group-summary::-webkit-details-marker {
  display: none;
}

.check-group-summary:hover {
  background-color: var(--bg-surface-hover);
}

.check-group-chevron {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-muted);
  rotate: -90deg;
}

.check-group[open] > .check-group-summary > .check-group-chevron {
  rotate: 0deg;
}

@media (prefers-reduced-motion: no-preference) {
  .check-group-chevron {
    transition: rotate 0.18s ease;
  }
}

.check-group-label {
  flex: 1 1 auto;
  min-inline-size: 0;
  font-weight: 600;
  color: var(--ink-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-group-counts {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
}

.group-count-fail {
  color: var(--accent-red);
}

.group-count-pend {
  color: var(--accent-amber);
}

.group-count-pass {
  color: var(--accent-emerald);
}

.check-group::details-content {
  interpolate-size: allow-keywords;
  overflow: clip;
  contain: layout;
}

.check-group:not([open])::details-content {
  block-size: 0;
}

@media (prefers-reduced-motion: no-preference) {
  .check-group::details-content {
    transition: block-size, content-visibility, display;
    transition-duration: 0.2s;
    transition-timing-function: ease-in-out;
    transition-behavior: allow-discrete;
  }
}

.check-group-list {
  padding: 0.25rem 0.45rem 0.45rem;
  border-top: 1px solid var(--border-subtle);
  border-bottom-left-radius: 0.35rem;
  border-bottom-right-radius: 0.35rem;
  background-color: var(--bg-surface);
}

.detail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 0.35rem;
  background-color: var(--bg-surface-muted);
  font-size: 0.8rem;
}

.detail-check-item {
  flex-direction: column;
  align-items: stretch;
  gap: 0.45rem;
}

.detail-row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.5rem;
  min-width: 0;
}

.detail-row-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-inline-start: auto;
}

.check-logs-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-block-size: 1.5rem;
  padding: 0.15rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.check-logs-btn:hover,
.check-logs-btn.expanded {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.check-summary-panel {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--border-subtle);
  min-width: 0;
}

.check-summary-loading,
.check-summary-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--ink-secondary);
}

.check-summary-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  border-radius: 0.35rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.75rem;
}

.check-summary-retry-btn,
.check-log-copy-btn {
  min-block-size: 1.45rem;
  padding: 0.1rem 0.45rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
}

.check-summary-ready {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.check-failed-step {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.74rem;
}

.check-failed-step-label {
  padding: 0.05rem 0.35rem;
  border-radius: 0.25rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-weight: 700;
  font-size: 0.68rem;
  text-transform: uppercase;
}

.check-failed-step-name {
  color: var(--ink-primary);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.check-output-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.check-output-title {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-primary);
  overflow-wrap: anywhere;
}

.check-output-summary {
  margin: 0;
  font-size: 0.75rem;
  color: var(--ink-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.check-annotations-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.check-annotation-item {
  padding: 0.35rem 0.45rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.check-annotation-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
}

.check-annotation-level {
  padding: 0.04rem 0.3rem;
  border-radius: 0.2rem;
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  background-color: var(--bg-surface-muted);
  color: var(--ink-secondary);
}

.check-annotation-level[data-level='failure'] {
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
}

.check-annotation-level[data-level='warning'] {
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
}

.check-annotation-path {
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

.check-annotation-title {
  color: var(--ink-primary);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.check-annotation-message {
  margin: 0;
  font-size: 0.74rem;
  color: var(--ink-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.check-log-block {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.check-log-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.check-log-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

.check-log-pre {
  margin: 0;
  padding: 0.5rem 0.6rem;
  max-block-size: 16rem;
  overflow: auto;
  border-radius: 0.35rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-canvas);
  color: var(--ink-primary);
  font-family: var(--font-mono);
  font-size: 0.71rem;
  line-height: 1.45;
  white-space: pre;
}

.quick-review-box {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.35rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.quick-review-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.quick-review-triggers {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.qr-btn {
  min-block-size: 1.7rem;
  padding: 0.18rem 0.55rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
}

.qr-btn.active {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.qr-approve-btn {
  border-color: var(--accent-emerald);
  color: var(--accent-emerald);
}

.qr-approve-btn.active {
  background-color: var(--accent-emerald-bg);
  color: var(--accent-emerald);
}

.qr-changes-btn {
  border-color: color-mix(in srgb, var(--accent-red) 60%, var(--border-strong));
  color: var(--accent-red);
}

.qr-changes-btn.active {
  border-color: var(--accent-red);
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
}

.quick-review-form,
.thread-reply-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.quick-review-textarea {
  width: 100%;
  padding: 0.45rem 0.55rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-family: var(--font-sans);
  font-size: 0.8rem;
  resize: vertical;
}

.quick-review-form-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.qr-submit-btn {
  min-block-size: 1.8rem;
  padding: 0.2rem 0.65rem;
  border-radius: 0.35rem;
  border: 1px solid var(--accent-blue);
  background-color: var(--accent-blue);
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.qr-submit-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.qr-submit-approve {
  border-color: var(--accent-emerald);
  background-color: var(--accent-emerald);
  color: light-dark(#ffffff, #0b1017);
}

.qr-submit-changes {
  border-color: var(--accent-red);
  background-color: var(--accent-red);
  color: #ffffff;
}

.qr-cancel-btn,
.thread-action-btn {
  min-block-size: 1.65rem;
  padding: 0.15rem 0.5rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.qr-cancel-btn:hover,
.thread-action-btn:hover:not(:disabled) {
  color: var(--ink-primary);
  background-color: var(--bg-surface-hover);
}

.thread-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.thread-card {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
}

.thread-card.resolved {
  opacity: 0.72;
}

.thread-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
}

.thread-path {
  font-size: 0.73rem;
  font-weight: 600;
  color: var(--ink-primary);
  overflow-wrap: anywhere;
}

.thread-badges {
  display: inline-flex;
  gap: 0.25rem;
}

.thread-tag {
  padding: 0.04rem 0.32rem;
  border-radius: 0.25rem;
  font-size: 0.66rem;
  font-weight: 600;
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
  border: 1px solid var(--border-subtle);
}

.thread-tag.resolved-tag {
  color: var(--accent-emerald);
  border-color: color-mix(in srgb, var(--accent-emerald) 45%, transparent);
}

.thread-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-inline-start: auto;
}

.thread-comments {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.thread-comment {
  padding: 0.4rem 0.5rem;
  border-radius: 0.35rem;
  background-color: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.thread-comment-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.check-badge,
.rev-state {
  flex: 0 0 auto;
  padding: 0.08rem 0.35rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  background-color: var(--bg-surface);
  color: var(--ink-secondary);
}

.check-badge[data-bucket='passing'],
.rev-state[data-state='APPROVED'] {
  color: var(--accent-emerald);
}

.check-badge[data-bucket='failing'],
.rev-state[data-state='CHANGES_REQUESTED'] {
  color: var(--accent-red);
}

.check-badge[data-bucket='pending'],
.rev-state[data-state='PENDING'] {
  color: var(--accent-amber);
}

.detail-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.codeowner-note {
  margin-left: 0.35rem;
  font-size: 0.7rem;
  color: var(--ink-muted);
}

.detail-link {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--accent-blue);
  text-decoration: none;
  font-size: 0.75rem;
  font-weight: 500;
}

.timeline-row {
  padding: 0.45rem 0.55rem;
  border-radius: 0.35rem;
  background-color: var(--bg-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.timeline-top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.timeline-actor {
  font-weight: 600;
}

.timeline-age {
  color: var(--ink-muted);
}

.timeline-summary {
  font-size: 0.8rem;
  color: var(--ink-secondary);
  overflow-wrap: anywhere;
}

.flaky-check-badge {
  flex: 0 0 auto;
  padding: 0.08rem 0.38rem;
  border-radius: 0.3rem;
  border: 1px solid color-mix(in srgb, var(--accent-amber) 55%, transparent);
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
}
</style>
