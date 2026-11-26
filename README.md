# ghcc — Local Pull Request Command Center

A local and self-hosted web dashboard for pull requests you authored, pull requests awaiting your review, and teammates' open pull requests across your active repositories—with branch sync and draft/ready toggling, backed by your `gh` CLI login or a GitHub token.

## Features

- **Priority queue & KPIs**: Scoped **Needs You**, **Ready to Merge**, **Waiting on Others**, and **CI Health** tiles (click any tile to filter); full-width **Action Queue** (including your authored waiting PRs) alongside a **Waiting on Others** quick-jump panel and `stale` badge after 3+ idle days.
- **Filtering & search**: `All`, `Mine`, `To Review`, and `Team` views; `Include drafts` checkbox; instant search (`/`) across repo, number, title, branch, author, and blocker summary; multi-repository checkboxes with a tri-state toggle-all in the top-bar **All repos** dropdown; URL-synced filter state.
- **Non-modal PR inspector**: Slide-over right sidebar showing full CI checks, reviewers, and the last 5 timeline events without dimming the dashboard—click directly between PR cards to switch in place, or dismiss with an outside click or `Esc`.
- **Pull request actions**: Per-PR GitHub-style `Labels` dropdown picker, `Squash / Merge` split button (with confirmation dialog and GitHub REST merge), `Ready | Draft` toggle (GitHub GraphQL mutations), and `Sync` button to merge the base branch into behind-base PRs (GitHub `update-branch` REST API), all same-origin protected.
- **Live polling & theme**: Configurable auto-refresh (`120s` default) plus manual refresh (`r`), GraphQL rate-limit indicator, and light/dark mode toggle.

## Run with Docker

Anyone can run `ghcc` in a Docker container on a local machine (Docker Desktop, OrbStack, Linux Docker Engine) or a LAN home server.

### 1. Prerequisites

- Docker and Docker Compose (`docker compose version`)
- A GitHub credential—either:
  - an authenticated [GitHub CLI (`gh`)](https://cli.github.com/) session (`gh auth login`), or
  - a GitHub Personal Access Token:
    - **Classic PAT**: `repo` scope for private repositories (`public_repo` for public repositories only).
    - **Fine-grained PAT**: **Pull requests** (Read and write) and **Contents** (Read and write) to use `Sync` and `Ready | Draft` actions, or Read-only for viewing only.

### 2. Clone the repository

```sh
git clone https://github.com/vampaz/ghcc.git
cd ghcc
```

### 3. Start the container

Choose the credential setup that fits your machine:

#### Option A — Quick local start (token in memory via `gh` CLI)

```sh
GH_TOKEN="$(gh auth token)" docker compose up -d --build --wait
```

Open [http://127.0.0.1:4321](http://127.0.0.1:4321) or [http://localhost:4321](http://localhost:4321).

To restrict host port publishing to loopback only (recommended on shared networks):

```sh
GHCC_BIND_HOST=127.0.0.1 GH_TOKEN="$(gh auth token)" docker compose up -d --build --wait
```

#### Option B — Persistent server or LAN machine (survives reboots via `.env`)

Create an untracked, owner-only `.env` file next to `compose.yaml` (`.env` is gitignored):

```sh
cat <<'EOF' > .env
GH_TOKEN=ghp_your_token_here
# Optional overrides:
# PORT=4321
# GHCC_BIND_HOST=0.0.0.0
# GHCC_ALLOWED_HOSTS=my-server.local
EOF
chmod 600 .env
docker compose up -d --build --wait
```

#### Option C — Mounted secret file (`GH_TOKEN_FILE`)

Mount a read-only file containing your token into the container (for example `/run/secrets/gh_token`) and set `GH_TOKEN_FILE=/run/secrets/gh_token`.

### Docker configuration & custom hostnames

| Variable             | Default (`compose.yaml`)         | Purpose                                                                                 |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| `GH_TOKEN_FILE`      | _(unset)_                        | Path inside the container to a file containing the GitHub token (checked first)         |
| `GH_TOKEN`           | _(unset)_                        | GitHub token passed via environment or `.env` (checked second)                          |
| `GITHUB_TOKEN`       | _(unset)_                        | Alternate GitHub token env var (checked third)                                          |
| `PORT`               | `4321`                           | Host port mapped to container port `4321`                                               |
| `GHCC_BIND_HOST`     | `0.0.0.0`                        | Host interface to bind (`127.0.0.1` for local-only access)                              |
| `GHCC_ALLOWED_HOSTS` | _(unset — any same-origin host)_ | Optional comma-separated host allowlist for same-origin `POST` routes and proxy headers |

- **Any host out of the box**: You can access `ghcc` via `localhost`, an IP address, a LAN hostname (e.g. `http://my-server.local:4321`), or a reverse proxy without extra configuration—same-origin `POST` routes (`/api/refresh`, `Sync`, `Ready | Draft`) verify that `Origin` and `Sec-Fetch-Site` match the request host. If you want to restrict access to specific hostnames (or explicitly trust forwarded proxy headers in Astro), set `GHCC_ALLOWED_HOSTS=host1,host2` in `.env` and rebuild (`docker compose up -d --build`).
- **Fail-closed startup & healthcheck**: The container runs as non-root `node`, verifies the token against GitHub GraphQL (`viewer { login }`) before serving traffic, and exposes a built-in Docker `HEALTHCHECK` against `/api/health`.
- **Persistent cache**: Mergeability cache data persists in the `ghcc-cache` Docker volume (`/app/.cache`).

### Container lifecycle

```sh
docker compose ps       # Check health and port mapping
docker compose logs -f  # Inspect startup and runtime logs
docker compose down     # Stop and remove the container (keeps ghcc-cache volume)
```

Do not run the bare-metal server and the Docker container on port `4321` at the same time—stop one first or set a different `PORT`.

## Run Locally (Bare-Metal)

### Prerequisites

- Node.js `>= 24` (see `.nvmrc`)
- [GitHub CLI (`gh`)](https://cli.github.com/) authenticated (`gh auth login`), or `GH_TOKEN` / `GITHUB_TOKEN` / `GH_TOKEN_FILE` set in the environment.

### Development server

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:4321](http://127.0.0.1:4321). To use another port:

```sh
PORT=4400 npm run dev
```

Astro 7 starts `astro dev` as a background daemon. Manage it with:

```sh
./node_modules/.bin/astro dev status
./node_modules/.bin/astro dev logs
./node_modules/.bin/astro dev stop
```

### Production build & start

```sh
npm run build
npm run start
```

The bare-metal server binds to `127.0.0.1:4321` by default (`HOST` and `PORT` can override) and fails closed at boot if credentials are missing or rejected by GitHub.

## Keyboard Shortcuts

- `j` / `k` — move focus down / up across the action queue
- `Enter` — open pull request details in the inspector
- `o` — open the focused or selected pull request on GitHub
- `r` — trigger a manual refresh (10s cooldown)
- `/` — focus the search input
- `Esc` — close the inspector or clear active filters

## API Routes

- `GET /api/health` — verifies GitHub auth status, active login, and token source (`gh-cli` or `env`)
- `GET /api/snapshot` — returns normalized pull request buckets, counts, rate limits, and warnings (supports `ETag` / `304`)
- `POST /api/refresh` — forces a snapshot refresh (same-origin protected, 10s cooldown)
- `GET /api/pull/{owner}/{repo}/{number}` — loads full checks, reviewers, and last 5 timeline items for the inspector
- `POST /api/pull/{owner}/{repo}/{number}/update-branch` — merges the base branch into a behind pull request branch via GitHub's `update-branch` API (same-origin protected)
- `POST /api/pull/{owner}/{repo}/{number}/draft` — converts a pull request to draft or marks it ready for review via GitHub GraphQL (same-origin protected)
- `GET /api/repo/{owner}/{repo}/labels` — lists repository labels (name, hex color, description) for the label picker
- `POST /api/pull/{owner}/{repo}/{number}/labels` — sets pull request labels via GitHub's issues labels API (same-origin protected)
- `POST /api/pull/{owner}/{repo}/{number}/merge` — merges a pull request via GitHub's merge API (`squash` by default or `merge` commit, same-origin protected)

## Checks

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test
```

## End-to-End Tests

Install the Playwright Chromium browser once:

```sh
./node_modules/.bin/playwright install chromium
```

Run the browser tests against a production build with a mocked GitHub API:

```sh
npm run test:e2e
```

The tests build the app and start it on port `4330` with the boot check disabled. They intercept `/api/snapshot` with fixtures, so no GitHub credentials are required.
