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
  | 'in-progress'
  | 'launch'
  | 'moon'
  | 'renew'
  | 'subtract'
  | 'sun'
  | 'tag'
  | 'terminal'
  | 'warning-alt'
  | 'warning-filled';

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
