// diffwall server entry: CLI parsing, an http server bound to loopback only,
// the JSON API, and (in production) static serving of the built web assets.
// No framework — node:http and the stdlib only. Never interpolates a shell.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DiffResponse,
  FileResponse,
  HealthResponse,
  OpenResponse,
  RefsResponse,
} from "../shared/types.js";
import { listRefs, refExists, repoRoot as resolveRepoRoot } from "./git.js";
import { buildDiffResponse, buildFileResponse, type BuildOptions } from "./buildDiff.js";

interface Cli {
  base: string;
  port: number;
  interval: number;
  context: number;
  untracked: boolean;
  theme: string;
  open: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    base: "HEAD",
    port: 7777,
    interval: 2000,
    context: 3,
    untracked: true,
    theme: "one-dark-pro",
    open: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`missing value for ${a}`);
        process.exit(2);
      }
      return v;
    };
    switch (a) {
      case "--base":
        cli.base = next();
        break;
      case "--port":
        cli.port = parseInt(next(), 10);
        break;
      case "--interval":
        cli.interval = parseInt(next(), 10);
        break;
      case "--context":
        cli.context = parseInt(next(), 10);
        break;
      case "--no-untracked":
        cli.untracked = false;
        break;
      case "--theme":
        cli.theme = next();
        break;
      case "--open":
        cli.open = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`unknown argument: ${a}`);
        printHelp();
        process.exit(2);
    }
  }
  return cli;
}

function printHelp(): void {
  console.log(
    `diffwall [--base <ref>] [--port 7777] [--interval 2000]
         [--context 3] [--no-untracked] [--theme one-dark-pro] [--open]`,
  );
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// In production the built web assets sit at dist/web relative to dist/server.
const WEB_DIST = resolve(__dirname, "..", "web");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** True if `abs` is the repo root or lives inside it. Blocks path traversal. */
function insideRepo(root: string, abs: string): boolean {
  const r = resolve(root);
  const a = resolve(abs);
  return a === r || a.startsWith(r + sep);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  // Normalize and confine to WEB_DIST.
  const clean = urlPath === "/" ? "/index.html" : urlPath;
  const abs = resolve(join(WEB_DIST, "." + clean));
  if (abs !== WEB_DIST && !abs.startsWith(WEB_DIST + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const buf = await readFile(abs);
    res.writeHead(200, {
      "content-type": MIME[extname(abs)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(buf);
  } catch {
    // SPA fallback: serve index.html for unknown non-API routes.
    try {
      const buf = await readFile(join(WEB_DIST, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(buf);
    } catch {
      res.writeHead(404).end("not found");
    }
  }
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));

  let root: string;
  try {
    root = await resolveRepoRoot(process.cwd());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const server = createServer((req, res) => {
    handle(req, res, cli, root).catch((err) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  server.listen(cli.port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${cli.port}`;
    console.log(`diffwall serving ${root}`);
    console.log(`  base=${cli.base} interval=${cli.interval}ms context=${cli.context}`);
    console.log(`  ${url}`);
    if (cli.open) openBrowser(url);
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  cli: Cli,
  root: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  if (path === "/api/health") {
    const body: HealthResponse = { ok: true, repo: root, pid: process.pid };
    sendJson(res, 200, body);
    return;
  }

  if (path === "/api/refs") {
    const refs = await listRefs(root);
    const body: RefsResponse = refs;
    sendJson(res, 200, body);
    return;
  }

  if (path === "/api/diff") {
    const base = url.searchParams.get("base") ?? cli.base;
    const context = clampInt(url.searchParams.get("context"), cli.context, 0, 50);
    const untracked =
      url.searchParams.get("untracked") == null
        ? cli.untracked
        : url.searchParams.get("untracked") === "1";
    const whitespace = url.searchParams.get("ws") === "1";

    if (base !== "HEAD" && !(await refExists(root, base))) {
      sendJson(res, 400, { error: `base ref does not resolve: ${base}` });
      return;
    }
    const opts: BuildOptions = {
      repoRoot: root,
      base,
      context,
      untracked,
      whitespace,
      theme: cli.theme,
    };
    const body: DiffResponse = await buildDiffResponse(opts);
    sendJson(res, 200, body);
    return;
  }

  if (path === "/api/file") {
    const rel = url.searchParams.get("path");
    if (!rel) {
      sendJson(res, 400, { error: "missing path" });
      return;
    }
    const abs = resolve(join(root, rel));
    if (!insideRepo(root, abs)) {
      sendJson(res, 400, { error: "path escapes repository" });
      return;
    }
    const base = url.searchParams.get("base") ?? cli.base;
    const side = url.searchParams.get("side") === "old" ? "old" : "new";
    const context = clampInt(url.searchParams.get("context"), cli.context, 0, 50);
    if (base !== "HEAD" && !(await refExists(root, base))) {
      sendJson(res, 400, { error: `base ref does not resolve: ${base}` });
      return;
    }
    const opts: BuildOptions = {
      repoRoot: root,
      base,
      context,
      untracked: cli.untracked,
      whitespace: false,
      theme: cli.theme,
    };
    const body: FileResponse = await buildFileResponse(opts, rel, side);
    sendJson(res, 200, body);
    return;
  }

  if (path === "/api/open" && req.method === "POST") {
    let parsed: { path?: unknown; line?: unknown };
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 200, { ok: false, error: "invalid body" } satisfies OpenResponse);
      return;
    }
    const rel = typeof parsed.path === "string" ? parsed.path : "";
    const line = typeof parsed.line === "number" ? parsed.line : 1;
    const abs = resolve(join(root, rel));
    if (!rel || !insideRepo(root, abs)) {
      sendJson(res, 200, {
        ok: false,
        error: "path escapes repository",
      } satisfies OpenResponse);
      return;
    }
    openInVsCode(abs, line, (ok, error) => {
      sendJson(res, 200, { ok, error } satisfies OpenResponse);
    });
    return;
  }

  if (path.startsWith("/api/")) {
    sendJson(res, 404, { error: "no such endpoint" });
    return;
  }

  // Static assets (production). In dev, Vite serves these and proxies /api here.
  await serveStatic(res, path);
}

function clampInt(v: string | null, dflt: number, lo: number, hi: number): number {
  if (v == null) return dflt;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function openInVsCode(
  abs: string,
  line: number,
  cb: (ok: boolean, error?: string) => void,
): void {
  // Fallback path only; the primary mechanism is a vscode:// URI in the browser.
  execFile("code", ["-g", `${abs}:${line}`], (err) => {
    if (err) cb(false, err.message);
    else cb(true);
  });
}

function openBrowser(url: string): void {
  execFile("xdg-open", [url], () => {
    /* best effort; ignore failure */
  });
}

main();
