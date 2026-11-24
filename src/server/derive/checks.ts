import type { RawStatusCheckContext, RawStatusCheckRollup } from '@/server/derive/types';
import type { CiFailingCheck, PrCiInfo } from '@/types/pr';

export const CONTEXT_CAP = 30;

export type NormalizedContextOutcome = 'passing' | 'failing' | 'pending';

const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'CANCELLED',
]);

export function classifyStatusContext(
  node: RawStatusCheckContext,
  fallbackUrl: string,
): { outcome: NormalizedContextOutcome; name: string; url: string } {
  if (node.__typename === 'CheckRun') {
    const url = node.detailsUrl ?? fallbackUrl;
    if (node.status !== 'COMPLETED') {
      return { outcome: 'pending', name: node.name, url };
    }
    if (node.conclusion && FAILING_CONCLUSIONS.has(node.conclusion)) {
      return { outcome: 'failing', name: node.name, url };
    }
    return { outcome: 'passing', name: node.name, url };
  }

  const url = node.targetUrl ?? fallbackUrl;
  if (node.state === 'SUCCESS') {
    return { outcome: 'passing', name: node.context, url };
  }
  if (node.state === 'FAILURE' || node.state === 'ERROR') {
    return { outcome: 'failing', name: node.context, url };
  }
  return { outcome: 'pending', name: node.context, url };
}

export function deriveCiInfo(rollup: RawStatusCheckRollup | null, fallbackUrl: string): PrCiInfo {
  if (!rollup) {
    return {
      state: 'none',
      passing: 0,
      failing: [],
      pending: 0,
      hiddenCount: 0,
    };
  }

  const rawNodes = rollup.contexts.nodes.filter((n): n is RawStatusCheckContext => n !== null);
  const visibleNodes = rawNodes.slice(0, CONTEXT_CAP);
  const totalCount = Math.max(rollup.contexts.totalCount, rawNodes.length);
  const hiddenCount = Math.max(0, totalCount - visibleNodes.length);

  if (totalCount === 0 && visibleNodes.length === 0) {
    return {
      state: 'none',
      passing: 0,
      failing: [],
      pending: 0,
      hiddenCount: 0,
    };
  }

  let passing = 0;
  let pending = 0;
  const failing: CiFailingCheck[] = [];

  for (const node of visibleNodes) {
    const classified = classifyStatusContext(node, fallbackUrl);
    if (classified.outcome === 'passing') {
      passing++;
    } else if (classified.outcome === 'failing') {
      failing.push({ name: classified.name, url: classified.url });
    } else {
      pending++;
    }
  }

  // statusCheckRollup.state is authoritative when contexts past the 30-item cap fail/pend.
  const rollupState = rollup.state.toUpperCase();
  let state: PrCiInfo['state'];
  if (failing.length > 0 || rollupState === 'FAILURE' || rollupState === 'ERROR') {
    state = 'failing';
  } else if (pending > 0 || rollupState === 'PENDING' || rollupState === 'EXPECTED') {
    state = 'pending';
  } else if (passing > 0 || rollupState === 'SUCCESS') {
    state = 'passing';
  } else {
    state = 'none';
  }

  return {
    state,
    passing,
    failing,
    pending,
    hiddenCount,
  };
}
