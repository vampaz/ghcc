<template>
  <div class="inspector-body">
    <div v-if="pr" class="inspector-meta">
      <p class="summary-callout">{{ pr.blockerSummary }}</p>
      <div class="branch-line mono-num">
        <span>{{ pr.headRefName }}</span>
        <span aria-hidden="true">→</span>
        <span>{{ pr.baseRefName }}</span>
        <span class="meta-sep">·</span>
        <span>by @{{ pr.author }}</span>
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
      <p v-if="inspector.detail.bodyExcerpt" class="body-excerpt">
        {{ inspector.detail.bodyExcerpt }}
      </p>

      <section class="detail-section" aria-label="Checks">
        <h2 class="detail-heading">
          Checks
          <span class="mono-num detail-count">
            {{ inspector.detail.checks.length }}
            <template v-if="inspector.detail.checksTotalCount > inspector.detail.checks.length">
              / {{ inspector.detail.checksTotalCount }}
            </template>
          </span>
        </h2>
        <p v-if="inspector.detail.checks.length === 0" class="empty-note">No checks reported.</p>
        <ul v-else role="list" class="detail-list">
          <li
            v-for="chk in inspector.detail.checks"
            :key="`${chk.kind}-${chk.name}`"
            class="detail-row"
          >
            <span class="check-badge" :data-bucket="chk.bucket">{{ chk.bucket }}</span>
            <span class="detail-name">{{ chk.name }}</span>
            <a
              v-if="chk.url"
              :href="chk.url"
              target="_blank"
              rel="noopener noreferrer"
              class="detail-link"
            >
              details ↗
            </a>
          </li>
        </ul>
      </section>

      <section class="detail-section" aria-label="Reviewers">
        <h2 class="detail-heading">
          Reviewers
          <span class="mono-num detail-count">{{ inspector.detail.reviewers.length }}</span>
        </h2>
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
import type { InspectorState } from '@/composables/use-dashboard-state';
import type { PrView } from '@/types/pr';
import { formatRelativeAge } from '@/utils/format';

interface Props {
  pr: PrView | null;
  inspector: InspectorState;
  nowMs: number;
}

defineProps<Props>();

defineEmits<{
  retry: [pr: PrView];
}>();
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
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--ink-secondary);
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
</style>
