# AGENTS.md

Repository instructions for `ghcc`, a local-only, read-only pull request dashboard built with Astro 7 SSR (`@astrojs/node` standalone) and Vue 3.

## Runtime Prerequisites

- Node.js `24` (see `.nvmrc`).
- GitHub credentials via either authenticated `gh` CLI (bare-metal) or `GH_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN_FILE` (Docker).

## Running the Server

Do not run the bare-metal server and Docker container on port `4321` at the same time. Stop the running instance first or set `PORT` to a different port.

### Docker (Mac / OrbStack or `cloud.local` Ubuntu server)

Build and start in the background, waiting for `/api/health`:

```sh
GH_TOKEN="$(gh auth token)" docker compose up -d --build --wait
```

- **Mac (OrbStack)**: open `http://127.0.0.1:4321` or `http://localhost:4321`. Pass `GHCC_BIND_HOST=127.0.0.1` to restrict host port publishing to loopback.
- **`cloud.local` (Ubuntu server)**: open `http://cloud.local:4321` (or put a reverse proxy in front of port `4321`). For restarts across reboots, store `GH_TOKEN` in an untracked `chmod 600 .env` file next to `compose.yaml` or mount a read-only secret file and set `GH_TOKEN_FILE`.
- **Container lifecycle**:
  - Status: `docker compose ps`
  - Logs: `docker compose logs -f`
  - Stop: `docker compose down`
- **Cache volume**: `.cache/state.json` persists on the `ghcc-cache` Docker volume (`/app/.cache`), owned by the non-root `node` user.

### Bare-Metal Dev Server

```sh
npm run dev
```

- Binds to `127.0.0.1:4321` by default (override with `PORT`).
- Astro 7 starts `astro dev` as a background daemon and exits `0`. Manage it explicitly:
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
- **Same-origin refresh protection** (`src/pages/api/refresh.ts` and `astro.config.mjs`): `POST /api/refresh` only accepts loopback hosts (`127.0.0.1`, `localhost`, `::1`) plus comma-separated hostnames in `GHCC_ALLOWED_HOSTS` (`compose.yaml` defaults to `cloud.local`). Update both `GHCC_ALLOWED_HOSTS` and `astro.config.mjs` `security.allowedDomains` if exposing another hostname directly.

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
