import type { APIRoute } from 'astro';
import { getRuntime } from '@/server/runtime';
import { RefreshCooldownError } from '@/server/snapshot-service';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function isAllowedSameOriginPost(request: Request): boolean {
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

    if (originUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(originUrl.hostname)) {
      return false;
    }

    const reqHost = request.headers.get('host') ?? new URL(request.url).host;
    if (originUrl.host !== reqHost) {
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
