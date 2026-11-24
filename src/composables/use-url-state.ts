import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { Bucket } from '@/types/pr';

export type ViewFilter = 'all' | 'mine' | 'review';
export type BucketFilter = Bucket | 'ci-failing' | '';

export interface DashboardFilters {
  view: ViewFilter;
  bucket: BucketFilter;
  q: string;
  repo: string;
  drafts: boolean;
}

const VALID_VIEWS = new Set<ViewFilter>(['all', 'mine', 'review']);
const VALID_BUCKETS = new Set<BucketFilter>([
  '',
  'needs-me',
  'ready',
  'waiting',
  'draft',
  'ci-failing',
]);

export function parseFiltersFromSearch(search: string): DashboardFilters {
  const params = new URLSearchParams(search);
  const rawView = (params.get('view') ?? 'all') as ViewFilter;
  const rawBucket = (params.get('bucket') ?? '') as BucketFilter;
  return {
    view: VALID_VIEWS.has(rawView) ? rawView : 'all',
    bucket: VALID_BUCKETS.has(rawBucket) ? rawBucket : '',
    q: params.get('q') ?? '',
    repo: params.get('repo') ?? '',
    drafts: params.get('drafts') === '1',
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
  if (filters.repo) {
    params.set('repo', filters.repo);
  }
  if (filters.drafts) {
    params.set('drafts', '1');
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}

export function useUrlState() {
  const view = ref<ViewFilter>('all');
  const bucket = ref<BucketFilter>('');
  const q = ref<string>('');
  const repo = ref<string>('');
  const drafts = ref<boolean>(false);
  const hydrated = ref<boolean>(false);

  function applyFromLocation(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const parsed = parseFiltersFromSearch(window.location.search);
    view.value = parsed.view;
    bucket.value = parsed.bucket;
    q.value = parsed.q;
    repo.value = parsed.repo;
    drafts.value = parsed.drafts;
  }

  function resetFilters(): void {
    view.value = 'all';
    bucket.value = '';
    q.value = '';
    repo.value = '';
    drafts.value = false;
  }

  watch([view, bucket, q, repo, drafts], () => {
    if (typeof window === 'undefined' || !hydrated.value) {
      return;
    }
    const nextSearch = serializeFiltersToSearch({
      view: view.value,
      bucket: bucket.value,
      q: q.value,
      repo: repo.value,
      drafts: drafts.value,
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
    repo,
    drafts,
    resetFilters,
  };
}
