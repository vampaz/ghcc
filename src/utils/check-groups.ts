import type { PrDetailCheck } from '@/types/pr';

export interface CheckGroupItem {
  check: PrDetailCheck;
  displayName: string;
}

export interface CheckGroup {
  id: string;
  label: string;
  isOther: boolean;
  bucket: 'failing' | 'pending' | 'passing';
  failingCount: number;
  pendingCount: number;
  passingCount: number;
  defaultOpen: boolean;
  items: CheckGroupItem[];
}

interface ParsedPrefix {
  prefix: string;
  key: string;
  trimmedName: string | null;
}

const SEPARATOR_RE = /^(.+?)(?:\s+[–—-]\s+|:\s+|\/)(.+)$/;
const SHARD_SUFFIX_RE = /^(.+?)\s+\([^()]+\)$/;

const BUCKET_SEVERITY: Record<PrDetailCheck['bucket'], number> = {
  failing: 0,
  pending: 1,
  passing: 2,
};

function parseCheckPrefix(name: string): ParsedPrefix | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  const sepMatch = SEPARATOR_RE.exec(trimmed);
  if (sepMatch) {
    const prefix = sepMatch[1]!.trim();
    const rest = sepMatch[2]!.trim();
    if (prefix.length > 0 && rest.length > 0) {
      return {
        prefix,
        key: prefix.toLowerCase(),
        trimmedName: rest,
      };
    }
  }

  const shardMatch = SHARD_SUFFIX_RE.exec(trimmed);
  if (shardMatch) {
    const prefix = shardMatch[1]!.trim();
    if (prefix.length > 0) {
      return {
        prefix,
        key: prefix.toLowerCase(),
        trimmedName: null,
      };
    }
  }

  return null;
}

function compareChecks(a: CheckGroupItem, b: CheckGroupItem): number {
  const sevDiff = BUCKET_SEVERITY[a.check.bucket] - BUCKET_SEVERITY[b.check.bucket];
  if (sevDiff !== 0) {
    return sevDiff;
  }
  return a.displayName.localeCompare(b.displayName, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function buildGroup(
  id: string,
  label: string,
  isOther: boolean,
  items: CheckGroupItem[],
): CheckGroup {
  let failingCount = 0;
  let pendingCount = 0;
  let passingCount = 0;

  for (const item of items) {
    if (item.check.bucket === 'failing') {
      failingCount++;
    } else if (item.check.bucket === 'pending') {
      pendingCount++;
    } else {
      passingCount++;
    }
  }

  const bucket: CheckGroup['bucket'] =
    failingCount > 0 ? 'failing' : pendingCount > 0 ? 'pending' : 'passing';

  return {
    id,
    label,
    isOther,
    bucket,
    failingCount,
    pendingCount,
    passingCount,
    defaultOpen: failingCount > 0 || pendingCount > 0,
    items: [...items].sort(compareChecks),
  };
}

export function groupDetailChecks(checks: PrDetailCheck[]): CheckGroup[] {
  if (checks.length === 0) {
    return [];
  }

  const parsedEntries = checks.map((check) => ({
    check,
    parsed: parseCheckPrefix(check.name),
  }));

  const prefixCounts = new Map<string, { label: string; count: number }>();
  for (const entry of parsedEntries) {
    if (!entry.parsed) {
      continue;
    }
    const existing = prefixCounts.get(entry.parsed.key);
    if (existing) {
      existing.count++;
    } else {
      prefixCounts.set(entry.parsed.key, { label: entry.parsed.prefix, count: 1 });
    }
  }

  const groupedItems = new Map<string, { label: string; items: CheckGroupItem[] }>();
  const otherItems: CheckGroupItem[] = [];

  for (const entry of parsedEntries) {
    const info = entry.parsed ? prefixCounts.get(entry.parsed.key) : undefined;
    if (entry.parsed && info && info.count >= 2) {
      let bucket = groupedItems.get(entry.parsed.key);
      if (!bucket) {
        bucket = { label: info.label, items: [] };
        groupedItems.set(entry.parsed.key, bucket);
      }
      bucket.items.push({
        check: entry.check,
        displayName: entry.parsed.trimmedName ?? entry.check.name,
      });
    } else {
      otherItems.push({
        check: entry.check,
        displayName: entry.check.name,
      });
    }
  }

  const groups: CheckGroup[] = [];
  for (const [key, entry] of groupedItems.entries()) {
    groups.push(buildGroup(`suite:${key}`, entry.label, false, entry.items));
  }
  if (otherItems.length > 0) {
    groups.push(buildGroup('other', 'Other', true, otherItems));
  }

  groups.sort((a, b) => {
    const sevDiff = BUCKET_SEVERITY[a.bucket] - BUCKET_SEVERITY[b.bucket];
    if (sevDiff !== 0) {
      return sevDiff;
    }
    if (a.isOther !== b.isOther) {
      return a.isOther ? 1 : -1;
    }
    if (b.items.length !== a.items.length) {
      return b.items.length - a.items.length;
    }
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  });

  return groups;
}
