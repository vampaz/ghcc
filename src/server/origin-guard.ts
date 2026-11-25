const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function getConfiguredAllowedHosts(
  env: Record<string, string | undefined> = process.env,
): Set<string> | null {
  const configured = env.GHCC_ALLOWED_HOSTS;
  if (!configured) {
    return null;
  }
  const entries = configured
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) {
    return null;
  }
  return new Set([...LOOPBACK_HOSTS, ...entries]);
}

function normalizeHostForProtocol(
  rawHost: string | null | undefined,
  protocol: string,
): string | null {
  const trimmed = rawHost?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(`${protocol}//${trimmed}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

export function isAllowedSameOriginPost(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite !== null && secFetchSite !== 'same-origin') {
    return false;
  }

  const originHeader = request.headers.get('origin');
  if (originHeader !== null) {
    let originUrl: URL;
    try {
      originUrl = new URL(originHeader);
    } catch {
      return false;
    }

    const allowedHosts = getConfiguredAllowedHosts(env);
    if (
      (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') ||
      (allowedHosts !== null && !allowedHosts.has(originUrl.hostname.toLowerCase()))
    ) {
      return false;
    }

    const candidateHosts = new Set<string>();
    const hostHeader = normalizeHostForProtocol(request.headers.get('host'), originUrl.protocol);
    const forwardedHost = normalizeHostForProtocol(
      request.headers.get('x-forwarded-host')?.split(',')[0],
      originUrl.protocol,
    );
    if (hostHeader) {
      candidateHosts.add(hostHeader);
    }
    if (forwardedHost) {
      candidateHosts.add(forwardedHost);
    }
    if (candidateHosts.size === 0) {
      const reqHost = normalizeHostForProtocol(new URL(request.url).host, originUrl.protocol);
      if (reqHost) {
        candidateHosts.add(reqHost);
      }
    }
    if (!candidateHosts.has(originUrl.host.toLowerCase())) {
      return false;
    }
    return true;
  }

  return secFetchSite === 'same-origin';
}
