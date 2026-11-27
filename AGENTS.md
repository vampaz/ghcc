# AGENTS.md

Repository instructions for `ghcc` (GitHub Command Center), a local and self-hosted pull request dashboard built with Astro 7 SSR (`@astrojs/node` standalone) and Vue 3.

## Runtime Prerequisites

- Node.js `24` (see `.nvmrc`).
- GitHub credentials via `GH_TOKEN_FILE`, `GH_TOKEN`, `GITHUB_TOKEN`, or authenticated `gh` CLI (bare-metal only; Docker requires a token env var or mounted file).

## Running the Server

Do not run the bare-metal server and Docker container on port `4321` at the same time. Stop the running instance first or set `PORT` to a different port.

### Docker

Build and start in the background, waiting for `/api/health`:

```sh
GH_TOKEN="$(gh auth token)" docker compose up -d --build --wait
```

- **Local machine**: open `http://127.0.0.1:4321` or `http://localhost:4321`. Pass `GHCC_BIND_HOST=127.0.0.1` to restrict host port publishing to loopback.
- **LAN server / remote host**: open `http://<host>:4321` (or put a reverse proxy in front of port `4321`). For restarts across reboots, store `GH_TOKEN` in an untracked `chmod 600 .env` file next to `compose.yaml` or mount a read-only secret file and set `GH_TOKEN_FILE`.
- **Container lifecycle**:
  - Status: `docker compose ps`
  - Logs: `docker compose logs -f`
  - Stop: `docker compose down`
- **Cache volume**: `.cache/state.json` persists on the `ghcc-cache` Docker volume (`/app/.cache`), owned by the non-root `node` user.

### Bare-Metal Dev Server

```sh
npm run dev
```

- Binds to `127.0.0.1:4321` by default (override with `HOST` and `PORT`).
- In interactive terminals, `astro dev` runs in the foreground. When invoked by an AI agent (or with `--background`), Astro 7 starts `astro dev` as a background daemon and exits `0`. Manage background servers explicitly:
  - Status: `./node_modules/.bin/astro dev status`
  - Logs: `./node_modules/.bin/astro dev logs`
  - Stop: `./node_modules/.bin/astro dev stop`

### Bare-Metal Production Server

```sh
npm run build
npm run start
```

- Defaults to `HOST=127.0.0.1` and `PORT=4321` (`scripts/start.mjs`).

## Credentials & Security Boundaries

- **Resolution order** (`src/server/boot-check.mjs`): `GH_TOKEN_FILE` -> `GH_TOKEN` -> `GITHUB_TOKEN` -> `gh auth status` + `gh auth token`.
- **Fail-closed boot**: startup verifies the credential against GitHub GraphQL (`viewer { login }`) and exits non-zero if missing or rejected.
- **Secrets hygiene**: never print, log, serialize, or commit GitHub tokens or `.env` files.
- **Same-origin `POST` protection** (`src/server/origin-guard.ts` and `astro.config.mjs`): Same-origin `POST` endpoints (`/api/refresh`, `/api/pull/.../update-branch`, `/api/pull/.../draft`, `/api/pull/.../labels`, `/api/pull/.../merge`) work on any host by default as long as `Sec-Fetch-Site` and `Origin` match `Host`/`X-Forwarded-Host`. Optionally set comma-separated hostnames in `GHCC_ALLOWED_HOSTS` (also passed as a Docker build arg into `astro.config.mjs` `security.allowedDomains`) to restrict `POST` requests to loopback plus an explicit allowlist.

## Git Policy

- **Direct `master` commits and pushes authorized**: In this repository, agents are authorized to stage, commit directly on local `master`, and push to `origin/master` once validation and the completion gate pass. This explicitly overrides the global protected-`master` restriction for `ghcc`.

## Validation Checks

Run before completing changes:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test
```

Run a single test file with:

```sh
npm run test -- path/to/file.spec.ts
```

Run the Playwright end-to-end suite (builds and starts on `127.0.0.1:4330` with `GHCC_SKIP_BOOT_CHECK=1` and mocked `/api/snapshot` fixtures):

```sh
npm run test:e2e
```
