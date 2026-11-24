import type { APIRoute } from 'astro';
import { getRuntime } from '@/server/runtime';

function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) {
    return false;
  }
  const trimmed = header.trim();
  if (trimmed === '*') {
    return true;
  }
  return trimmed
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .includes(etag);
}

export const GET: APIRoute = async ({ request }) => {
  const { snapshotService } = getRuntime();
  const result = await snapshotService.getSnapshot();

  if (matchesIfNoneMatch(request.headers.get('if-none-match'), result.etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        etag: result.etag,
        'cache-control': 'no-cache',
      },
    });
  }

  return new Response(JSON.stringify(result.snapshot), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      etag: result.etag,
      'cache-control': 'no-cache',
    },
  });
};
