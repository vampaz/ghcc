# ghcc — GitHub Command Center

A local and self-hosted web dashboard for pull requests you authored, pull requests awaiting your review, and teammates' open pull requests across your active repositories—with branch sync, draft/ready toggling, label editing, and squash/merge actions, backed by your `gh` CLI login or a GitHub token.

## Features

- **Priority queue & KPIs**: Scoped **Needs You**, **Ready to Merge**, **Waiting on Others**, and **CI Health** tiles (click any tile to filter); prioritized **Action Queue** (including your authored waiting PRs) with local **Pin** and conditional **Snooze** (until next push, CI change, new activity, or timer) persisted in `.cache/state.json`, an **Inbox Zero** clear state, a side rail with **Ready to Merge** and **Waiting on Others** quick-jump panels, and a `stale` badge after more than 3 idle days.
- **Filtering, presets & command palette**: `All`, `Mine`, `To Review`, and `Team` views; `Include drafts` and `Show snoozed` checkboxes; instant search (`/`) across repo, number, title, branch, author, labels, and blocker summary; multi-repository checkboxes with a tri-state **Select all** toggle; built-in and saved filter presets (`Presets`); a keyboard-first **Command Palette** (`Cmd+K` / `Ctrl+K`); and multi-select **Bulk Actions** (`x` or checkboxes for Sync, Re-run CI, Pin, Snooze, and Draft/Ready); URL-synced filter state.
- **Non-modal PR inspector**: Slide-over right sidebar on desktop (inline expansion on narrow screens) showing sanitized GitHub Markdown PR descriptions, inline and fullscreen interactive Mermaid diagrams, grouped collapsible CI checks (up to 100) with on-demand inline failure annotations and GitHub Actions log excerpts, reviewers, and the last 5 timeline events without dimming the dashboard—click directly between PR cards to switch in place, or dismiss with an outside click or `Esc`.
- **Pull request actions**: Per-PR GitHub-style `Labels` dropdown picker, `Squash / Merge` split button (with confirmation dialog and GitHub REST merge), `Ready | Draft` toggle (GitHub GraphQL mutations), `Re-run CI` / per-job `Re-run` buttons for failed GitHub Actions checks, and `Sync` button to merge the base branch into behind-base PRs (including drafts, via GitHub's `update-branch` REST API), all same-origin protected.
- **Cross-repo & CI intelligence**: **Shared CI Outage** banner when 3+ independent PRs in a repository fail the same check; poll-over-poll **Flake Tracker** detecting fail/pass flips on identical commit SHAs (`flaky CI` card badge and `flaky · N×` check badges); **Missions** grouping (`?group=missions`) linking cross-repo tickets, stacked branches, and `Depends on ...` merge-order hints; and **Blast Radius** file-overlap detection (cached per commit SHA) with warnings in the inspector and merge confirmation dialog.
- **Live polling & theme**: Configurable auto-refresh (`60s` default; `60s`, `120s`, or `5m`) with tab-focus catch-up plus manual refresh (`r`), GraphQL (`GQL`) and REST (`REST`) rate-limit indicators, live refresh status, and light/dark mode toggle.

## Choose Your Setup

- **[Run with Docker](#run-with-docker)** — Best for running `ghcc` locally without installing Node.js, or hosting it continuously on a LAN / home server.
- **[Local Development (Bare-Metal)](#local-development-bare-metal)** — Best for contributing to `ghcc`, editing code with hot reload, or running directly with Node.js `24` and your existing `gh` CLI login.

> **Port conflict note:** Both Docker and bare-metal default to port `4321`. Do not run them on the same port at the same time—stop one first or override `PORT`.

## GitHub Credentials

`ghcc` fails closed at startup: it verifies your credential against GitHub GraphQL (`viewer { login }`) before serving traffic and exits non-zero if authentication is missing or rejected.

Credential resolution order (`src/server/boot-check.mjs`):

1. `GH_TOKEN_FILE` — path to a file containing the token
2. `GH_TOKEN` — token passed via environment variable or Docker `.env`
3. `GITHUB_TOKEN` — alternate token environment variable
4. `gh auth status` + `gh auth token` — authenticated [GitHub CLI (`gh`)](https://cli.github.com/) session (bare-metal only; `gh` is not installed inside the Docker image)

### Token permissions

If you use a Personal Access Token (required for persistent Docker setups and optional for bare-metal):

- **Classic PAT**:
  - `repo` scope for private repositories (`public_repo` for public repositories only).
- **Fine-grained PAT**:
  - Scoped to a **single resource owner** (either your personal account or one organization). If your PRs span multiple organizations or personal + org repositories, use a Classic PAT or `gh auth login` instead.
  - **Viewing only**: **Metadata** (Read-only, granted automatically), **Pull requests** (Read-only), **Contents** (Read-only, used for behind-base draft detection), **Checks** (Read-only), and **Commit statuses** (Read-only).
  - **Full PR actions** (`Sync`, `Ready | Draft`, `Labels`, `Squash / Merge`, `Re-run CI`): upgrade **Pull requests**, **Contents**, and **Actions** to **Read and write** (and **Issues** to **Read and write** if your repository enforces it for PR labels).
- **Organizations with SAML SSO**:
  - Classic PATs must be authorized for the organization (**Configure SSO** in GitHub token settings).
  - Fine-grained PATs must be scoped to (and, if required, approved by) the organization.

---

## Run with Docker

You can run `ghcc` in Docker on a local machine (Docker Desktop, OrbStack, or Linux Docker Engine) or an always-on LAN / home server.

### 1. Prerequisites

- Docker and Docker Compose v2 (`docker compose version`)
- A GitHub credential—either an authenticated `gh` CLI session on your host (`gh auth login`) or a GitHub PAT (see [Token permissions](#token-permissions))

### 2. Clone the repository

```sh
git clone https://github.com/vampaz/ghcc.git
cd ghcc
```

### 3. Start the container

Pick the option that matches how you plan to run `ghcc`:

#### Option A — Quick local start (token from `gh` CLI, loopback only)

Best for trying `ghcc` on your laptop or desktop without writing a token to disk. Requires an active `gh` CLI login (`gh auth status`) on the host. Binding to `127.0.0.1` keeps the dashboard reachable only from your machine:

```sh
GHCC_BIND_HOST=127.0.0.1 GH_TOKEN="$(gh auth token)" docker compose up -d --build --wait
```

Once healthy, open [http://127.0.0.1:4321](http://127.0.0.1:4321) or [http://localhost:4321](http://localhost:4321).

> **Note:** Docker stores the resolved environment variable on the container, so automatic container restarts keep working. If you later recreate the container (`docker compose up -d` or `docker compose down` followed by `up`), pass `GH_TOKEN="$(gh auth token)"` again or switch to Option B.

#### Option B — Persistent local or LAN server (`.env` file)

Best for a home server, Raspberry Pi, or any machine where you want `docker compose up -d` to work without passing `GH_TOKEN` on every command.

Create an untracked, owner-only `.env` file next to `compose.yaml` (`.env` is gitignored and excluded by `.dockerignore`):

```sh
cat <<'EOF' > .env
GH_TOKEN=your_github_token_here
# Use 127.0.0.1 for local-only access, or 0.0.0.0 to expose on your LAN:
GHCC_BIND_HOST=0.0.0.0
# Optional overrides:
# PORT=4321
# GHCC_ALLOWED_HOSTS=my-server.local
EOF
chmod 600 .env
docker compose up -d --build --wait
```

Open `http://<server-ip-or-hostname>:4321` (or `http://127.0.0.1:4321` on the same machine).

#### Option C — Mounted secret file (`GH_TOKEN_FILE`)

Best when you manage secrets outside `.env` (for example Docker secrets, systemd credentials, or a host secret file).

Store the token file **outside the repository directory** (for example `/etc/ghcc/gh_token` or `~/.config/ghcc/gh_token`) so it is never copied into the Docker build context or committed to Git. Make sure it is readable by the container's non-root `node` user (UID `1000`—on Linux, e.g. `chown 1000:1000` and `chmod 400`), then create an extra Compose file outside the repository (for example `/etc/ghcc/compose.secrets.yaml`):

```yaml
services:
  ghcc:
    environment:
      GH_TOKEN_FILE: /run/secrets/gh_token
    volumes:
      - /etc/ghcc/gh_token:/run/secrets/gh_token:ro
```

Start with both files:

```sh
docker compose -f compose.yaml -f /etc/ghcc/compose.secrets.yaml up -d --build --wait
```

### 4. Docker configuration reference

| Variable             | Default (`compose.yaml`)         | Purpose                                                                                 |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| `GH_TOKEN_FILE`      | _(unset)_                        | Path inside the container to a file containing the GitHub token (checked first)         |
| `GH_TOKEN`           | _(unset)_                        | GitHub token passed via environment or `.env` (checked second)                          |
| `GITHUB_TOKEN`       | _(unset)_                        | Alternate GitHub token env var (checked third)                                          |
| `PORT`               | `4321`                           | Host port mapped to container port `4321`                                               |
| `GHCC_BIND_HOST`     | `0.0.0.0`                        | Host interface to bind (`127.0.0.1` for local-only access)                              |
| `GHCC_ALLOWED_HOSTS` | _(unset — any same-origin host)_ | Optional comma-separated host allowlist for same-origin `POST` routes and proxy headers |

### 5. Networking, security, and persistence

- **No built-in user login**: Anyone who can reach the `ghcc` web UI acts with your configured GitHub token. On shared or untrusted networks, bind to `GHCC_BIND_HOST=127.0.0.1` or place `ghcc` behind a VPN (such as Tailscale) or an authenticating reverse proxy.
- **Any host out of the box**: You can access `ghcc` via `localhost`, an IP address, a LAN hostname (e.g. `http://my-server.local:4321`), or a reverse proxy without extra configuration. All mutating `POST` routes (`/api/refresh`, `Sync`, `Ready | Draft`, `Labels`, `Squash / Merge`) verify that `Origin` and `Sec-Fetch-Site` match `Host` or `X-Forwarded-Host`.
- **Restricting hosts / reverse proxy allowlist**: Set `GHCC_ALLOWED_HOSTS=ghcc.example.com,my-server.local` in `.env` and **rebuild** (`docker compose up -d --build --wait`) so the value is applied both at build time (Astro `security.allowedDomains`) and at runtime (loopback plus your allowlist).
- **Non-root container & healthcheck**: The container runs as the non-root `node` user (UID `1000`), verifies the token at startup, and includes a Docker `HEALTHCHECK` against `/api/health`.
- **Persistent cache**: The `ghcc-cache` Docker volume (`/app/.cache/state.json`) stores the last snapshot (for instant warm restarts), mergeability cache and probe counters, and draft branch comparisons.

### 6. Updating and container lifecycle

```sh
docker compose ps                     # Check container health and port mapping
docker compose logs -f                # Follow startup and runtime logs
docker compose restart                # Restart the container
docker compose down                   # Stop and remove the container (keeps ghcc-cache volume)
docker compose down -v                # Stop and remove container AND cached state volume
```

To pull updates and rebuild (if you used Option A instead of `.env`, include `GHCC_BIND_HOST=127.0.0.1 GH_TOKEN="$(gh auth token)"`; if you used Option C, include `-f compose.yaml -f /etc/ghcc/compose.secrets.yaml`):

```sh
git pull
docker compose up -d --build --wait
```

---

## Local Development (Bare-Metal)

Use bare-metal mode to develop `ghcc`, run tests, or run directly on your machine with Node.js.

### 1. Prerequisites

- **Node.js `24`** (matching `.nvmrc`; if you use `nvm`, run `nvm use`)
- **GitHub credentials**—either:
  - authenticated [GitHub CLI (`gh`)](https://cli.github.com/):
    ```sh
    gh auth login
    gh auth status
    ```
  - or an exported `GH_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN_FILE` environment variable in your shell.

> **Note:** Unlike Docker Compose, bare-metal `npm run dev` and `npm run start` do **not** automatically load a `.env` file for boot-time credential checks. Either stay logged in with `gh auth login` or export `GH_TOKEN` in your shell.

### 2. Install dependencies

```sh
git clone https://github.com/vampaz/ghcc.git
cd ghcc
nvm use        # Optional, if using nvm
npm install
```

### 3. Start the development server

```sh
npm run dev
```

This starts Astro 7 + Vue 3 with hot reload on [http://127.0.0.1:4321](http://127.0.0.1:4321). Press `Ctrl+C` to stop it.

To bind to a different port (or address—keep `127.0.0.1` on untrusted networks since `ghcc` has no built-in login):

```sh
PORT=4400 npm run dev
```

#### Optional: Background dev server

Astro 7 also supports running the dev server detached in the background (and automatically backgrounds it when invoked by supported AI coding agents):

```sh
npm run dev -- --background
./node_modules/.bin/astro dev status
./node_modules/.bin/astro dev logs --follow
./node_modules/.bin/astro dev stop
```

### 4. Local production build & start

To test the standalone production Node server locally (the same entrypoint used in Docker):

```sh
npm run build
npm run start
```

`scripts/start.mjs` defaults to `HOST=127.0.0.1` and `PORT=4321` (override with `HOST` and `PORT`) and fails closed at boot if GitHub credentials are missing or invalid. If you use `GHCC_ALLOWED_HOSTS`, set it for both `npm run build` and `npm run start`.

### 5. Linting, formatting, typechecking, and unit tests

```sh
npm run lint          # Oxlint
npm run format:check  # Oxfmt check (run `npm run format` to auto-format)
npm run typecheck     # Astro check + vue-tsc
npm run test          # Vitest unit & component suite (mocked, no GitHub API calls)
```

Run a single test file:

```sh
npm run test -- src/components/DashboardApp.spec.ts
```

### 6. End-to-End Tests (Playwright)

Install the Playwright Chromium browser once (add `--with-deps` on Linux):

```sh
./node_modules/.bin/playwright install chromium
```

Run the browser suite against a production build with mocked fixtures:

```sh
npm run test:e2e
```

Playwright builds the app and starts `node scripts/start.mjs` on `http://127.0.0.1:4330` with `GHCC_SKIP_BOOT_CHECK=1`. Tests intercept `/api/snapshot` with local fixtures, so no GitHub credentials are required.

---

## Keyboard Shortcuts

- `Cmd+K` / `Ctrl+K` — open the command palette
- `j` / `k` — move focus down / up across the action queue
- `Enter` — open pull request details in the inspector
- `x` — toggle bulk selection on the focused pull request
- `o` — open the focused or selected pull request on GitHub
- `p` — pin or unpin the focused or selected pull request
- `z` — snooze or unsnooze the focused or selected pull request
- `r` — trigger a manual refresh (10s cooldown)
- `/` — focus the search input
- `Esc` — close the inspector, clear/blur search, or clear active filters
- In fullscreen Mermaid diagram view: `+` / `-` to zoom, `0` to fit to viewport, `Esc` to close

## API Routes

- `GET /api/health` — verifies GitHub auth status, active login, and token source (`gh-cli` or `env`)
- `GET /api/snapshot` — returns normalized pull request buckets, counts, rate limits, and warnings (supports `ETag` / `304`, `?wait=1` for in-flight refreshes, and `X-GHCC-Refreshing: 1`)
- `POST /api/refresh` — forces a snapshot refresh (same-origin protected, 10s cooldown)
- `GET /api/pull/{owner}/{repo}/{number}` — loads sanitized PR description HTML/excerpt, full checks (up to 100), reviewers, and last 5 timeline items for the inspector
- `POST /api/pull/{owner}/{repo}/{number}/update-branch` — merges the base branch into a behind pull request branch via GitHub's `update-branch` API (same-origin protected)
- `POST /api/pull/{owner}/{repo}/{number}/draft` — converts a pull request to draft or marks it ready for review via GitHub GraphQL (same-origin protected)
- `GET /api/repo/{owner}/{repo}/labels` — lists repository labels (name, hex color, description) for the label picker
- `POST /api/pull/{owner}/{repo}/{number}/labels` — sets pull request labels via GitHub's issues labels API (same-origin protected)
- `POST /api/pull/{owner}/{repo}/{number}/merge` — merges a pull request via GitHub's merge API (`squash` by default or `merge` commit, same-origin protected)
- `POST /api/pull/{owner}/{repo}/{number}/rerun-failed` — re-runs failed GitHub Actions workflow runs for the pull request head commit or a specific failed Actions job/run (same-origin protected)
- `GET /api/pull/{owner}/{repo}/{number}/checks/{checkRunId}/summary` — loads check run output, annotations (up to 25), and bounded plain-text GitHub Actions job log excerpts on demand for failing checks in the inspector
- `POST /api/pull/{owner}/{repo}/{number}/triage` — pins, unpins, snoozes (by time, next push, CI change, or activity), or unsnoozes a pull request in local `.cache/state.json` (same-origin protected)
- `POST /api/pull/{owner}/{repo}/{number}/review` — submits a quick review (`APPROVE`, `COMMENT`, or `REQUEST_CHANGES`, same-origin protected)
- `POST /api/pull/{owner}/{repo}/{number}/threads/{threadId}/reply` — posts a reply to a pull request review thread (same-origin protected)
- `POST /api/pull/{owner}/{repo}/{number}/threads/{threadId}/resolve` — resolves or reopens a pull request review thread (same-origin protected)
- `GET /api/repo/{owner}/{repo}/reviewers` — lists assignable repository reviewers (cached 5 minutes per repository)
- `POST /api/pull/{owner}/{repo}/{number}/reviewers` — requests or removes pull request reviewers (same-origin protected)
- `GET` / `POST` / `DELETE /api/presets` — lists, saves, and deletes named filter presets in local `.cache/state.json` (mutations same-origin protected)

## Troubleshooting

- **Container fails healthcheck or exits immediately**: Run `docker compose logs` to see the boot-check error. The most common cause is an unset or expired `GH_TOKEN` (remember `gh` CLI is not available inside the container).
- **Port `4321` already in use**: Check whether the other mode (Docker vs `npm run dev` / `npm run start`) is still running (`docker compose ps` or `./node_modules/.bin/astro dev status`), or start with a different `PORT`.
- **Organization PRs are missing or show an SSO warning**: Authorize your Classic PAT for SAML SSO in GitHub settings, or scope/approve your Fine-grained PAT for that organization.
- **`403` error on `Refresh`, `Sync`, `Draft`, `Labels`, or `Merge` behind a reverse proxy**: Ensure the proxy forwards `Host` / `X-Forwarded-Host` matching the browser's `Origin`. If you set `GHCC_ALLOWED_HOSTS`, include the public hostname and rebuild the Docker image (`docker compose up -d --build --wait`).

## License

MIT — see [LICENSE](LICENSE).
