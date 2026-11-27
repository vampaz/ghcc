import type { PrMissionInfo, PrView, SnapshotMission } from '@/types/pr';

const DEFAULT_BASE_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'trunk']);

const IGNORED_TICKET_PREFIXES = new Set([
  'AES',
  'API',
  'ASCII',
  'BASE',
  'CD',
  'CI',
  'CLI',
  'CORS',
  'CPU',
  'CSRF',
  'CSS',
  'DNS',
  'ECMA',
  'ES',
  'GH',
  'GPU',
  'HTML',
  'HTTP',
  'HTTPS',
  'IEEE',
  'ISO',
  'JSON',
  'JWT',
  'MD',
  'MIME',
  'NODE',
  'OIDC',
  'POSIX',
  'PR',
  'RAM',
  'RFC',
  'RSA',
  'SDK',
  'SHA',
  'SQL',
  'SSL',
  'TCP',
  'TLS',
  'UDP',
  'URI',
  'URL',
  'UTF',
  'XSS',
  'YAML',
]);

const TICKET_KEY_RE = /(?<![A-Za-z0-9])([A-Z]{2,8})-(\d{1,6})(?![A-Za-z0-9])/g;
const DEPENDS_ON_LABEL_RE = /^depends\s+on\s+(.+)$/i;

export function extractTicketKeys(title: string, headRefName: string): string[] {
  const found = new Set<string>();
  const scan = (input: string) => {
    for (const match of input.matchAll(TICKET_KEY_RE)) {
      const prefix = match[1]!;
      const digits = match[2]!;
      if (IGNORED_TICKET_PREFIXES.has(prefix)) {
        continue;
      }
      found.add(`${prefix}-${digits}`);
    }
  };
  scan(title);
  scan(headRefName);
  return Array.from(found).sort();
}

function isFrontendLike(pr: PrView): boolean {
  const hay =
    `${pr.repository} ${pr.title} ${pr.labels.map((l) => l.name).join(' ')}`.toLowerCase();
  return (
    /(?:^|[-_/\s])(frontend|web|ui|client|fe)(?:$|[-_/\s])/.test(hay) ||
    extractTicketKeys(pr.title, pr.headRefName).some((k) => k.startsWith('FE-'))
  );
}

function isBackendLike(pr: PrView): boolean {
  const hay =
    `${pr.repository} ${pr.title} ${pr.labels.map((l) => l.name).join(' ')}`.toLowerCase();
  return (
    /(?:^|[-_/\s])(backend|api|server|worker|be)(?:$|[-_/\s])/.test(hay) ||
    extractTicketKeys(pr.title, pr.headRefName).some((k) => k.startsWith('BE-'))
  );
}

function matchesDependencyTarget(candidate: PrView, self: PrView, rawTarget: string): boolean {
  if (candidate.key === self.key) {
    return false;
  }
  const target = rawTarget.trim().toLowerCase();
  if (!target) {
    return false;
  }
  if (target === 'fe' || target === 'frontend' || target === 'ui' || target === 'web') {
    return isFrontendLike(candidate) && candidate.repository !== self.repository;
  }
  if (target === 'be' || target === 'backend' || target === 'api' || target === 'server') {
    if (isBackendLike(candidate) && candidate.repository !== self.repository) {
      return true;
    }
    return !isFrontendLike(candidate) && candidate.repository !== self.repository;
  }
  return (
    candidate.repository.toLowerCase().includes(target) ||
    candidate.repo.toLowerCase().includes(target) ||
    candidate.labels.some((l) => l.name.toLowerCase() === target)
  );
}

function topologicalOrder(
  prs: PrView[],
  depsByKey: ReadonlyMap<string, ReadonlySet<string>>,
): PrView[] {
  const byKey = new Map(prs.map((pr) => [pr.key, pr]));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const pr of prs) {
    inDegree.set(pr.key, 0);
    outgoing.set(pr.key, []);
  }

  for (const pr of prs) {
    const deps = depsByKey.get(pr.key);
    if (!deps) {
      continue;
    }
    for (const depKey of deps) {
      if (!byKey.has(depKey) || depKey === pr.key) {
        continue;
      }
      outgoing.get(depKey)!.push(pr.key);
      inDegree.set(pr.key, (inDegree.get(pr.key) ?? 0) + 1);
    }
  }

  const compareTieBreak = (a: PrView, b: PrView): number => {
    const aReady = a.bucket === 'ready' ? 0 : 1;
    const bReady = b.bucket === 'ready' ? 0 : 1;
    if (aReady !== bReady) {
      return aReady - bReady;
    }
    return a.key.localeCompare(b.key);
  };

  const readyQueue = prs.filter((pr) => (inDegree.get(pr.key) ?? 0) === 0).sort(compareTieBreak);
  const ordered: PrView[] = [];
  const visited = new Set<string>();

  while (readyQueue.length > 0) {
    const next = readyQueue.shift()!;
    if (visited.has(next.key)) {
      continue;
    }
    visited.add(next.key);
    ordered.push(next);
    for (const childKey of outgoing.get(next.key) ?? []) {
      const nextDeg = (inDegree.get(childKey) ?? 1) - 1;
      inDegree.set(childKey, nextDeg);
      if (nextDeg === 0) {
        const child = byKey.get(childKey);
        if (child) {
          readyQueue.push(child);
          readyQueue.sort(compareTieBreak);
        }
      }
    }
  }

  // Fallback for any cycle nodes: append deterministically
  const remaining = prs.filter((pr) => !visited.has(pr.key)).sort(compareTieBreak);
  return [...ordered, ...remaining];
}

export function deriveMissions(pullRequests: readonly PrView[]): {
  pullRequests: PrView[];
  missions: SnapshotMission[];
} {
  if (pullRequests.length < 2) {
    return {
      pullRequests: pullRequests.map((pr) => {
        if (!pr.mission) {
          return pr;
        }
        const { mission: _removed, ...rest } = pr;
        return rest;
      }),
      missions: [],
    };
  }

  const indexByKey = new Map<string, number>();
  const ticketsByKey = new Map<string, string[]>();
  const headByRepoBranch = new Map<string, PrView>();

  pullRequests.forEach((pr, idx) => {
    indexByKey.set(pr.key, idx);
    ticketsByKey.set(pr.key, extractTicketKeys(pr.title, pr.headRefName));
    if (!DEFAULT_BASE_BRANCHES.has(pr.headRefName)) {
      const repoBranchKey = `${pr.repository}::${pr.headRefName}`;
      if (!headByRepoBranch.has(repoBranchKey)) {
        headByRepoBranch.set(repoBranchKey, pr);
      }
    }
  });

  // Union-Find over pullRequests indices
  const parent = pullRequests.map((_, i) => i);
  const find = (x: number): number => {
    let curr = x;
    while (parent[curr] !== curr) {
      parent[curr] = parent[parent[curr]!]!;
      curr = parent[curr]!;
    }
    return curr;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[rb] = ra;
    }
  };

  // Union PRs sharing any ticket key
  const ticketFirstIdx = new Map<string, number>();
  pullRequests.forEach((pr, idx) => {
    for (const ticket of ticketsByKey.get(pr.key) ?? []) {
      const prevIdx = ticketFirstIdx.get(ticket);
      if (prevIdx !== undefined) {
        union(prevIdx, idx);
      } else {
        ticketFirstIdx.set(ticket, idx);
      }
    }
  });

  // Detect same-repo stacked PRs and union them
  const stackParentByKey = new Map<string, string>();
  const stackChildrenByKey = new Map<string, string[]>();

  pullRequests.forEach((pr, idx) => {
    if (DEFAULT_BASE_BRANCHES.has(pr.baseRefName) || pr.baseRefName === pr.headRefName) {
      return;
    }
    const parentPr = headByRepoBranch.get(`${pr.repository}::${pr.baseRefName}`);
    if (!parentPr || parentPr.key === pr.key) {
      return;
    }
    const parentIdx = indexByKey.get(parentPr.key);
    if (parentIdx === undefined) {
      return;
    }
    stackParentByKey.set(pr.key, parentPr.key);
    const children = stackChildrenByKey.get(parentPr.key) ?? [];
    children.push(pr.key);
    stackChildrenByKey.set(parentPr.key, children);
    union(parentIdx, idx);
  });

  // Collect connected components of size >= 2
  const components = new Map<number, PrView[]>();
  pullRequests.forEach((pr, idx) => {
    const root = find(idx);
    const group = components.get(root);
    if (group) {
      group.push(pr);
    } else {
      components.set(root, [pr]);
    }
  });

  const missionByPrKey = new Map<string, PrMissionInfo>();
  const missions: SnapshotMission[] = [];

  for (const members of components.values()) {
    if (members.length < 2) {
      continue;
    }

    const ticketCount = new Map<string, number>();
    for (const pr of members) {
      for (const ticket of ticketsByKey.get(pr.key) ?? []) {
        ticketCount.set(ticket, (ticketCount.get(ticket) ?? 0) + 1);
      }
    }
    const sharedTickets = Array.from(ticketCount.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key]) => key);
    const allTickets = Array.from(ticketCount.keys()).sort();
    const displayTickets = sharedTickets.length > 0 ? sharedTickets : allTickets;

    // Dependency graph inside the mission (stack edges + "Depends on ..." label edges)
    const depsByKey = new Map<string, Set<string>>();
    const blockedByLabelNotes: string[] = [];

    for (const pr of members) {
      const deps = new Set<string>();
      const stackParent = stackParentByKey.get(pr.key);
      if (stackParent) {
        deps.add(stackParent);
      }
      for (const label of pr.labels) {
        const m = DEPENDS_ON_LABEL_RE.exec(label.name.trim());
        if (!m) {
          continue;
        }
        const targetText = m[1]!;
        for (const sibling of members) {
          if (matchesDependencyTarget(sibling, pr, targetText)) {
            deps.add(sibling.key);
            blockedByLabelNotes.push(`#${pr.number} waits on #${sibling.number} (${label.name})`);
          }
        }
      }
      depsByKey.set(pr.key, deps);
    }

    const ordered = topologicalOrder(members, depsByKey);
    const repositories = Array.from(new Set(ordered.map((pr) => pr.repository))).sort();
    const hasStack = ordered.some((pr) => stackParentByKey.has(pr.key));
    const hasCrossRepo = repositories.length > 1;
    const readyCount = ordered.filter((pr) => pr.bucket === 'ready').length;

    const label =
      displayTickets.length > 0
        ? displayTickets.slice(0, 2).join(' · ')
        : `Stack: ${ordered[0]!.headRefName}`;
    const id =
      displayTickets.length > 0 ? `ticket:${displayTickets[0]!}` : `stack:${ordered[0]!.key}`;

    const dependencyNotes = Array.from(new Set(blockedByLabelNotes)).slice(0, 4);

    missions.push({
      id,
      label,
      ticketKeys: displayTickets,
      prKeys: ordered.map((pr) => pr.key),
      repositories,
      readyCount,
      totalCount: ordered.length,
      hasStack,
      hasCrossRepo,
      dependencyNotes,
    });

    ordered.forEach((pr, idx) => {
      const stackParentKey = stackParentByKey.get(pr.key);
      const stackChildKeys = stackChildrenByKey.get(pr.key);
      const deps = Array.from(depsByKey.get(pr.key) ?? []).sort();
      missionByPrKey.set(pr.key, {
        id,
        label,
        ticketKeys: displayTickets,
        peerCount: ordered.length - 1,
        ...(stackParentKey ? { stackParentKey } : {}),
        ...(stackChildKeys && stackChildKeys.length > 0
          ? { stackChildKeys: [...stackChildKeys].sort() }
          : {}),
        ...(deps.length > 0 ? { blockedByKeys: deps } : {}),
        mergeOrder: idx + 1,
        mergeTotal: ordered.length,
      });
    });
  }

  missions.sort((a, b) => {
    if (b.totalCount !== a.totalCount) {
      return b.totalCount - a.totalCount;
    }
    return a.label.localeCompare(b.label);
  });

  const annotatedPulls = pullRequests.map((pr) => {
    const mission = missionByPrKey.get(pr.key);
    if (!mission) {
      if (!pr.mission) {
        return pr;
      }
      const { mission: _removed, ...rest } = pr;
      return rest;
    }
    return { ...pr, mission };
  });

  return {
    pullRequests: annotatedPulls,
    missions,
  };
}
