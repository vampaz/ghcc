<template>
  <dialog
    ref="dialogRef"
    class="merge-confirm-dialog"
    aria-labelledby="merge-confirm-title"
    @close="onDialogClose"
  >
    <div v-if="pr" class="merge-dialog-content">
      <h1 id="merge-confirm-title" class="merge-dialog-title">Confirm pull request merge</h1>

      <div class="merge-dialog-pr">
        <span class="merge-dialog-key mono-num">{{ pr.key }}</span>
        <p class="merge-dialog-pr-title">{{ pr.title }}</p>
        <div class="merge-dialog-branches mono-num">
          <span>{{ pr.headRefName }}</span>
          <CarbonIcon name="arrow-right" :size="12" />
          <span>{{ pr.baseRefName }}</span>
        </div>
      </div>

      <p v-if="bypassNotice" class="merge-dialog-warning" role="note">
        <CarbonIcon name="warning-alt" :size="16" class="merge-warning-icon" />
        <span>{{ bypassNotice }}</span>
      </p>

      <div v-if="dependencyWarnings.length > 0" class="merge-dialog-warning" role="note">
        <CarbonIcon name="branch" :size="16" class="merge-warning-icon" />
        <div class="merge-warning-list">
          <strong>Dependency order notice:</strong>
          <ul role="list" class="merge-warning-items">
            <li v-for="note in dependencyWarnings" :key="note">{{ note }}</li>
          </ul>
        </div>
      </div>

      <fieldset class="merge-method-group">
        <legend class="merge-method-legend">Merge method</legend>
        <label class="merge-method-option" :class="{ selected: chosenMethod === 'squash' }">
          <input
            v-model="chosenMethod"
            type="radio"
            name="merge-method"
            value="squash"
            :disabled="isMerging"
          />
          <span class="merge-method-copy">
            <span class="merge-method-name">Squash and merge</span>
            <span class="merge-method-desc">
              Combine all commits into a single commit on {{ pr.baseRefName }}.
            </span>
          </span>
        </label>

        <label class="merge-method-option" :class="{ selected: chosenMethod === 'merge' }">
          <input
            v-model="chosenMethod"
            type="radio"
            name="merge-method"
            value="merge"
            :disabled="isMerging"
          />
          <span class="merge-method-copy">
            <span class="merge-method-name">Create a merge commit</span>
            <span class="merge-method-desc">
              Add all commits from {{ pr.headRefName }} with a regular merge commit.
            </span>
          </span>
        </label>
      </fieldset>

      <p v-if="errorMessage" class="merge-dialog-error" role="alert">
        {{ errorMessage }}
      </p>

      <div class="merge-dialog-actions">
        <button
          ref="cancelBtnRef"
          type="button"
          class="merge-cancel-btn"
          autofocus
          :disabled="isMerging"
          @click="onCancel"
        >
          Cancel
        </button>
        <button
          type="button"
          class="merge-submit-btn"
          :class="{ bypass: Boolean(bypassNotice) }"
          :aria-disabled="isMerging ? 'true' : undefined"
          @click="onConfirm"
        >
          <progress
            v-if="isMerging"
            class="loading-spinner"
            aria-label="Merging pull request"
          ></progress>
          <span>{{ submitLabel }}</span>
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import { IDLE_PR_MERGE_STATE, type PrMergeState } from '@/composables/use-dashboard-state';
import type { MergeMethod, PrView } from '@/types/pr';

interface Props {
  open: boolean;
  pr: PrView | null;
  initialMethod: MergeMethod;
  mergeState?: PrMergeState;
  dependencyWarnings?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  mergeState: () => IDLE_PR_MERGE_STATE,
  dependencyWarnings: () => [],
});

const emit = defineEmits<{
  close: [];
  confirm: [pr: PrView, method: MergeMethod];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const cancelBtnRef = ref<HTMLButtonElement | null>(null);
const chosenMethod = ref<MergeMethod>(props.initialMethod);

const isMerging = computed<boolean>(() => props.mergeState.status === 'merging');
const errorMessage = computed<string | null>(() =>
  props.mergeState.status === 'error' ? props.mergeState.error : null,
);

const bypassNotice = computed<string | null>(() => {
  const pr = props.pr;
  if (!pr || pr.bucket === 'ready') {
    return null;
  }
  const reasons: string[] = [];
  if (pr.ci.state === 'failing') {
    reasons.push('CI checks are failing');
  } else if (pr.ci.state === 'pending') {
    reasons.push('CI checks are still pending');
  }
  if (pr.review.decision === 'changes-requested' || pr.review.changesRequested.length > 0) {
    reasons.push('changes were requested');
  } else if (pr.review.decision === 'required') {
    reasons.push('required review is missing');
  }
  if (pr.merge.state === 'behind') {
    reasons.push('branch is behind base');
  } else if (pr.merge.state === 'blocked') {
    reasons.push('branch rules are not met');
  }
  if (reasons.length === 0) {
    return null;
  }
  return `Bypass notice: ${reasons.join(', ')}. Merging will bypass branch protections if your GitHub permissions allow it.`;
});

const submitLabel = computed<string>(() => {
  if (isMerging.value) {
    return chosenMethod.value === 'merge' ? 'Merging...' : 'Squashing and merging...';
  }
  return chosenMethod.value === 'merge' ? 'Confirm merge' : 'Confirm squash and merge';
});

watch(
  () => [props.open, props.pr?.key, props.initialMethod] as const,
  async ([isOpen, , method]) => {
    if (isOpen) {
      chosenMethod.value = method;
      await nextTick();
      const dialog = dialogRef.value;
      if (!dialog) {
        return;
      }
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
      }
      cancelBtnRef.value?.focus();
    } else {
      const dialog = dialogRef.value;
      if (dialog?.open) {
        if (typeof dialog.close === 'function') {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
      }
    }
  },
  { immediate: true },
);

function onDialogClose(): void {
  const dialog = dialogRef.value;
  if (dialog) {
    dialog.returnValue = '';
  }
  if (props.open) {
    emit('close');
  }
}

function onCancel(): void {
  if (isMerging.value) {
    return;
  }
  const dialog = dialogRef.value;
  if (dialog?.open && typeof dialog.close === 'function') {
    dialog.close('cancel');
  } else {
    emit('close');
  }
}

function onConfirm(): void {
  if (!props.pr || isMerging.value) {
    return;
  }
  emit('confirm', props.pr, chosenMethod.value);
}
</script>

<style scoped>
.merge-confirm-dialog {
  padding: 0;
  margin: auto;
  inline-size: min(30rem, calc(100vw - 2rem));
  max-inline-size: 100%;
  border-radius: 0.625rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: 0 20px 50px rgb(0 0 0 / 0.45);
}

.merge-confirm-dialog[open] {
  display: block;
}

.merge-confirm-dialog::backdrop {
  background-color: rgb(6 10 16 / 0.6);
}

.merge-dialog-content {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.merge-dialog-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--ink-primary);
}

.merge-dialog-pr {
  padding: 0.65rem 0.75rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.merge-dialog-key {
  font-size: 0.76rem;
  color: var(--ink-secondary);
}

.merge-dialog-pr-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--ink-primary);
  overflow-wrap: anywhere;
}

.merge-dialog-branches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.74rem;
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

.merge-dialog-warning {
  margin: 0;
  padding: 0.55rem 0.7rem;
  border-radius: 0.4rem;
  border: 1px solid color-mix(in srgb, var(--accent-amber) 50%, transparent);
  background-color: var(--accent-amber-bg);
  color: var(--accent-amber);
  font-size: 0.8rem;
  line-height: 1.4;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.merge-warning-icon {
  margin-top: 0.1rem;
}

.merge-warning-list {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.merge-warning-items {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.merge-method-group {
  margin: 0;
  padding: 0;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.merge-method-legend {
  padding: 0;
  margin-bottom: 0.35rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

.merge-method-option {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  cursor: pointer;
}

.merge-method-option.selected {
  border-color: var(--accent-blue);
  background-color: var(--accent-blue-bg);
}

.merge-method-option input {
  margin-top: 0.2rem;
  accent-color: var(--accent-blue);
}

.merge-method-copy {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.merge-method-name {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--ink-primary);
}

.merge-method-desc {
  font-size: 0.75rem;
  color: var(--ink-secondary);
}

.merge-dialog-error {
  margin: 0;
  padding: 0.5rem 0.65rem;
  border-radius: 0.4rem;
  background-color: var(--accent-red-bg);
  color: var(--accent-red);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.merge-dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.15rem;
}

.merge-cancel-btn,
.merge-submit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-block-size: 2.25rem;
  padding: 0.35rem 0.85rem;
  border-radius: 0.4rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.merge-cancel-btn {
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface-muted);
  color: var(--ink-primary);
}

.merge-cancel-btn:hover:not(:disabled) {
  background-color: var(--bg-surface-hover);
}

.merge-submit-btn {
  border: 1px solid var(--accent-emerald);
  background-color: var(--accent-emerald);
  color: #ffffff;
}

.merge-submit-btn.bypass {
  border-color: var(--accent-amber);
  background-color: var(--accent-amber);
  color: light-dark(#ffffff, #0b1017);
}

.merge-submit-btn[aria-disabled='true'],
.merge-cancel-btn:disabled {
  cursor: default;
  opacity: 0.65;
}
</style>
