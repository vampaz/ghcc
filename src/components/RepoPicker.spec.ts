import { describe, expect, it } from 'vitest';
import RepoPicker from '@/components/RepoPicker.vue';
import {
  ALL_REPOS_SELECTION,
  NO_REPOS_SELECTION,
  type RepoSelection,
} from '@/composables/use-url-state';
import { mountWithDeps } from '@/test/mount-with-deps';
import type { PrView } from '@/types/pr';

function makePrView(overrides: Partial<PrView> = {}): PrView {
  return {
    key: 'acme/core-api#101',
    owner: 'acme',
    repo: 'core-api',
    repository: 'acme/core-api',
    number: 101,
    title: 'fix: stabilize retry loop',
    url: 'https://github.com/acme/core-api/pull/101',
    author: 'vampaz',
    baseRefName: 'main',
    headRefName: 'fix/retry-loop',
    headRefOid: 'oid-101',
    isDraft: false,
    labels: [],
    sources: ['authored'],
    bucket: 'needs-me',
    myAction: 'fix-ci',
    blockers: ['ci-failing'],
    ci: {
      state: 'failing',
      passing: 2,
      failing: [{ name: 'unit-tests', url: 'https://github.com/acme/core-api/actions/1' }],
      pending: 0,
      hiddenCount: 0,
    },
    review: {
      decision: 'required',
      approvals: [],
      changesRequested: [],
      pending: ['ana'],
    },
    merge: {
      state: 'clean',
      source: 'fresh',
      checkedAt: '2026-11-24T12:00:00.000Z',
    },
    autoMerge: false,
    autoMergeMethod: null,
    mergeQueue: null,
    size: { additions: 120, deletions: 40, files: 4 },
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-24T11:00:00.000Z',
    lastCommittedAt: '2026-11-24T10:00:00.000Z',
    ageDays: 4,
    idleDays: 0,
    blockerSummary: 'CI 1 failing · waiting on @ana',
    ...overrides,
  };
}

function makePullRequests(): PrView[] {
  return [
    makePrView(),
    makePrView({
      key: 'acme/core-api#102',
      number: 102,
      bucket: 'waiting',
      myAction: 'ping',
      blockers: ['review-required'],
      ci: { state: 'passing', passing: 2, failing: [], pending: 0, hiddenCount: 0 },
    }),
    makePrView({
      key: 'acme/web-app#202',
      repo: 'web-app',
      repository: 'acme/web-app',
      number: 202,
      bucket: 'ready',
      myAction: 'merge',
      blockers: [],
      ci: { state: 'passing', passing: 3, failing: [], pending: 0, hiddenCount: 0 },
    }),
    makePrView({
      key: 'acme/docs#404',
      repo: 'docs',
      repository: 'acme/docs',
      number: 404,
      isDraft: true,
      bucket: 'draft',
      myAction: 'none',
      blockers: ['draft'],
      ci: { state: 'none', passing: 0, failing: [], pending: 0, hiddenCount: 0 },
    }),
  ];
}

function mountPicker(repoSelection: RepoSelection = ALL_REPOS_SELECTION) {
  return mountWithDeps(RepoPicker, {
    props: {
      pullRequests: makePullRequests(),
      repoSelection,
    },
  });
}

describe('RepoPicker', () => {
  it('summarizes the active repository selection on the trigger', async () => {
    const wrapper = mountPicker();
    const trigger = wrapper.find('.repo-picker-trigger');

    expect(trigger.text()).toBe('All repos');
    expect(trigger.attributes('aria-label')).toBe('Filter repositories (All repos)');

    await wrapper.setProps({ repoSelection: { mode: 'subset', repos: ['acme/core-api'] } });
    expect(trigger.text()).toBe('core-api');
    expect(trigger.attributes('title')).toBe('acme/core-api');

    await wrapper.setProps({
      repoSelection: { mode: 'subset', repos: ['acme/core-api', 'acme/web-app'] },
    });
    expect(trigger.text()).toBe('2 repos');

    await wrapper.setProps({ repoSelection: NO_REPOS_SELECTION });
    expect(trigger.text()).toBe('No repos');
    expect(trigger.classes()).toContain('active');

    wrapper.unmount();
  });

  it('opens a sorted repository list with draft notes and health states', async () => {
    const wrapper = mountPicker();
    await wrapper.find('.repo-picker-trigger').trigger('click');

    const rows = wrapper.findAll('.repo-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.find('.repo-name').text())).toEqual([
      'core-api',
      'web-app',
      'docs',
    ]);

    expect(rows[0]!.text()).toContain('2');
    expect(rows[0]!.find('.repo-health').attributes('data-health')).toBe('failing');
    expect(rows[1]!.find('.repo-health').attributes('data-health')).toBe('ok');
    expect(rows[2]!.classes()).toContain('drafts-only');
    expect(rows[2]!.text()).toContain('0');
    expect(rows[2]!.text()).toContain('+1d');
    expect(rows[2]!.find('.repo-health').attributes('data-health')).toBe('muted');
    expect(wrapper.find('.repo-all').text()).toContain('3/3');
    expect(wrapper.find<HTMLInputElement>('#toggle-all-repos').element.checked).toBe(true);

    await wrapper.find('.repo-picker-popover').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.repo-picker-trigger').attributes('aria-expanded')).toBe('false');

    wrapper.unmount();
  });

  it('emits toggleRepo with the repository and the full repository name list', async () => {
    const wrapper = mountPicker();
    await wrapper.find('.repo-picker-trigger').trigger('click');

    const webAppRow = wrapper.findAll('.repo-row').find((row) => row.text().includes('web-app'))!;
    await webAppRow.find<HTMLInputElement>('input[type="checkbox"]').setValue(false);

    expect(wrapper.emitted('toggleRepo')).toEqual([
      ['acme/web-app', ['acme/core-api', 'acme/web-app', 'acme/docs']],
    ]);

    wrapper.unmount();
  });

  it('emits toggleAll from the select-all checkbox', async () => {
    const wrapper = mountPicker();
    await wrapper.find('.repo-picker-trigger').trigger('click');

    await wrapper.find<HTMLInputElement>('#toggle-all-repos').setValue(false);

    expect(wrapper.emitted('toggleAll')).toEqual([
      [['acme/core-api', 'acme/web-app', 'acme/docs']],
    ]);

    wrapper.unmount();
  });

  it('includes draft pull requests in counts when includeDrafts is set', async () => {
    const wrapper = mountPicker();
    await wrapper.find('.repo-picker-trigger').trigger('click');

    const docsRow = () => wrapper.findAll('.repo-row').find((row) => row.text().includes('docs'))!;
    expect(docsRow().text()).toContain('0');
    expect(docsRow().text()).toContain('+1d');

    await wrapper.setProps({ includeDrafts: true });

    expect(docsRow().text()).toContain('1');
    expect(docsRow().text()).not.toContain('+1d');

    wrapper.unmount();
  });

  it('shows every repository unchecked and renders an empty state when no repos exist', async () => {
    const noneWrapper = mountPicker(NO_REPOS_SELECTION);
    await noneWrapper.find('.repo-picker-trigger').trigger('click');

    expect(
      noneWrapper
        .findAll<HTMLInputElement>('input[type="checkbox"]')
        .every((input) => !input.element.checked),
    ).toBe(true);
    expect(noneWrapper.find('.repo-all').text()).toContain('0/3');
    noneWrapper.unmount();

    const emptyWrapper = mountWithDeps(RepoPicker, {
      props: { pullRequests: [], repoSelection: ALL_REPOS_SELECTION },
    });
    await emptyWrapper.find('.repo-picker-trigger').trigger('click');

    expect(emptyWrapper.find('.repo-picker-trigger').text()).toBe('All repos');
    expect(emptyWrapper.text()).toContain('No open repositories.');
    expect(emptyWrapper.find('#toggle-all-repos').exists()).toBe(false);

    emptyWrapper.unmount();
  });
});
