# diffwall

A local, browser-based, read-only diff wall. Shows every changed file in a git
repo as a pane, tiled across a large screen, refreshing itself while coding
agents work. Local Linux only — repo, agents, server, and browser on one box.

Read-only: it reads git and the working tree and never writes to the repo. It is
immune to *how* an edit was made — `sed`, a heredoc, an editor, or an agent all
show up identically, and untracked files appear without `git add`.

## Requirements

- **Node 20+** (pinned in `.nvmrc` and `engines`). Use `nvm use` to match.
- `git` on `PATH`.
- Linux. No Windows or remote support by design.

## Install

Exact, reproducible install from a clean checkout:

```bash
nvm use            # or otherwise ensure Node 20+
npm ci             # NOT `npm install` — ci fails if the lockfile disagrees
npm run build      # builds server (tsc) and web (vite)
```

`.npmrc` sets `save-exact=true` and `ignore-scripts=true`; all versions are
pinned exactly and `package-lock.json` is committed. No package requires a
postinstall script.

## Run

From anywhere inside a git repository:

```bash
node dist/server/index.js [options]      # after `npm run build`
```

Options:

```
--base <ref>        base to diff against (default HEAD = uncommitted changes)
--port <n>          default 7777
--interval <ms>     poll interval hint for the UI (default 2000)
--context <n>       diff context lines (default 3)
--no-untracked      hide untracked files
--theme <name>      one-dark-pro (default), github-dark, github-light
--open              open the browser via xdg-open
```

The server binds `127.0.0.1` only and makes no outbound requests at runtime.

## Development

```bash
npm run dev:server   # tsc build + node --watch on the compiled server
npm run dev:web      # vite dev server, proxies /api to the node server
```

## API (for reference / curl testing)

- `GET /api/health` — liveness + repo root.
- `GET /api/diff?base=<ref>&context=<n>&untracked=<0|1>&ws=<0|1>` — the wall.
- `GET /api/file?path=<p>&base=<ref>&side=<new|old>` — full-file view.
- `POST /api/open` `{ "path", "line" }` — VS Code fallback (primary is a
  `vscode://file/...` link built into the payload).

## Security posture

- Binds loopback only, never `0.0.0.0`.
- `execFile` with argv arrays only — no shell, ever.
- `--base` validated with `git rev-parse --verify` before use.
- `/api/file` and `/api/open` reject any path that resolves outside the repo.
- Shiki grammars ship with the package; no network at runtime.

## Dependencies

Runtime: `shiki` (highlighting), `react` + `react-dom` (reconciliation).
Everything else server-side is Node stdlib. Dev: `vite`,
`@vitejs/plugin-react`, `typescript`, `@types/*`. Nothing is added without a
deliberate review of its transitive tree.
