import {
  ALL_REPOS_SELECTION,
  NO_REPOS_SELECTION,
  type DashboardFilters,
} from '@/composables/use-url-state';
import type { SavedFilterPreset } from '@/types/pr';

export interface BuiltInPreset {
  id: string;
  name: string;
  description: string;
  filters: SavedFilterPreset['filters'];
}

export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  {
    id: 'builtin:morning-triage',
    name: 'Morning Triage',
    description: 'Needs You PRs, excluding drafts and snoozed',
    filters: {
      view: 'all',
      bucket: 'needs-me',
      q: '',
      repos: 'all',
      drafts: false,
      snoozed: false,
      staleOnly: false,
    },
  },
  {
    id: 'builtin:failing-ci',
    name: 'Failing CI',
    description: 'Open PRs with failing checks',
    filters: {
      view: 'all',
      bucket: 'ci-failing',
      q: '',
      repos: 'all',
      drafts: false,
      snoozed: false,
      staleOnly: false,
    },
  },
  {
    id: 'builtin:stale',
    name: 'Stale > 3d',
    description: 'Open PRs idle for more than 3 days',
    filters: {
      view: 'all',
      bucket: '',
      q: '',
      repos: 'all',
      drafts: false,
      snoozed: false,
      staleOnly: true,
    },
  },
  {
    id: 'builtin:ready-to-merge',
    name: 'Ready to Merge',
    description: 'Approved and mergeable PRs',
    filters: {
      view: 'all',
      bucket: 'ready',
      q: '',
      repos: 'all',
      drafts: false,
      snoozed: false,
      staleOnly: false,
    },
  },
];

export function dashboardFiltersToPresetFilters(
  filters: DashboardFilters,
): SavedFilterPreset['filters'] {
  const repos: 'all' | 'none' | string[] =
    filters.repoSelection.mode === 'all'
      ? 'all'
      : filters.repoSelection.mode === 'none'
        ? 'none'
        : [...filters.repoSelection.repos];
  return {
    view: filters.view,
    bucket: filters.bucket,
    q: filters.q,
    repos,
    drafts: filters.drafts,
    snoozed: filters.snoozed,
    staleOnly: filters.staleOnly,
  };
}

export function presetFiltersToDashboardFilters(
  filters: SavedFilterPreset['filters'],
): DashboardFilters {
  const repoSelection =
    filters.repos === 'all'
      ? ALL_REPOS_SELECTION
      : filters.repos === 'none'
        ? NO_REPOS_SELECTION
        : filters.repos.length > 0
          ? { mode: 'subset' as const, repos: [...filters.repos] }
          : ALL_REPOS_SELECTION;
  return {
    view: filters.view,
    bucket: filters.bucket,
    q: filters.q,
    repoSelection,
    drafts: filters.drafts,
    snoozed: filters.snoozed,
    staleOnly: filters.staleOnly,
  };
}
