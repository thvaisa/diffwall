// Unified-diff parser. Takes the raw text of `git diff -U<n>` for a single file
// and produces structured hunks with per-line old/new numbering. It does NOT
// highlight — `html` is filled in later by highlight.ts, which needs whole-file
// context. Here `html` carries the raw (unescaped) line text as a placeholder.

import { LineKind } from "../shared/types.js";
import type { Hunk } from "../shared/types.js";

export interface RawLine {
  kind: LineKind;
  old: number | null;
  new: number | null;
  /** Raw line text, no leading +/-/space marker, no trailing newline. */
  text: string;
}

export interface RawHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: RawLine[];
}

export interface ParsedDiff {
  hunks: RawHunk[];
  binary: boolean;
  /** True if we stopped early at the per-file line cap. */
  truncated: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse unified diff text for one file.
 * @param maxLines cap on emitted diff lines; beyond it we set truncated.
 */
export function parseUnifiedDiff(text: string, maxLines: number): ParsedDiff {
  const hunks: RawHunk[] = [];
  let binary = false;
  let truncated = false;
  let emitted = 0;

  // Split without a trailing empty element eating a real final line.
  const lines = text.split("\n");

  let current: RawHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Detect binary markers git emits instead of hunks.
    if (
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch")
    ) {
      binary = true;
      current = null;
      continue;
    }

    const m = HUNK_RE.exec(line);
    if (m) {
      const oldStart = parseInt(m[1]!, 10);
      const newStart = parseInt(m[3]!, 10);
      current = {
        header: line,
        oldStart,
        newStart,
        lines: [],
      };
      hunks.push(current);
      oldNo = oldStart;
      newNo = newStart;
      continue;
    }

    if (!current) {
      // File header cruft (diff --git, index, ---, +++, mode changes). Skip.
      continue;
    }

    if (emitted >= maxLines) {
      truncated = true;
      break;
    }

    const marker = line[0];
    if (marker === "\\") {
      // "\ No newline at end of file" — metadata, not a content line.
      continue;
    }
    const body = line.slice(1);

    if (marker === "+") {
      current.lines.push({ kind: LineKind.Add, old: null, new: newNo, text: body });
      newNo++;
      emitted++;
    } else if (marker === "-") {
      current.lines.push({ kind: LineKind.Del, old: oldNo, new: null, text: body });
      oldNo++;
      emitted++;
    } else if (marker === " ") {
      current.lines.push({ kind: LineKind.Ctx, old: oldNo, new: newNo, text: body });
      oldNo++;
      newNo++;
      emitted++;
    } else if (line === "") {
      // A truly empty context line (git emits " " + empty, but the trailing
      // split can also yield ""). Treat as context only inside a hunk when the
      // next iteration continues; a stray final "" is harmless to skip.
      continue;
    }
    // Any other leading char (shouldn't happen with --no-color) is ignored.
  }

  return { hunks, binary, truncated };
}

/** Convert parsed hunks into the API shape, with `html` still as raw text. */
export function toApiHunks(raw: RawHunk[]): Hunk[] {
  return raw.map((h) => ({
    header: h.header,
    oldStart: h.oldStart,
    newStart: h.newStart,
    lines: h.lines.map((l) => ({
      kind: l.kind,
      old: l.old,
      new: l.new,
      html: l.text, // placeholder; highlight.ts replaces this.
    })),
  }));
}
