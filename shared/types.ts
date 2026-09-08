// Shared API contract between server and web. Keep in sync with the spec's
// /api/diff and /api/file payloads.
//
// Enum-like unions use the `const object + derived type` pattern rather than a
// TS `enum`: it gives one source of truth and member autocomplete (LineKind.Add
// instead of a bare "add" literal), is erased at compile time (no runtime cost,
// safe under isolatedModules / Node type-stripping), and the string values ARE
// the wire format — the JSON on the API is unchanged.

export const LineKind = {
  Ctx: "ctx",
  Add: "add",
  Del: "del",
} as const;
export type LineKind = (typeof LineKind)[keyof typeof LineKind];

export const ViewMode = {
  Diff: "diff",
  Full: "full",
} as const;
export type ViewMode = (typeof ViewMode)[keyof typeof ViewMode];

export const FileStatus = {
  Modified: "modified",
  Added: "added",
  Deleted: "deleted",
  Renamed: "renamed",
  Untracked: "untracked",
  Typechange: "typechange",
} as const;
export type FileStatus = (typeof FileStatus)[keyof typeof FileStatus];

/** How a file changed between two polls (drives per-pane flashing). */
export const ChangeKind = {
  New: "new",
  Changed: "changed",
} as const;
export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind];

/** Pane ordering in the wall. */
export const SortMode = {
  Path: "path",
  Recent: "recent",
} as const;
export type SortMode = (typeof SortMode)[keyof typeof SortMode];

/** One rendered line. `html` is Shiki-highlighted (or escaped plaintext). */
export interface DiffLine {
  kind: LineKind;
  /** Old-side line number, or null for additions. */
  old: number | null;
  /** New-side line number, or null for deletions. */
  new: number | null;
  html: string;
}

export interface Hunk {
  /** The raw `@@ -a,b +c,d @@ section` header line. */
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  /** Original path for renames, else null. */
  oldPath: string | null;
  status: FileStatus;
  added: number;
  removed: number;
  binary: boolean;
  /** "symlink" or "submodule" — shown via git's one-line diff, not read as
   *  text; null for ordinary files. */
  special?: "symlink" | "submodule" | null;
  /** Diff view was capped (per-file line cap). */
  truncated: boolean;
  /** sha1 of the raw diff text; used by the client to detect changes. */
  hash: string;
  lang: string;
  /** Line count of the new-side file, when known. */
  newLineCount: number | null;
  hunks: Hunk[];
  /** Absolute path for building a vscode:// link. */
  absPath: string;
  /** Per-file failure (e.g. concurrent write); other files still returned. */
  error?: string;
}

export interface RepoState {
  /** true when a merge/rebase/cherry-pick is in progress. */
  midOperation: boolean;
  operation: string | null;
  detachedHead: boolean;
  branch: string | null;
}

export interface DiffResponse {
  repo: string;
  base: string;
  /** Short HEAD hash, or null on an empty repo. */
  head: string | null;
  generatedAt: number;
  totals: { files: number; added: number; removed: number };
  state: RepoState;
  /** File set was capped (total file cap). */
  truncated: boolean;
  files: FileDiff[];
}

export interface FileResponse {
  path: string;
  lang: string;
  truncated: boolean;
  lines: DiffLine[];
}

export interface HealthResponse {
  ok: true;
  repo: string;
  pid: number;
}

export interface RefsResponse {
  branches: string[];
  tags: string[];
  head: string;
}

export interface OpenRequest {
  path: string;
  line: number;
}

export interface OpenResponse {
  ok: boolean;
  error?: string;
}

export interface ApiError {
  error: string;
}
