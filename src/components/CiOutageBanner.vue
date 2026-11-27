<template>
  <section
    v-if="visibleOutages.length > 0"
    class="outage-strip"
    aria-label="Shared CI failure alerts"
  >
    <div class="outage-list">
      <div v-for="outage in visibleOutages" :key="outage.id" class="outage-row" role="status">
        <span class="outage-badge">
          <CarbonIcon name="warning-filled" :size="13" />
          <span>Shared CI Outage</span>
        </span>
        <span class="outage-msg">
          <strong class="mono-num">{{ outage.checkName }}</strong>
          is failing on
          <strong class="mono-num">{{ outage.affectedCount }}</strong>
          open PRs in
          <span class="mono-num">{{ outage.repository }}</span>
          <span v-if="outage.authors.length > 1" class="outage-authors">
            ({{ outage.authors.length }} authors — likely shared/base breakage)
          </span>
        </span>
        <div class="outage-actions">
          <button
            type="button"
            class="outage-action-btn primary"
            @click="$emit('filter-outage', outage)"
          >
            Filter affected ({{ outage.affectedCount }})
          </button>
          <a
            v-if="outage.sampleUrl"
            :href="outage.sampleUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="outage-action-btn"
          >
            <span>Inspect run</span>
            <CarbonIcon name="launch" :size="12" />
          </a>
          <button
            type="button"
            class="outage-dismiss-btn"
            :aria-label="`Dismiss shared CI outage alert for ${outage.checkName}`"
            @click="$emit('dismiss', outageSignature(outage))"
          >
            <CarbonIcon name="close" :size="14" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import type { CiOutageAlert } from '@/types/pr';

interface Props {
  outages: CiOutageAlert[];
  dismissedSignatures: ReadonlySet<string>;
}

const props = defineProps<Props>();

defineEmits<{
  'filter-outage': [outage: CiOutageAlert];
  dismiss: [signature: string];
}>();

function outageSignature(outage: CiOutageAlert): string {
  return `${outage.id}::${outage.affectedPrKeys.join(',')}`;
}

const visibleOutages = computed<CiOutageAlert[]>(() =>
  props.outages.filter((outage) => !props.dismissedSignatures.has(outageSignature(outage))),
);
</script>

<style scoped>
.outage-strip {
  flex: 0 0 auto;
  inline-size: 100%;
  max-inline-size: 90rem;
  margin-inline: auto;
  padding: 0.5rem 1.25rem 0;
}

.outage-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.outage-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--accent-red) 55%, var(--border-strong));
  background-color: color-mix(in srgb, var(--accent-red-bg) 70%, var(--bg-surface));
  font-size: 0.8125rem;
}

.outage-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent-red);
  white-space: nowrap;
}

.outage-msg {
  flex: 1 1 16rem;
  color: var(--ink-primary);
  overflow-wrap: anywhere;
}

.outage-authors {
  color: var(--ink-secondary);
}

.outage-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.outage-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-block-size: 1.75rem;
  padding: 0.15rem 0.55rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  font-size: 0.75rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.outage-action-btn:hover {
  background-color: var(--bg-surface-hover);
}

.outage-action-btn.primary {
  border-color: var(--accent-red);
  color: var(--accent-red);
}

.outage-action-btn.primary:hover {
  background-color: var(--accent-red);
  color: #ffffff;
}

.outage-dismiss-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 1.75rem;
  block-size: 1.75rem;
  padding: 0;
  border: 0;
  border-radius: 0.35rem;
  background: transparent;
  color: var(--ink-secondary);
  cursor: pointer;
}

.outage-dismiss-btn:hover {
  background-color: var(--bg-surface-hover);
  color: var(--ink-primary);
}

@media (max-width: 639px) {
  .outage-strip {
    padding: 0.5rem 0.875rem 0;
  }
}
</style>
