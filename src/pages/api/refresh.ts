import type { APIRoute } from 'astro';
import { isAllowedSameOriginPost } from '@/server/origin-guard';
import { getRuntime } from '@/server/runtime';
import { RefreshCooldownError } from '@/server/snapshot-service';

export { isAllowedSameOriginPost };

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
