import { createTokenStore, type TokenStore } from '@/server/auth';
import { createGitHubClient, type GitHubClient } from '@/server/github-client';
import { createSnapshotService, type SnapshotService } from '@/server/snapshot-service';
import { StateStore } from '@/server/state-store';

export interface ServerRuntime {
  tokenStore: TokenStore;
  githubClient: GitHubClient;
  stateStore: StateStore;
  snapshotService: SnapshotService;
}

let activeRuntime: ServerRuntime | null = null;

export function getRuntime(): ServerRuntime {
  if (!activeRuntime) {
    const tokenStore = createTokenStore();
    const stateStore = new StateStore();
    const githubClient = createGitHubClient({ tokenStore });
    const snapshotService = createSnapshotService({
      tokenStore,
      githubClient,
      stateStore,
    });
    activeRuntime = {
      tokenStore,
      githubClient,
      stateStore,
      snapshotService,
    };
  }
  return activeRuntime;
}

export function setRuntimeForTesting(runtime: ServerRuntime | null): void {
  activeRuntime = runtime;
}
