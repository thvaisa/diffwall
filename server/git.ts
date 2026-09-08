// All git access lives here. Every call uses execFile with an argv array —
// never a shell string — and is prefixed with `-c core.quotepath=false` so git
// does not octal-escape non-ASCII paths. Always --no-color, always `--` before
// paths, always -z where the porcelain supports it.

import { execFile } from "node:child_process";
import type { RepoState } from "../shared/types.js";

const MAX_BUFFER = 64 * 1024 * 1024; // 64 MiB; large diffs must not truncate silently.

export interface GitResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

/**
 * Run git in `cwd`. Resolves with the result even on a non-zero exit — many git
 * commands (e.g. `diff --no-index`) use exit code 1 to mean "there is a diff",
 * which is success for us. Only a failure to spawn rejects.
 */
export function git(cwd: string, args: string[]): Promise<GitResult> {
  const full = ["-c", "core.quotepath=false", ...args];
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      full,
      { cwd, maxBuffer: MAX_BUFFER, encoding: "buffer" },
      (err, stdout, stderr) => {
        const out = stdout as unknown as Buffer;
        const errStr = (stderr as unknown as Buffer).toString("utf8");
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("git executable not found on PATH"));
          return;
        }
        // execFile sets err on non-zero exit; recover the code from it.
        const code =
          err && typeof (err as { code?: unknown }).code === "number"
            ? ((err as { code: number }).code)
            : err
              ? 1
              : 0;
        resolve({ stdout: out, stderr: errStr, code });
      },
    );
  });
}

/** git that throws on non-zero exit — for commands where failure is real. */
async function gitOrThrow(cwd: string, args: string[]): Promise<GitResult> {
  const r = await git(cwd, args);
  if (r.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${r.code}): ${r.stderr.trim()}`,
    );
  }
  return r;
}

/** Resolve the repository root (worktree top-level). Throws if not a repo. */
export async function repoRoot(cwd: string): Promise<string> {
  const r = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (r.code !== 0) {
    throw new Error(`not inside a git repository: ${cwd}`);
  }
  return r.stdout.toString("utf8").trim();
}

/** Short HEAD hash, or null when HEAD does not resolve (empty repo). */
export async function shortHead(cwd: string): Promise<string | null> {
  const r = await git(cwd, ["rev-parse", "--short", "HEAD"]);
  if (r.code !== 0) return null;
  return r.stdout.toString("utf8").trim() || null;
}

/** True if a ref resolves. Used to validate the --base value before use. */
export async function refExists(cwd: string, ref: string): Promise<boolean> {
  const r = await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return r.code === 0;
}

/** Detect an in-progress merge/rebase/cherry-pick and the branch/detached state. */
export async function repoState(cwd: string): Promise<RepoState> {
  const gitDirRes = await git(cwd, ["rev-parse", "--git-dir"]);
  const gitDir = gitDirRes.code === 0 ? gitDirRes.stdout.toString("utf8").trim() : null;

  let operation: string | null = null;
  if (gitDir) {
    const { existsSync } = await import("node:fs");
    const { join, isAbsolute } = await import("node:path");
    const abs = isAbsolute(gitDir) ? gitDir : join(cwd, gitDir);
    if (existsSync(join(abs, "MERGE_HEAD"))) operation = "merge";
    else if (
      existsSync(join(abs, "rebase-merge")) ||
      existsSync(join(abs, "rebase-apply"))
    )
      operation = "rebase";
    else if (existsSync(join(abs, "CHERRY_PICK_HEAD"))) operation = "cherry-pick";
    else if (existsSync(join(abs, "REVERT_HEAD"))) operation = "revert";
  }

  // Branch name, or detached-HEAD detection.
  const branchRes = await git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const detachedHead = branchRes.code !== 0;
  const branch = detachedHead ? null : branchRes.stdout.toString("utf8").trim();

  return {
    midOperation: operation !== null,
    operation,
    detachedHead,
    branch,
  };
}

export interface RefList {
  branches: string[];
  tags: string[];
  head: string; // always available: diff against the last commit
}

/**
 * List local branches and tags for the base picker. Read-only. `HEAD` is always
 * offered. Sorted by most-recent commit so the active branches surface first.
 */
export async function listRefs(cwd: string): Promise<RefList> {
  const branchesRes = await git(cwd, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  const tagsRes = await git(cwd, [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)",
    "refs/tags",
  ]);
  const split = (r: GitResult): string[] =>
    r.code === 0
      ? r.stdout
          .toString("utf8")
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : [];
  return { branches: split(branchesRes), tags: split(tagsRes), head: "HEAD" };
}

// ---- Raw diff / numstat / name-status collection ------------------------------

export interface NumstatEntry {
  added: number; // -1 for binary
  removed: number; // -1 for binary
  path: string;
  oldPath: string | null;
}

/**
 * `git diff --numstat -z` with rename detection. The -z format separates fields
 * by NUL; for renames the old and new path are two extra NUL-terminated fields.
 */
export async function numstat(cwd: string, base: string): Promise<NumstatEntry[]> {
  const r = await gitOrThrow(cwd, [
    "diff",
    "--numstat",
    "-z",
    "--find-renames",
    base,
    "--",
  ]);
  return parseNumstatZ(r.stdout.toString("utf8"));
}

export function parseNumstatZ(text: string): NumstatEntry[] {
  const out: NumstatEntry[] = [];
  const fields = text.split("\0");
  let i = 0;
  while (i < fields.length) {
    const rec = fields[i];
    if (rec === undefined || rec === "") {
      i++;
      continue;
    }
    // Each record: "added\tremoved\t<path>" OR, for renames,
    // "added\tremoved\t" then oldPath (next field) then newPath (field after).
    const tab1 = rec.indexOf("\t");
    const tab2 = rec.indexOf("\t", tab1 + 1);
    if (tab1 < 0 || tab2 < 0) {
      i++;
      continue;
    }
    const addedStr = rec.slice(0, tab1);
    const removedStr = rec.slice(tab1 + 1, tab2);
    const rest = rec.slice(tab2 + 1);
    const added = addedStr === "-" ? -1 : parseInt(addedStr, 10);
    const removed = removedStr === "-" ? -1 : parseInt(removedStr, 10);

    if (rest === "") {
      // Rename/copy: old path and new path follow as separate NUL fields.
      const oldPath = fields[i + 1] ?? "";
      const newPath = fields[i + 2] ?? "";
      out.push({ added, removed, path: newPath, oldPath });
      i += 3;
    } else {
      out.push({ added, removed, path: rest, oldPath: null });
      i += 1;
    }
  }
  return out;
}

export interface NameStatusEntry {
  status: string; // M, A, D, R100, C75, T, ...
  path: string;
  oldPath: string | null;
}

export async function nameStatus(
  cwd: string,
  base: string,
): Promise<NameStatusEntry[]> {
  const r = await gitOrThrow(cwd, [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    base,
    "--",
  ]);
  return parseNameStatusZ(r.stdout.toString("utf8"));
}

export function parseNameStatusZ(text: string): NameStatusEntry[] {
  const out: NameStatusEntry[] = [];
  const fields = text.split("\0");
  let i = 0;
  while (i < fields.length) {
    const status = fields[i];
    if (status === undefined || status === "") {
      i++;
      continue;
    }
    const code = status[0];
    if (code === "R" || code === "C") {
      const oldPath = fields[i + 1] ?? "";
      const newPath = fields[i + 2] ?? "";
      out.push({ status, path: newPath, oldPath });
      i += 3;
    } else {
      const path = fields[i + 1] ?? "";
      out.push({ status, path, oldPath: null });
      i += 2;
    }
  }
  return out;
}

/** Untracked, non-ignored files. */
export async function untrackedFiles(cwd: string): Promise<string[]> {
  const r = await gitOrThrow(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  return r.stdout
    .toString("utf8")
    .split("\0")
    .filter((s) => s !== "");
}

/** Unified diff for one tracked path against base. */
export async function diffFile(
  cwd: string,
  base: string,
  path: string,
  context: number,
  whitespace: boolean,
): Promise<string> {
  const args = ["diff", "--no-color", `-U${context}`];
  if (whitespace) args.push("-w");
  args.push(base, "--", path);
  const r = await git(cwd, args);
  // diff returns 1 when there are differences — expected. Only >1 is an error.
  if (r.code > 1) {
    throw new Error(`git diff failed for ${path}: ${r.stderr.trim()}`);
  }
  return r.stdout.toString("utf8");
}

/** Unified diff for an untracked file, synthesized against /dev/null. */
export async function diffUntracked(
  cwd: string,
  path: string,
  context: number,
  whitespace: boolean,
): Promise<string> {
  const args = ["diff", "--no-color", "--no-index", `-U${context}`];
  if (whitespace) args.push("-w");
  args.push("/dev/null", "--", path);
  const r = await git(cwd, args);
  if (r.code > 1) {
    throw new Error(`git diff --no-index failed for ${path}: ${r.stderr.trim()}`);
  }
  return r.stdout.toString("utf8");
}

/** Old-side file content at base, for highlighting deletions. Null if absent. */
export async function showOld(
  cwd: string,
  base: string,
  path: string,
): Promise<string | null> {
  const r = await git(cwd, ["show", `${base}:${path}`]);
  if (r.code !== 0) return null;
  return decodeUtf8(r.stdout);
}

/** Decode a buffer as UTF-8, replacing invalid sequences rather than throwing. */
export function decodeUtf8(buf: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}
