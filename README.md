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

The server binds exclusively to `127.0.0.1` and fails closed at boot if `gh` is unauthenticated or its token is rejected.

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

## Checks

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test
```
