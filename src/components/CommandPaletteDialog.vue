<template>
  <dialog
    ref="dialogRef"
    class="command-palette-dialog"
    aria-label="Command palette"
    @close="onDialogClose"
    @click="onBackdropClick"
  >
    <div class="palette-shell" @keydown="onPaletteKeydown">
      <div class="palette-input-row">
        <CarbonIcon name="terminal" :size="15" class="palette-icon" />
        <label :for="inputId" class="visually-hidden">Type a command or search pull requests</label>
        <input
          :id="inputId"
          ref="inputRef"
          v-model="query"
          type="search"
          class="palette-input"
          placeholder="Type a command, preset, or PR number..."
          autocomplete="off"
        />
        <kbd class="palette-esc-kbd">Esc</kbd>
      </div>

      <div
        ref="resultsRef"
        class="palette-results app-scroll"
        role="listbox"
        aria-label="Matching commands"
      >
        <p v-if="rankedCommands.length === 0" class="palette-empty">
          No matching commands or pull requests.
        </p>

        <template v-else>
          <div v-for="group in groupedCommands" :key="group.category" class="palette-group">
            <div class="palette-group-title">{{ group.category }}</div>
            <button
              v-for="entry in group.items"
              :key="entry.cmd.id"
              type="button"
              role="option"
              class="palette-option"
              :class="{ active: entry.flatIndex === activeIndex }"
              :aria-selected="entry.flatIndex === activeIndex ? 'true' : 'false'"
              @mouseenter="activeIndex = entry.flatIndex"
              @click="executeCommand(entry.cmd)"
            >
              <span class="palette-option-copy">
                <span class="palette-option-title">{{ entry.cmd.title }}</span>
                <span v-if="entry.cmd.subtitle" class="palette-option-sub">
                  {{ entry.cmd.subtitle }}
                </span>
              </span>
              <kbd v-if="entry.cmd.shortcut" class="palette-shortcut">{{ entry.cmd.shortcut }}</kbd>
            </button>
          </div>
        </template>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import CarbonIcon from '@/components/CarbonIcon.vue';
import {
  filterAndRankCommands,
  type CommandCategory,
  type PaletteCommand,
} from '@/utils/command-palette';

interface Props {
  open: boolean;
  commands: PaletteCommand[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
}>();

const inputId = `command-palette-input-${useId()}`;
const dialogRef = ref<HTMLDialogElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);
const resultsRef = ref<HTMLElement | null>(null);
const query = ref<string>('');
const activeIndex = ref<number>(0);

const rankedCommands = computed<PaletteCommand[]>(() =>
  filterAndRankCommands(props.commands, query.value),
);

const groupedCommands = computed<
  Array<{ category: CommandCategory; items: Array<{ cmd: PaletteCommand; flatIndex: number }> }>
>(() => {
  const groups = new Map<CommandCategory, Array<{ cmd: PaletteCommand; flatIndex: number }>>();
  rankedCommands.value.forEach((cmd, flatIndex) => {
    const existing = groups.get(cmd.category);
    if (existing) {
      existing.push({ cmd, flatIndex });
    } else {
      groups.set(cmd.category, [{ cmd, flatIndex }]);
    }
  });
  return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
});

watch(activeIndex, () => {
  void nextTick(() => {
    const activeEl = resultsRef.value?.querySelector<HTMLElement>('.palette-option.active');
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  });
});

watch(query, () => {
  activeIndex.value = 0;
});

watch(rankedCommands, (next) => {
  if (activeIndex.value >= next.length) {
    activeIndex.value = Math.max(0, next.length - 1);
  }
});

watch(
  () => props.open,
  (isOpen) => {
    const dialog = dialogRef.value;
    if (!dialog) {
      return;
    }
    if (isOpen) {
      query.value = '';
      activeIndex.value = 0;
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
      }
      void nextTick(() => {
        inputRef.value?.focus();
      });
    } else if (dialog.open || dialog.hasAttribute('open')) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
  },
  { immediate: true },
);

function onDialogClose(): void {
  if (props.open) {
    emit('close');
  }
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === dialogRef.value) {
    emit('close');
  }
}

function executeCommand(cmd: PaletteCommand): void {
  emit('close');
  cmd.run();
}

function onPaletteKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  const total = rankedCommands.value.length;
  if (total === 0) {
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % total;
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + total) % total;
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const chosen = rankedCommands.value[activeIndex.value];
    if (chosen) {
      executeCommand(chosen);
    }
  }
}
</script>

<style scoped>
.command-palette-dialog {
  inline-size: min(36rem, calc(100vw - 1.5rem));
  max-inline-size: none;
  margin-block-start: min(12vh, 5.5rem);
  margin-inline: auto;
  padding: 0;
  border-radius: 0.65rem;
  border: 1px solid var(--border-strong);
  background-color: var(--bg-surface);
  color: var(--ink-primary);
  box-shadow: 0 22px 54px rgb(0 0 0 / 0.45);
  overflow: hidden;
}

.command-palette-dialog::backdrop {
  background-color: rgb(6 10 16 / 0.58);
}

.palette-shell {
  display: flex;
  flex-direction: column;
  max-block-size: min(72dvh, 32rem);
}

.palette-input-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.7rem 0.9rem;
  border-bottom: 1px solid var(--border-subtle);
}

.palette-icon {
  color: var(--accent-blue);
  flex: 0 0 auto;
}

.palette-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink-primary);
  font-size: 0.9rem;
  outline: none;
}

.palette-esc-kbd,
.palette-shortcut {
  padding: 0.08rem 0.38rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border-subtle);
  background-color: var(--bg-surface-muted);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  flex: 0 0 auto;
}

.palette-results {
  overflow-y: auto;
  padding: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.palette-empty {
  margin: 0;
  padding: 1.5rem 0.75rem;
  text-align: center;
  font-size: 0.82rem;
  color: var(--ink-muted);
}

.palette-group {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.palette-group-title {
  padding: 0.2rem 0.5rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-muted);
}

.palette-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 0;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--ink-primary);
  text-align: left;
  cursor: pointer;
}

.palette-option.active {
  background-color: var(--accent-blue-bg);
  color: var(--accent-blue);
}

.palette-option-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.08rem;
}

.palette-option-title {
  font-size: 0.82rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-option-sub {
  font-size: 0.72rem;
  color: var(--ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
