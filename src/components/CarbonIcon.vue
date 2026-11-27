<template>
  <svg
    class="carbon-icon"
    :width="size"
    :height="size"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <use :href="`/icons.svg#carbon-${name}`" />
  </svg>
</template>

<script setup lang="ts">
export type CarbonIconName =
  | 'arrow-right'
  | 'branch'
  | 'checkmark'
  | 'checkmark-filled'
  | 'chevron-down'
  | 'close'
  | 'fit-to-screen'
  | 'in-progress'
  | 'launch'
  | 'maximize'
  | 'moon'
  | 'pin'
  | 'pin-filled'
  | 'renew'
  | 'subtract'
  | 'sun'
  | 'tag'
  | 'terminal'
  | 'time'
  | 'warning-alt'
  | 'warning-filled'
  | 'zoom-in'
  | 'zoom-out';

interface Props {
  name: CarbonIconName;
  size?: number;
}

withDefaults(defineProps<Props>(), {
  size: 16,
});
</script>

<style scoped>
.carbon-icon {
  display: inline-block;
  flex: none;
  vertical-align: middle;
  pointer-events: none;
}
</style>
