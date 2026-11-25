# ghcc — Local Pull Request Command Center

A local-only, read-only web dashboard for pull requests you authored and pull requests awaiting your review, backed by your existing `gh` CLI authentication.

## Prerequisites

- Node.js `>= 24` (see `.nvmrc`)
- [GitHub CLI (`gh`)](https://cli.github.com/) authenticated for the repositories you want to view:

```sh
gh auth login
```

## Quick Start

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:4321](http://127.0.0.1:4321).

To bind a custom loopback port:

```sh
PORT=4400 npm run dev
```

Production build & start:

```sh
npm run build
npm run start
```

The bare-metal server defaults to `127.0.0.1` and fails closed at boot if credentials are missing or rejected by GitHub.

## Docker (Mac or `cloud.local`)

Build and start the container using your existing `gh` CLI token (kept in container memory, not written to disk):

```sh
GH_TOKEN="$(gh auth token)" docker compose up -d --build
```

- On this Mac (OrbStack), open [http://127.0.0.1:4321](http://127.0.0.1:4321) or [http://localhost:4321](http://localhost:4321). To restrict host port publishing to loopback only, pass `GHCC_BIND_HOST=127.0.0.1`.
- On `cloud.local` (Ubuntu server), open `http://cloud.local:4321` (or put a reverse proxy in front of port `4321`). `compose.yaml` allows `cloud.local` for same-origin `POST /api/refresh` via `GHCC_ALLOWED_HOSTS`.
- For long-running restarts on `cloud.local`, store `GH_TOKEN=<token>` in an untracked `chmod 600 .env` file next to `compose.yaml`, or mount a read-only secret file and set `GH_TOKEN_FILE`.
- Persistent mergeability cache is stored in the `ghcc-cache` Docker volume (`/app/.cache`).

Stop the container:

```sh
docker compose down
```

## Keyboard Shortcuts

- `j` / `k` — move focus down / up across the action queue
- `enter` — open pull request details in the inspector
- `o` — open the focused or selected pull request on GitHub
- `r` — trigger a manual refresh (10s cooldown)
- `/` — focus the search input
- `esc` — close the inspector or clear active filters

## API Routes

- `GET /api/health` — verifies `gh` CLI auth status and active GitHub login
- `GET /api/snapshot` — returns normalized pull request buckets, counts, rate limits, and warnings (supports `ETag` / `304`)
- `POST /api/refresh` — forces a snapshot refresh (same-origin protected, 10s cooldown)
- `GET /api/pull/{owner}/{repo}/{number}` — loads full checks, reviewers, and last 5 timeline items for the inspector
- `POST /api/pull/{owner}/{repo}/{number}/update-branch` — merges the base branch into a behind pull request branch via GitHub's update-branch API (same-origin protected)

## Checks

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test
```
