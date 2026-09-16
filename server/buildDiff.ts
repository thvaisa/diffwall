// Assembles the /api/diff and /api/file payloads: runs git, parses the diff,
// highlights whole files, and maps highlighted lines back onto diff lines by
// number. Enforces the file-count and per-file line caps, and never fails the
// whole response over one file — a bad file gets an `error` field instead.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FileStatus, LineKind } from "../shared/types.js";
import type {
  DiffLine,
  DiffResponse,
  FileDiff,
  FileResponse,
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
  repoId: string;
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
      return FileStatus.Added;
    case "D":
      return FileStatus.Deleted;
    case "R":
      return FileStatus.Renamed;
    case "T":
      return FileStatus.Typechange;
    case "M":
    default:
      return FileStatus.Modified;
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
      if (line.kind === LineKind.Del) {
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
          if (l.kind === LineKind.Add) add++;
          else if (l.kind === LineKind.Del) del++;
        }
      }
      fd.added = add;
      fd.removed = del;
    }

    // Symlinks and submodules: show git's one-line diff verbatim, never follow
    // the link or read the gitlink as text. Escape the raw hunk text as-is.
    if (parsed.special) {
      fd.special = parsed.special;
      for (const h of apiHunks) {
        for (const l of h.lines) l.html = escapeHtml(l.html);
      }
      fd.hunks = apiHunks;
      return fd;
    }

    // Highlight whole files for correct grammar context.
    let newLines: string[] | null = null;
    let oldLines: string[] | null = null;

    if (entry.status !== FileStatus.Deleted) {
      const newContent = await readNewContent(repoRoot, entry.path);
      if (newContent != null) {
        fd.newLineCount = newContent.length === 0 ? 0 : newContent.split("\n").length;
        newLines = await highlightFile(newContent, entry.path, theme);
      }
    }
    if (
      entry.status !== FileStatus.Added &&
      entry.status !== FileStatus.Untracked &&
      !untracked
    ) {
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
        status: FileStatus.Untracked,
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
    repoId: opts.repoId,
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
  const { repoRoot, base, whitespace, theme } = opts;
  const lang = langLabel(path);

  // For the old side (deleted file view) just render old content straight.
  if (side === "old") {
    const oldContent = (await showOld(repoRoot, base, path)) ?? "";
    const cap = capLines(oldContent, MAX_FULL_FILE_LINES);
    const hi = await highlightFile(cap.content, path, theme);
    const lines: DiffLine[] = hi.map((html, i) => ({
      kind: LineKind.Ctx,
      old: i + 1,
      new: null,
      html,
    }));
    return { repoId: opts.repoId, path, lang, truncated: cap.truncated, lines };
  }

  // New side: whole new file with deleted lines spliced in. We walk the full
  // diff to get exact old/new numbering, and fill unchanged regions (which the
  // diff omits with only U<context> lines shown) from the highlighted new file.
  const newContent = (await readNewContent(repoRoot, path)) ?? "";
  const cap = capLines(newContent, MAX_FULL_FILE_LINES);
  const newHi = await highlightFile(cap.content, path, theme);
  const newTotal = newHi.length;

  // A full-context diff makes reconstruction exact and simple: every new line
  // and every deletion is present with correct numbers, no gaps to fill.
  let rawDiff = "";
  try {
    rawDiff = await diffFile(repoRoot, base, path, MAX_FULL_FILE_LINES, whitespace);
  } catch {
    rawDiff = "";
  }
  const parsed = parseUnifiedDiff(rawDiff, Number.MAX_SAFE_INTEGER);

  // Highlight old content once, for deleted-line HTML.
  const oldContent = await showOld(repoRoot, base, path);
  const oldHi = oldContent != null ? await highlightFile(oldContent, path, theme) : null;

  const lines: DiffLine[] = [];

  if (parsed.hunks.length === 0) {
    // No diff (identical, or diff failed): render the new file as pure context.
    for (let n = 1; n <= newTotal; n++) {
      lines.push({ kind: LineKind.Ctx, old: n, new: n, html: newHi[n - 1] ?? "" });
    }
    return { repoId: opts.repoId, path, lang, truncated: cap.truncated, lines };
  }

  // With full context there is a single hunk covering the file. Emit its lines
  // in order; each already carries exact old/new numbers. Re-key `html` to the
  // highlighted whole-file lines (add/ctx from new, del from old).
  let coveredNew = 0;
  for (const h of parsed.hunks) {
    for (const l of h.lines) {
      if (l.kind === LineKind.Del) {
        lines.push({
          kind: LineKind.Del,
          old: l.old,
          new: null,
          html: (l.old != null && oldHi ? oldHi[l.old - 1] : undefined) ?? escapeHtml(l.text),
        });
      } else {
        const nn = l.new;
        if (nn != null) coveredNew = nn;
        lines.push({
          kind: l.kind,
          old: l.old,
          new: nn,
          html: (nn != null ? newHi[nn - 1] : undefined) ?? escapeHtml(l.text),
        });
      }
    }
  }

  // If the file was capped below the diff's reach, any remaining new lines are
  // unchanged tail context; append them so the view still covers the whole file.
  for (let n = coveredNew + 1; n <= newTotal; n++) {
    lines.push({ kind: LineKind.Ctx, old: null, new: n, html: newHi[n - 1] ?? "" });
  }

  return { repoId: opts.repoId, path, lang, truncated: cap.truncated, lines };
}

function capLines(content: string, max: number): { content: string; truncated: boolean } {
  const lines = content.split("\n");
  if (lines.length <= max) return { content, truncated: false };
  return { content: lines.slice(0, max).join("\n"), truncated: true };
}
