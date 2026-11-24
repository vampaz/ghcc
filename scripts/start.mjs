import { verifyBootAuth } from '../src/server/boot-check.mjs';

process.env.HOST = '127.0.0.1';
if (!process.env.PORT) {
  process.env.PORT = '4321';
}

if (process.env.GHCC_SKIP_BOOT_CHECK !== '1') {
  try {
    const result = await verifyBootAuth();
    console.log(`[ghcc] Authenticated with gh CLI as ${result.login}`);
  } catch (error) {
    console.error(`[ghcc] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

await import('../dist/server/entry.mjs');
