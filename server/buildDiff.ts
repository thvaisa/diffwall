// Assembles the /api/diff and /api/file payloads: runs git, parses the diff,
// highlights whole files, and maps highlighted lines back onto diff lines by
// number. Enforces the file-count and per-file line caps, and never fails the
// whole response over one file — a bad file gets an `error` field instead.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  DiffLine,
  DiffResponse,
  FileDiff,
  FileResponse,
  FileStatus,
  Hunk,
} from "../shared/types.js";
import {
  decodeUtf8,
  diffFile,
  diffUntracked,
  nameStatus,
  numstat,
  repoState,
  shortHead,
  showOld,
  untrackedFiles,
  type NameStatusEntry,
  type NumstatEntry,
} from "./git.js";
import { parseUnifiedDiff, toApiHunks } from "./diff.js";
import { highlightFile, langLabel } from "./highlight.js";

const MAX_FILES = 400;
const MAX_DIFF_LINES_PER_FILE = 2000;
const MAX_FULL_FILE_LINES = 20000;

export interface BuildOptions {
  repoRoot: string;
  base: string;
  context: number;
  untracked: boolean;
  whitespace: boolean;
  theme: string;
}

function statusFromCode(code: string): FileStatus {
  const c = code[0];
  switch (c) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "T":
      return "typechange";
    case "M":
    default:
      return "modified";
  }
}

/** Map highlighted whole-file lines onto the diff's raw lines by line number. */
function applyHighlight(
  hunks: Hunk[],
  newLines: string[] | null,
  oldLines: string[] | null,
): void {
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.kind === "del") {
        const hi = line.old != null && oldLines ? oldLines[line.old - 1] : undefined;
        line.html = hi ?? escapeHtml(line.html);
      } else {
        const hi = line.new != null && newLines ? newLines[line.new - 1] : undefined;
        line.html = hi ?? escapeHtml(line.html);
      }
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function readNewContent(
  repoRoot: string,
  path: string,
): Promise<string | null> {
  try {
    const buf = await readFile(join(repoRoot, path));
    return decodeUtf8(buf);
  } catch {
    return null;
  }
}

async function buildOneFile(
  opts: BuildOptions,
  entry: {
    path: string;
    oldPath: string | null;
    status: FileStatus;
    added: number;
    removed: number;
  },
  untracked: boolean,
): Promise<FileDiff> {
  const { repoRoot, base, context, whitespace, theme } = opts;
  const absPath = join(repoRoot, entry.path);
  const lang = langLabel(entry.path);
  const binaryNumstat = entry.added < 0 || entry.removed < 0;

  const fd: FileDiff = {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    added: binaryNumstat ? 0 : entry.added,
    removed: binaryNumstat ? 0 : entry.removed,
    binary: binaryNumstat,
    truncated: false,
    hash: "",
    lang,
    newLineCount: null,
    hunks: [],
    absPath,
  };

  try {
    const rawDiff = untracked
      ? await diffUntracked(repoRoot, entry.path, context, whitespace)
      : await diffFile(repoRoot, base, entry.path, context, whitespace);

    fd.hash = createHash("sha1").update(rawDiff).digest("hex");

    const parsed = parseUnifiedDiff(rawDiff, MAX_DIFF_LINES_PER_FILE);
    fd.binary = fd.binary || parsed.binary;
    fd.truncated = parsed.truncated;

    if (fd.binary) {
      return fd;
    }

    const apiHunks = toApiHunks(parsed.hunks);

    // Untracked files never appear in numstat, so their counts arrive as 0.
    // Derive them from the synthesized diff so totals include new files.
    if (untracked) {
      let add = 0;
      let del = 0;
      for (const h of apiHunks) {
        for (const l of h.lines) {
          if (l.kind === "add") add++;
          else if (l.kind === "del") del++;
        }
      }
      fd.added = add;
      fd.removed = del;
    }

    // Highlight whole files for correct grammar context.
    let newLines: string[] | null = null;
    let oldLines: string[] | null = null;

    if (entry.status !== "deleted") {
      const newContent = await readNewContent(repoRoot, entry.path);
      if (newContent != null) {
        fd.newLineCount = newContent.length === 0 ? 0 : newContent.split("\n").length;
        newLines = await highlightFile(newContent, entry.path, theme);
      }
    }
    if (entry.status !== "added" && entry.status !== "untracked" && !untracked) {
      const oldRef = base;
      const oldContent = await showOld(
        repoRoot,
        oldRef,
        entry.oldPath ?? entry.path,
      );
      if (oldContent != null) {
        oldLines = await highlightFile(oldContent, entry.oldPath ?? entry.path, theme);
      }
    }

    applyHighlight(apiHunks, newLines, oldLines);
    fd.hunks = apiHunks;
    return fd;
  } catch (err) {
    fd.error = err instanceof Error ? err.message : String(err);
    return fd;
  }
}

export async function buildDiffResponse(opts: BuildOptions): Promise<DiffResponse> {
  const { repoRoot, base } = opts;
  const [head, state] = await Promise.all([
    shortHead(repoRoot),
    repoState(repoRoot),
  ]);

  // Tracked changes: join numstat (counts) with name-status (status + rename).
  let numstatEntries: NumstatEntry[] = [];
  let nameStatusEntries: NameStatusEntry[] = [];
  // On an empty repo, HEAD does not resolve; base may be unusable. Guard.
  if (head !== null || base !== "HEAD") {
    try {
      [numstatEntries, nameStatusEntries] = await Promise.all([
        numstat(repoRoot, base),
        nameStatus(repoRoot, base),
      ]);
    } catch {
      // e.g. empty repo with base=HEAD — treat as no tracked diff.
      numstatEntries = [];
      nameStatusEntries = [];
    }
  }

  const numByPath = new Map<string, NumstatEntry>();
  for (const n of numstatEntries) numByPath.set(n.path, n);

  interface Entry {
    path: string;
    oldPath: string | null;
    status: FileStatus;
    added: number;
    removed: number;
    untracked: boolean;
  }
  const entries: Entry[] = [];

  for (const ns of nameStatusEntries) {
    const num = numByPath.get(ns.path);
    entries.push({
      path: ns.path,
      oldPath: ns.oldPath,
      status: statusFromCode(ns.status),
      added: num?.added ?? 0,
      removed: num?.removed ?? 0,
      untracked: false,
    });
  }

  if (opts.untracked) {
    const others = await untrackedFiles(repoRoot);
    for (const p of others) {
      entries.push({
        path: p,
        oldPath: null,
        status: "untracked",
        added: 0,
        removed: 0,
        untracked: true,
      });
    }
  }

  // Stable order by path; cap the file set.
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const truncated = entries.length > MAX_FILES;
  const capped = truncated ? entries.slice(0, MAX_FILES) : entries;

  const files = await Promise.all(
    capped.map((e) =>
      buildOneFile(
        opts,
        {
          path: e.path,
          oldPath: e.oldPath,
          status: e.status,
          added: e.added,
          removed: e.removed,
        },
        e.untracked,
      ),
    ),
  );

  let totalAdded = 0;
  let totalRemoved = 0;
  for (const f of files) {
    totalAdded += f.added;
    totalRemoved += f.removed;
  }

  return {
    repo: repoRoot,
    base,
    head,
    generatedAt: Date.now(),
    totals: { files: files.length, added: totalAdded, removed: totalRemoved },
    state,
    truncated,
    files,
  };
}

// ---- Full-file view -----------------------------------------------------------

/**
 * Build the whole-file view: every line of the file, highlighted, annotated with
 * its diff state (ctx/add/del) by splicing deleted lines into the new content at
 * their diff positions. Caps at MAX_FULL_FILE_LINES.
 */
export async function buildFileResponse(
  opts: BuildOptions,
  path: string,
  side: "new" | "old",
): Promise<FileResponse> {
  const { repoRoot, base, context, whitespace, theme } = opts;
  const lang = langLabel(path);

  // For the old side (deleted file view) just render old content straight.
  if (side === "old") {
    const oldContent = (await showOld(repoRoot, base, path)) ?? "";
    const cap = capLines(oldContent, MAX_FULL_FILE_LINES);
    const hi = await highlightFile(cap.content, path, theme);
    const lines: DiffLine[] = hi.map((html, i) => ({
      kind: "ctx",
      old: i + 1,
      new: null,
      html,
    }));
    return { path, lang, truncated: cap.truncated, lines };
  }

  // New side: whole new file, with deleted lines spliced in at diff positions.
  const newContent = (await readNewContent(repoRoot, path)) ?? "";
  const cap = capLines(newContent, MAX_FULL_FILE_LINES);
  const newHi = await highlightFile(cap.content, path, theme);

  // Diff to learn which new lines are additions and where deletions sit.
  let rawDiff = "";
  try {
    rawDiff = await diffFile(repoRoot, base, path, context, whitespace);
  } catch {
    rawDiff = "";
  }
  const parsed = parseUnifiedDiff(rawDiff, Number.MAX_SAFE_INTEGER);

  // Classify each new-file line and collect deletions keyed by the new line
  // number they should appear *before*.
  const addedNew = new Set<number>();
  const delsBefore = new Map<number, { old: number; text: string }[]>();
  for (const h of parsed.hunks) {
    let pendingDels: { old: number; text: string }[] = [];
    for (const l of h.lines) {
      if (l.kind === "add") {
        if (l.new != null) addedNew.add(l.new);
        // A deletion block immediately followed by adds attaches before the add.
        if (pendingDels.length && l.new != null) {
          const arr = delsBefore.get(l.new) ?? [];
          arr.push(...pendingDels);
          delsBefore.set(l.new, arr);
          pendingDels = [];
        }
      } else if (l.kind === "del") {
        if (l.old != null) pendingDels.push({ old: l.old, text: l.text });
      } else {
        // ctx: flush pending dels before this context line's new number.
        if (pendingDels.length && l.new != null) {
          const arr = delsBefore.get(l.new) ?? [];
          arr.push(...pendingDels);
          delsBefore.set(l.new, arr);
          pendingDels = [];
        }
      }
    }
    // Trailing deletions at end of hunk: attach after the last new line.
    if (pendingDels.length) {
      const after = (parsed.hunks, Number.MAX_SAFE_INTEGER);
      const arr = delsBefore.get(after) ?? [];
      arr.push(...pendingDels);
      delsBefore.set(after, arr);
    }
  }

  // Highlight old content once for deleted-line HTML.
  const oldContent = await showOld(repoRoot, base, path);
  const oldHi = oldContent != null ? await highlightFile(oldContent, path, theme) : null;

  const lines: DiffLine[] = [];
  for (let n = 1; n <= newHi.length; n++) {
    // Splice any deletions that belong before this new line.
    const dels = delsBefore.get(n);
    if (dels) {
      for (const d of dels) {
        lines.push({
          kind: "del",
          old: d.old,
          new: null,
          html: (oldHi && oldHi[d.old - 1]) ?? escapeHtml(d.text),
        });
      }
    }
    lines.push({
      kind: addedNew.has(n) ? "add" : "ctx",
      // TODO(M4): track true old-side numbering across the whole file. For diff
      // view (M1) old numbers come straight from the hunk and are exact; this
      // approximation only affects full-file view's context gutter.
      old: addedNew.has(n) ? null : n,
      new: n,
      html: newHi[n - 1] ?? "",
    });
  }
  // Trailing deletions.
  const trailing = delsBefore.get(Number.MAX_SAFE_INTEGER);
  if (trailing) {
    for (const d of trailing) {
      lines.push({
        kind: "del",
        old: d.old,
        new: null,
        html: (oldHi && oldHi[d.old - 1]) ?? escapeHtml(d.text),
      });
    }
  }

  return { path, lang, truncated: cap.truncated, lines };
}

function capLines(content: string, max: number): { content: string; truncated: boolean } {
  const lines = content.split("\n");
  if (lines.length <= max) return { content, truncated: false };
  return { content: lines.slice(0, max).join("\n"), truncated: true };
}
