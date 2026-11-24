import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createTokenStore } from '@/server/auth';
import { createGitHubClient } from '@/server/github-client';

async function main(): Promise<void> {
  if (process.env.GHCC_RECORD !== '1') {
    console.error('Refusing to record fixtures without GHCC_RECORD=1');
    process.exit(1);
  }

  const tokenStore = createTokenStore();
  const client = createGitHubClient({ tokenStore });

  const [authored, review] = await Promise.all([
    client.fetchAuthoredPulls(),
    client.fetchReviewQueue(),
  ]);

  const outPath = resolve(process.cwd(), '.cache/recorded-fixtures.json');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        viewerLogin: authored.login,
        authored: authored.pullRequests,
        reviewRequested: review.pullRequests,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(
    `Recorded ${authored.pullRequests.length} authored and ${review.pullRequests.length} review-requested PRs to ${outPath}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
