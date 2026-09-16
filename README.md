# diffwall

![preview](preview.png)

A local, browser-based, read-only diff wall. Shows every changed file in a git
repo as a pane, tiled across a large screen, refreshing itself while coding
agents work. It can watch one repository or several repositories in one
workspace.

Read-only: it reads git and the working tree and never writes to the repo. It is
immune to *how* an edit was made — `sed`, a heredoc, an editor, or an agent all
show up identically, and untracked files appear without `git add`.

## Requirements

- **Node 20+** (pinned in `.nvmrc` and `engines`). Use `nvm use` to match.
- `git` on `PATH`.
- Windows, Linux, or macOS.

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

Launch it from inside a Git repository:

```bash
node dist/server/index.js [options]      # after `npm run build`
```

When launched inside a Git repository, Diffwall uses that repository directly.
When launched from a non-Git directory, it recursively discovers Git roots
under that directory and shows a browser setup screen. Select one or more
repositories; each selected repository gets an in-app tab. Discovery is
session-only and skips dependency/build directories.

Options:

```
--base <ref>        base to diff against (default HEAD = uncommitted changes)
--port <n>          default 7777
--interval <ms>     poll interval hint for the UI (default 2000)
--context <n>       diff context lines (default 3)
--no-untracked      hide untracked files
--theme <name>      one-dark-pro (default), github-dark, github-light
--open              open the browser via the platform default
```

The server binds `127.0.0.1` only and makes no outbound requests at runtime.

### VS Code Remote SSH

Run Diffwall on the SSH host from the parent directory containing the
repositories:

```bash
cd ~/projects
node ~/diffwall/dist/server/index.js --port 7777
```

Forward port `7777` in VS Code's **Ports** panel and open the forwarded local
URL. The setup screen will list the Git roots under `~/projects`, and selected
repositories appear as tabs. Git commands and file reads stay on the SSH host;
the browser only receives the forwarded HTTP connection.

### Apptainer on the SSH host

Apptainer can package Node, Git, dependencies, and the built application into
one image. Build the image from the repository directory:

```bash
apptainer build diffwall.sif apptainer/diffwall.def
```

Then run it against a host directory containing one or more repositories:

```bash
bash apptainer/run-diffwall.sh \
  diffwall.sif "$HOME/projects" 7777
```

The workspace is mounted read-only at `/workspace`; agent processes on the host
can continue editing the real files and Diffwall will see those changes.
Forward port `7777` in VS Code's **Ports** panel. The image does not need
Internet access while running. Internet access is normally needed once while
building the image so the base image and npm packages can be downloaded.
Only the workspace directory is exposed to the container; do not bind the
entire host filesystem.

## Development

```bash
npm run dev:server   # tsc build + node --watch on the compiled server
npm run dev:web      # vite dev server, proxies /api to the node server
```

## API (for reference / curl testing)

- `GET /api/workspace` — discovered repositories and setup status.
- `GET /api/health` — liveness and repository registry.
- `GET /api/diff?repo=<id>&base=<ref>&context=<n>&untracked=<0|1>&ws=<0|1>` — the wall.
- `GET /api/file?repo=<id>&path=<p>&base=<ref>&side=<new|old>` — full-file view.
- `POST /api/open` `{ "repoId", "path", "line" }` — local VS Code fallback.

## Security posture

- Binds loopback only, never `0.0.0.0`.
- `execFile` with argv arrays only — no shell, ever.
- `--base` validated with `git rev-parse --verify` before use.
- `/api/file` and `/api/open` reject any path that resolves outside the selected repo.
- Repository selection is limited to Git roots discovered beneath the launch directory.
- Shiki grammars ship with the package; no network at runtime.

## Known limitations

- **Multi-line C++ raw strings with a fake interior delimiter.** Shiki's C++
  grammar can lose the real terminator of a raw string that spans multiple lines
  *and* contains a line resembling its own closing delimiter, coloring the rest
  of the file as string. This is an upstream TextMate-grammar limitation
  (reproducible with a bare Shiki call), not a diffwall bug. Single-line raw
  strings, block comments, and nested template angle brackets all highlight
  correctly.

## Dependencies

Runtime: `shiki` (highlighting), `react` + `react-dom` (reconciliation),
`markdown-it` (rendered Markdown view) and `mermaid` (diagrams in Markdown).
Everything else server-side is Node stdlib. Dev: `vite`,
`@vitejs/plugin-react`, `typescript`, `@types/*`.

`mermaid` is large — it pulls ~156 transitive packages, well above the tree's
original footprint, which is a deliberate exception to the strict dependency
policy made because rendered `.md` + diagrams is a wanted feature. It is
**lazy-loaded**: `import("mermaid")` is dynamic, so Vite code-splits it into
its own chunks that load only when a Markdown file with a ```mermaid block is
actually viewed — a repo with no such files never downloads it. `markdown-it`
runs with raw HTML disabled, so untrusted repo Markdown can't inject tags.
Nothing else is added without a deliberate review of its transitive tree.
