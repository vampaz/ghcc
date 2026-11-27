import { describe, expect, it } from 'vitest';
import ReadyPanel from '@/components/ReadyPanel.vue';
import { mountWithDeps } from '@/test/mount-with-deps';
import type { PrView } from '@/types/pr';

function makeReadyPr(overrides: Partial<PrView> = {}): PrView {
  return {
    key: 'acme/web-app#202',
    owner: 'acme',
    repo: 'web-app',
    repository: 'acme/web-app',
    number: 202,
    title: 'feat: dark theme tokens',
    url: 'https://github.com/acme/web-app/pull/202',
    author: 'vampaz',
    baseRefName: 'main',
    headRefName: 'feat/theme',
    headRefOid: '2222222222222222222222222222222222222222',
    isDraft: false,
    labels: [{ name: 'Merge-Ready', color: '0e8a16', description: 'Ready to merge' }],
    sources: ['authored'],
    bucket: 'ready',
    myAction: 'merge',
    blockers: [],
    ci: { state: 'passing', passing: 5, failing: [], pending: 0, hiddenCount: 0 },
    review: { decision: 'approved', approvals: ['ana'], changesRequested: [], pending: [] },
    merge: { state: 'clean', source: 'fresh' },
    autoMerge: false,
    autoMergeMethod: null,
    mergeQueue: null,
    size: { additions: 30, deletions: 4, files: 2 },
    createdAt: '2026-11-23T09:00:00.000Z',
    updatedAt: '2026-11-24T11:00:00.000Z',
    lastCommittedAt: '2026-11-24T10:30:00.000Z',
    ageDays: 1,
    idleDays: 0,
    blockerSummary: 'CI passing ✓ · mergeable · Approved ✓',
    ...overrides,
  };
}

describe('ReadyPanel', () => {
  it('renders an empty message when no pull requests are ready', () => {
    const wrapper = mountWithDeps(ReadyPanel, {
      props: {
        pullRequests: [],
        selectedKey: null,
        nowMs: Date.parse('2026-11-24T12:00:00.000Z'),
      },
    });

    expect(wrapper.find('#ready-heading').text()).toBe('Ready to Merge');
    expect(wrapper.find('.rail-count').text()).toBe('0');
    expect(wrapper.find('.rail-empty').text()).toContain('No pull requests ready to merge');
    wrapper.unmount();
  });

  it('renders authored and teammate ready PRs, emits select and request-merge, and surfaces merge errors', async () => {
    const authored = makeReadyPr();
    const teammate = makeReadyPr({
      key: 'acme/api#555',
      repo: 'api',
      repository: 'acme/api',
      number: 555,
      title: 'fix: connection pool drain',
      author: 'leo',
      sources: ['repo'],
      bucket: 'waiting',
      myAction: 'none',
    });

    const wrapper = mountWithDeps(ReadyPanel, {
      props: {
        pullRequests: [authored, teammate],
        selectedKey: authored.key,
        nowMs: Date.parse('2026-11-24T12:00:00.000Z'),
        mergeStates: {
          'acme/api#555': {
            status: 'error',
            mergeMethod: 'squash',
            error: 'Branch hook rejected merge',
          },
        },
      },
    });

    const items = wrapper.findAll('.ready-item');
    expect(items).toHaveLength(2);
    expect(wrapper.find('.rail-count').text()).toBe('2');
    expect(wrapper.find('.rail-count').classes()).toContain('active');

    expect(items[0]!.find('.ready-row').classes()).toContain('selected');
    expect(items[0]!.find('.ready-status').text()).toBe('ready');
    expect(items[0]!.find('.ready-labels .pr-label-pill').text()).toBe('Merge-Ready');

    expect(items[1]!.find('.ready-author').text()).toBe('@leo');
    expect(items[1]!.find('.merge-split').classes()).toContain('ready');
    expect(items[1]!.find('.ready-error').text()).toBe('Branch hook rejected merge');

    await items[1]!.find('.ready-btn').trigger('click');
    expect(wrapper.emitted('select')).toEqual([[teammate]]);

    await items[0]!.find('button[aria-label="Squash — acme/web-app#202"]').trigger('click');
    expect(wrapper.emitted('request-merge')).toEqual([[authored, 'squash']]);

    wrapper.unmount();
  });
});
