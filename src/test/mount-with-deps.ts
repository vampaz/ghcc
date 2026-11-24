import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import type { Component } from 'vue';

export function mountWithDeps<T extends Component>(
  component: T,
  options: ComponentMountingOptions<T> = {},
) {
  return mount(component, {
    ...options,
    global: {
      ...options.global,
    },
  });
}
