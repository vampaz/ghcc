export function formatRelativeAge(isoDate: string | null | undefined, nowMs: number): string {
  if (!isoDate) {
    return 'never';
  }
  const ts = Date.parse(isoDate);
  if (!Number.isFinite(ts)) {
    return 'unknown';
  }
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 10) {
    return 'just now';
  }
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatIdleCompact(days: number, lastCommittedAt: string, nowMs: number): string {
  if (days >= 1) {
    return `${days}d idle`;
  }
  const ts = Date.parse(lastCommittedAt);
  if (!Number.isFinite(ts)) {
    return '0d idle';
  }
  const hours = Math.max(0, Math.floor((nowMs - ts) / (60 * 60 * 1000)));
  if (hours >= 1) {
    return `${hours}h idle`;
  }
  const mins = Math.max(1, Math.floor((nowMs - ts) / (60 * 1000)));
  return `${mins}m idle`;
}

export function formatResetCountdown(resetAt: string | null | undefined, nowMs: number): string {
  if (!resetAt) {
    return 'soon';
  }
  const ts = Date.parse(resetAt);
  if (!Number.isFinite(ts)) {
    return 'soon';
  }
  const diffSec = Math.max(0, Math.ceil((ts - nowMs) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s`;
  }
  const mins = Math.ceil(diffSec / 60);
  return `${mins}m`;
}
