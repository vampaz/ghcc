import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { Bucket } from '@/types/pr';

export type ViewFilter = 'all' | 'mine' | 'review' | 'team';
export type BucketFilter = Bucket | 'ci-failing' | '';

export type RepoSelection =
  | { mode: 'all' }
  | { mode: 'none' }
  | { mode: 'subset'; repos: string[] };

export const ALL_REPOS_SELECTION: RepoSelection = { mode: 'all' };
export const NO_REPOS_SELECTION: RepoSelection = { mode: 'none' };

export interface DashboardFilters {
  view: ViewFilter;
  bucket: BucketFilter;
  q: string;
  repoSelection: RepoSelection;
  drafts: boolean;
  snoozed: boolean;
  staleOnly: boolean;
  groupByMission?: boolean;
}

const VALID_VIEWS = new Set<ViewFilter>(['all', 'mine', 'review', 'team']);
const VALID_BUCKETS = new Set<BucketFilter>([
  '',
  'needs-me',
  'ready',
  'waiting',
  'draft',
  'ci-failing',
]);

export function toggleRepoInSelection(
  current: RepoSelection,
  repoName: string,
  allRepoNames: readonly string[],
): RepoSelection {
  const uniqueAll = Array.from(new Set(allRepoNames));
  if (uniqueAll.length === 0) {
    return ALL_REPOS_SELECTION;
  }

  let selected: Set<string>;
  if (current.mode === 'all') {
    selected = new Set(uniqueAll);
  } else if (current.mode === 'none') {
    selected = new Set<string>();
  } else {
    selected = new Set(current.repos);
  }

  if (selected.has(repoName)) {
    selected.delete(repoName);
  } else {
    selected.add(repoName);
  }

  if (selected.size === 0) {
    return NO_REPOS_SELECTION;
  }
  if (uniqueAll.every((name) => selected.has(name))) {
    return ALL_REPOS_SELECTION;
  }
  return { mode: 'subset', repos: Array.from(selected).sort() };
}

export function toggleAllReposSelection(
  current: RepoSelection,
  allRepoNames: readonly string[],
): RepoSelection {
  const allChecked =
    current.mode === 'all' ||
    (current.mode === 'subset' &&
      allRepoNames.length > 0 &&
      allRepoNames.every((name) => current.repos.includes(name)));
  return allChecked ? NO_REPOS_SELECTION : ALL_REPOS_SELECTION;
}

export function parseRepoSelectionFromParams(params: URLSearchParams): RepoSelection {
  const rawRepos = params.get('repos');
  if (rawRepos !== null) {
    const trimmed = rawRepos.trim();
    if (trimmed === 'none') {
      return NO_REPOS_SELECTION;
    }
    const list = Array.from(
      new Set(
        trimmed
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).sort();
    return list.length > 0 ? { mode: 'subset', repos: list } : ALL_REPOS_SELECTION;
  }

  const legacyRepo = params.get('repo')?.trim();
  if (legacyRepo) {
    return { mode: 'subset', repos: [legacyRepo] };
  }

  return ALL_REPOS_SELECTION;
}

export function parseFiltersFromSearch(search: string): DashboardFilters {
  const params = new URLSearchParams(search);
  const rawView = (params.get('view') ?? 'all') as ViewFilter;
  const rawBucket = (params.get('bucket') ?? '') as BucketFilter;
  return {
    view: VALID_VIEWS.has(rawView) ? rawView : 'all',
    bucket: VALID_BUCKETS.has(rawBucket) ? rawBucket : '',
    q: params.get('q') ?? '',
    repoSelection: parseRepoSelectionFromParams(params),
    drafts: params.get('drafts') === '1',
    snoozed: params.get('snoozed') === '1',
    staleOnly: params.get('stale') === '1',
    groupByMission: params.get('group') === 'missions',
  };
}

export function serializeFiltersToSearch(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.view !== 'all') {
    params.set('view', filters.view);
  }
  if (filters.bucket) {
    params.set('bucket', filters.bucket);
  }
  if (filters.q.trim()) {
    params.set('q', filters.q);
  }
  if (filters.repoSelection.mode === 'none') {
    params.set('repos', 'none');
  } else if (filters.repoSelection.mode === 'subset' && filters.repoSelection.repos.length > 0) {
    params.set('repos', [...filters.repoSelection.repos].sort().join(','));
  }
  if (filters.drafts) {
    params.set('drafts', '1');
  }
  if (filters.snoozed) {
    params.set('snoozed', '1');
  }
  if (filters.staleOnly) {
    params.set('stale', '1');
  }
  if (filters.groupByMission) {
    params.set('group', 'missions');
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

export function useUrlState() {
  const view = ref<ViewFilter>('all');
  const bucket = ref<BucketFilter>('');
  const q = ref<string>('');
  const repoSelection = ref<RepoSelection>(ALL_REPOS_SELECTION);
  const drafts = ref<boolean>(false);
  const snoozed = ref<boolean>(false);
  const staleOnly = ref<boolean>(false);
  const groupByMission = ref<boolean>(false);
  const hydrated = ref<boolean>(false);

  function applyFilters(next: DashboardFilters): void {
    view.value = next.view;
    bucket.value = next.bucket;
    q.value = next.q;
    repoSelection.value = next.repoSelection;
    drafts.value = next.drafts;
    snoozed.value = next.snoozed;
    staleOnly.value = next.staleOnly;
    groupByMission.value = Boolean(next.groupByMission);
  }

  function applyFromLocation(): void {
    if (typeof window === 'undefined') {
      return;
    }
    applyFilters(parseFiltersFromSearch(window.location.search));
  }

  function resetFilters(): void {
    view.value = 'all';
    bucket.value = '';
    q.value = '';
    repoSelection.value = ALL_REPOS_SELECTION;
    drafts.value = false;
    snoozed.value = false;
    staleOnly.value = false;
    groupByMission.value = false;
  }

  watch([view, bucket, q, repoSelection, drafts, snoozed, staleOnly, groupByMission], () => {
    if (typeof window === 'undefined' || !hydrated.value) {
      return;
    }
    const nextSearch = serializeFiltersToSearch({
      view: view.value,
      bucket: bucket.value,
      q: q.value,
      repoSelection: repoSelection.value,
      drafts: drafts.value,
      snoozed: snoozed.value,
      staleOnly: staleOnly.value,
      groupByMission: groupByMission.value,
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  });

  onMounted(() => {
    applyFromLocation();
    hydrated.value = true;
    window.addEventListener('popstate', applyFromLocation);
  });

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', applyFromLocation);
    }
  });

  return {
    view,
    bucket,
    q,
    repoSelection,
    drafts,
    snoozed,
    staleOnly,
    groupByMission,
    applyFilters,
    resetFilters,
  };
}
