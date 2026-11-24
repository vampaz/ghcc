import { fileURLToPath } from 'node:url';
import node from '@astrojs/node';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { verifyBootAuth } from './src/server/boot-check.mjs';

const port = Number(process.env.PORT ?? 4321);
const host = process.env.HOST || '127.0.0.1';

const extraAllowedDomains = (process.env.GHCC_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean)
  .map((hostname) => ({ hostname }));

function ghccBootCheckIntegration() {
  return {
    name: 'ghcc-boot-check',
    hooks: {
      'astro:server:start': async ({ logger }) => {
        if (process.env.GHCC_SKIP_BOOT_CHECK === '1') {
          return;
        }
        try {
          const result = await verifyBootAuth();
          const sourceLabel = result.tokenSource === 'env' ? 'configured token' : 'gh CLI';
          logger.info(`Authenticated with ${sourceLabel} as ${result.login}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(message);
          process.exit(1);
        }
      },
    },
  };
}

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [vue(), ghccBootCheckIntegration()],
  security: {
    allowedDomains: [
      { hostname: '127.0.0.1' },
      { hostname: 'localhost' },
      { hostname: 'cloud.local' },
      ...extraAllowedDomains,
    ],
  },
  server: {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 4321,
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
});
