import type { CiOutageAlert, PrView } from '@/types/pr';

export const CI_OUTAGE_MIN_PRS = 3;

const DEFAULT_BASE_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'trunk']);

/**
 * Detects shared CI outages where multiple unrelated open non-draft PRs
 * in the same repository fail the exact same CI check concurrently.
 *
 * Stacked child PRs (whose base branch is another failing PR's head branch
 * in the same repo) and duplicate headRefOids are collapsed so one broken
 * branch stack does not trigger a false outage alert.
 */
export function deriveCiOutages(
  pullRequests: readonly PrView[],
  minPrs: number = CI_OUTAGE_MIN_PRS,
): CiOutageAlert[] {
  const nonDrafts = pullRequests.filter((pr) => !pr.isDraft && pr.ci.failing.length > 0);
  if (nonDrafts.length < minPrs) {
    return [];
  }

  // Group failing PRs by (repository, checkName)
  interface CheckBucket {
    repository: string;
    checkName: string;
    prs: PrView[];
    sampleUrl: string | null;
  }

  const buckets = new Map<string, CheckBucket>();

  for (const pr of nonDrafts) {
    const seenChecksOnPr = new Set<string>();
    for (const check of pr.ci.failing) {
      const checkName = check.name.trim();
      if (!checkName || seenChecksOnPr.has(checkName)) {
        continue;
      }
      seenChecksOnPr.add(checkName);
      const id = `${pr.repository}::${checkName}`;
      const existing = buckets.get(id);
      if (existing) {
        existing.prs.push(pr);
        if (!existing.sampleUrl && check.url) {
          existing.sampleUrl = check.url;
        }
      } else {
        buckets.set(id, {
          repository: pr.repository,
          checkName,
          prs: [pr],
          sampleUrl: check.url || null,
        });
      }
    }
  }

  const alerts: CiOutageAlert[] = [];

  for (const [id, bucket] of buckets) {
    if (bucket.prs.length < minPrs) {
      continue;
    }

    // Identify independent roots: exclude stacked children whose baseRefName
    // matches another PR in this same failing check bucket.
    const headBranches = new Set(bucket.prs.map((pr) => pr.headRefName));
    const independentHeadOids = new Set<string>();
    let independentCount = 0;

    for (const pr of bucket.prs) {
      const isStackedOnFailingPr =
        !DEFAULT_BASE_BRANCHES.has(pr.baseRefName) &&
        pr.baseRefName !== pr.headRefName &&
        headBranches.has(pr.baseRefName);
      if (isStackedOnFailingPr) {
        continue;
      }
      if (pr.headRefOid) {
        if (independentHeadOids.has(pr.headRefOid)) {
          continue;
        }
        independentHeadOids.add(pr.headRefOid);
      }
      independentCount++;
    }

    if (independentCount < minPrs) {
      continue;
    }

    const affectedPrKeys = bucket.prs.map((pr) => pr.key).sort();
    const authors = Array.from(new Set(bucket.prs.map((pr) => pr.author))).sort();

    alerts.push({
      id,
      repository: bucket.repository,
      checkName: bucket.checkName,
      affectedCount: affectedPrKeys.length,
      affectedPrKeys,
      authors,
      sampleUrl: bucket.sampleUrl,
    });
  }

  return alerts.sort((a, b) => {
    if (b.affectedCount !== a.affectedCount) {
      return b.affectedCount - a.affectedCount;
    }
    return a.id.localeCompare(b.id);
  });
}
