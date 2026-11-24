import type { APIRoute } from 'astro';
import { sanitizeErrorMessage } from '@/server/redact';
import { getRuntime } from '@/server/runtime';

export const GET: APIRoute = async () => {
  const { tokenStore } = getRuntime();

  try {
    const login = await tokenStore.getLogin();
    return new Response(
      JSON.stringify({
        gh: 'ok',
        login,
        tokenSource: tokenStore.getTokenSource(),
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  } catch (error) {
    const message = sanitizeErrorMessage(error, tokenStore.peekToken());
    return new Response(
      JSON.stringify({
        gh: 'error',
        error: message,
      }),
      {
        status: 503,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }
};
