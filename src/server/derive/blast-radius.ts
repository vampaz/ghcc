import type { PrFileOverlap, PrView } from '@/types/pr';

export const MAX_OVERLAPS_PER_PR = 5;
export const MAX_SHARED_PATHS_PER_OVERLAP = 5;

const LOCKFILE_RE =
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/;

function sortPathsSourceFirst(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const aLock = LOCKFILE_RE.test(a) ? 1 : 0;
    const bLock = LOCKFILE_RE.test(b) ? 1 : 0;
    if (aLock !== bLock) {
      return aLock - bLock;
    }
    return a.localeCompare(b);
  });
}

function isStackedPair(a: PrView, b: PrView): boolean {
  return (
    a.mission?.stackParentKey === b.key ||
    b.mission?.stackParentKey === a.key ||
    (a.mission?.stackChildKeys?.includes(b.key) ?? false) ||
    (b.mission?.stackChildKeys?.includes(a.key) ?? false)
  );
}

/**
 * Compares changed file paths across open PRs in the same repository to detect
 * potential merge conflict blast-radius overlaps.
 *
 * Stacked parent/child PR pairs are excluded to avoid false-positive noise.
 */
export function annotateFileOverlaps(
  pullRequests: readonly PrView[],
  filesByKey: ReadonlyMap<string, readonly string[]>,
): PrView[] {
  if (pullRequests.length < 2 || filesByKey.size < 2) {
    return pullRequests.map((pr) => {
      if (!pr.overlaps) {
        return pr;
      }
      const { overlaps: _removed, ...rest } = pr;
      return rest;
    });
  }

  // Group PRs by repository
  const byRepo = new Map<string, PrView[]>();
  for (const pr of pullRequests) {
    const files = filesByKey.get(pr.key);
    if (!files || files.length === 0) {
      continue;
    }
    const list = byRepo.get(pr.repository);
    if (list) {
      list.push(pr);
    } else {
      byRepo.set(pr.repository, [pr]);
    }
  }

  const overlapsByKey = new Map<string, PrFileOverlap[]>();

  for (const repoPrs of byRepo.values()) {
    if (repoPrs.length < 2) {
      continue;
    }

    // Build inverted index: file path -> PRs touching it
    const prsByPath = new Map<string, PrView[]>();
    for (const pr of repoPrs) {
      for (const path of filesByKey.get(pr.key) ?? []) {
        const list = prsByPath.get(path);
        if (list) {
          list.push(pr);
        } else {
          prsByPath.set(path, [pr]);
        }
      }
    }

    // Accumulate pairwise shared file lists
    const pairPaths = new Map<string, Map<string, string[]>>();
    for (const [path, touchingPrs] of prsByPath) {
      if (touchingPrs.length < 2) {
        continue;
      }
      for (let i = 0; i < touchingPrs.length; i++) {
        const a = touchingPrs[i]!;
        for (let j = i + 1; j < touchingPrs.length; j++) {
          const b = touchingPrs[j]!;
          if (isStackedPair(a, b)) {
            continue;
          }
          const addEdge = (from: PrView, to: PrView) => {
            let map = pairPaths.get(from.key);
            if (!map) {
              map = new Map();
              pairPaths.set(from.key, map);
            }
            const list = map.get(to.key);
            if (list) {
              list.push(path);
            } else {
              map.set(to.key, [path]);
            }
          };
          addEdge(a, b);
          addEdge(b, a);
        }
      }
    }

    const prByKey = new Map(repoPrs.map((pr) => [pr.key, pr]));
    for (const [prKey, targetMap] of pairPaths) {
      const overlaps: PrFileOverlap[] = [];
      for (const [otherKey, paths] of targetMap) {
        const other = prByKey.get(otherKey);
        if (!other) {
          continue;
        }
        const sortedPaths = sortPathsSourceFirst(paths);
        overlaps.push({
          prKey: other.key,
          number: other.number,
          title: other.title,
          author: other.author,
          isDraft: other.isDraft,
          sharedFiles: sortedPaths.slice(0, MAX_SHARED_PATHS_PER_OVERLAP),
          sharedCount: sortedPaths.length,
        });
      }
      overlaps.sort((a, b) => {
        // Non-draft overlaps prioritized over draft overlaps, then by sharedCount desc
        if (a.isDraft !== b.isDraft) {
          return a.isDraft ? 1 : -1;
        }
        if (b.sharedCount !== a.sharedCount) {
          return b.sharedCount - a.sharedCount;
        }
        return a.number - b.number;
      });
      if (overlaps.length > 0) {
        overlapsByKey.set(prKey, overlaps.slice(0, MAX_OVERLAPS_PER_PR));
      }
    }
  }

  return pullRequests.map((pr) => {
    const overlaps = overlapsByKey.get(pr.key);
    if (!overlaps || overlaps.length === 0) {
      if (!pr.overlaps) {
        return pr;
      }
      const { overlaps: _removed, ...rest } = pr;
      return rest;
    }
    return { ...pr, overlaps };
  });
}
