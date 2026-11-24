import { describe, expect, it } from 'vitest';
import { classifyStatusContext, deriveCiInfo } from '@/server/derive/checks';
import {
  fixtureNoCiRollup,
  fixtureTruncatedFailingCi,
} from '@/server/derive/__fixtures__/pull-requests';
import type { RawStatusCheckContext } from '@/server/derive/types';

describe('derive/checks', () => {
  it.each<{
    label: string;
    node: RawStatusCheckContext;
    expected: 'passing' | 'failing' | 'pending';
  }>([
    {
      label: 'CheckRun IN_PROGRESS -> pending',
      node: {
        __typename: 'CheckRun',
        name: 'build',
        status: 'IN_PROGRESS',
        conclusion: null,
        detailsUrl: null,
        startedAt: null,
        completedAt: null,
      },
      expected: 'pending',
    },
    {
      label: 'CheckRun QUEUED -> pending',
      node: {
        __typename: 'CheckRun',
        name: 'lint',
        status: 'QUEUED',
        conclusion: null,
        detailsUrl: null,
        startedAt: null,
        completedAt: null,
      },
      expected: 'pending',
    },
    ...(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'CANCELLED'] as const).map(
      (conclusion) => ({
        label: `CheckRun COMPLETED/${conclusion} -> failing`,
        node: {
          __typename: 'CheckRun' as const,
          name: `job-${conclusion}`,
          status: 'COMPLETED',
          conclusion,
          detailsUrl: 'https://example.com/job',
          startedAt: null,
          completedAt: null,
        },
        expected: 'failing' as const,
      }),
    ),
    ...(['SUCCESS', 'NEUTRAL', 'SKIPPED', 'STALE'] as const).map((conclusion) => ({
      label: `CheckRun COMPLETED/${conclusion} -> passing`,
      node: {
        __typename: 'CheckRun' as const,
        name: `job-${conclusion}`,
        status: 'COMPLETED',
        conclusion,
        detailsUrl: 'https://example.com/job',
        startedAt: null,
        completedAt: null,
      },
      expected: 'passing' as const,
    })),
    {
      label: 'StatusContext SUCCESS -> passing',
      node: {
        __typename: 'StatusContext',
        context: 'ci/circle',
        state: 'SUCCESS',
        targetUrl: null,
        description: null,
      },
      expected: 'passing',
    },
    {
      label: 'StatusContext FAILURE -> failing',
      node: {
        __typename: 'StatusContext',
        context: 'ci/circle',
        state: 'FAILURE',
        targetUrl: 'https://circle.example/1',
        description: 'failed',
      },
      expected: 'failing',
    },
    {
      label: 'StatusContext ERROR -> failing',
      node: {
        __typename: 'StatusContext',
        context: 'ci/circle',
        state: 'ERROR',
        targetUrl: null,
        description: null,
      },
      expected: 'failing',
    },
    {
      label: 'StatusContext PENDING -> pending',
      node: {
        __typename: 'StatusContext',
        context: 'ci/circle',
        state: 'PENDING',
        targetUrl: null,
        description: null,
      },
      expected: 'pending',
    },
  ])('maps $label', ({ node, expected }) => {
    expect(classifyStatusContext(node, 'https://github.com/acme/repo/pull/1').outcome).toBe(
      expected,
    );
  });

  it('handles null statusCheckRollup as state=none', () => {
    const rollup = fixtureNoCiRollup.commits.nodes[0]!.commit.statusCheckRollup;
    expect(deriveCiInfo(rollup, fixtureNoCiRollup.url)).toEqual({
      state: 'none',
      passing: 0,
      failing: [],
      pending: 0,
      hiddenCount: 0,
    });
  });

  it('keeps state=failing when rollup is FAILURE beyond the 30-context cap', () => {
    const rollup = fixtureTruncatedFailingCi.commits.nodes[0]!.commit.statusCheckRollup;
    const ci = deriveCiInfo(rollup, fixtureTruncatedFailingCi.url);
    expect(ci.state).toBe('failing');
    expect(ci.passing).toBe(30);
    expect(ci.failing).toEqual([]);
    expect(ci.hiddenCount).toBe(5);
  });
});
