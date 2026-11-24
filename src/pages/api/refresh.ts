import type { APIRoute } from 'astro';
import { getRuntime } from '@/server/runtime';
import { RefreshCooldownError } from '@/server/snapshot-service';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function getAllowedHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const allowed = new Set(LOOPBACK_HOSTS);
  const configured = env.GHCC_ALLOWED_HOSTS;
  if (configured) {
    for (const entry of configured.split(',')) {
      const normalized = entry.trim().toLowerCase();
      if (normalized) {
        allowed.add(normalized);
      }
    }
  }
  return allowed;
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

    const allowedHosts = getAllowedHosts(env);
    if (
      (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') ||
      !allowedHosts.has(originUrl.hostname.toLowerCase())
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

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedSameOriginPost(request)) {
    return new Response(
      JSON.stringify({
        error: 'Cross-origin refresh requests are forbidden',
      }),
      {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }

  const { snapshotService } = getRuntime();
  try {
    const result = await snapshotService.forceRefresh();
    return new Response(JSON.stringify(result.snapshot), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        etag: result.etag,
        'cache-control': 'no-cache',
      },
    });
  } catch (error) {
    if (error instanceof RefreshCooldownError) {
      return new Response(
        JSON.stringify({
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'retry-after': String(error.retryAfterSeconds),
            'cache-control': 'no-store',
          },
        },
      );
    }
    throw error;
  }
};
