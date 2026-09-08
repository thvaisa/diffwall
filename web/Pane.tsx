// One file's pane. Two view modes:
//   diff — hunks only, with clickable gap separators that expand skipped lines
//   full — the whole file, virtualized, changed lines marked in place
// Mode is owned by App (persisted per path) and passed in with a toggle.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChangeKind, FileStatus, LineKind, ViewMode } from "../shared/types.js";
import type { DiffLine as Line, FileDiff } from "../shared/types.js";
import { DiffLine, type LineInteract } from "./DiffLine.js";
import { useFullFile } from "./useFullFile.js";
import { useLineInteract } from "./useLineInteract.js";
import { VirtualLines, type VirtualLinesHandle } from "./VirtualLines.js";
import type { RefTray } from "./references.js";

/** Handlers a focused pane registers so App's j/k keys can drive it. */
export interface PaneNav {
  next: () => void;
  prev: () => void;
}

const STATUS_TAG: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  typechange: "T",
};

const ROW_HEIGHT = 17; // must match .line height in CSS (12px * 1.45 ≈ 17.4, floored)

interface Props {
  file: FileDiff;
  base: string;
  mode: ViewMode;
  onToggleMode: (path: string) => void;
  focused: boolean;
  onFocus: (path: string) => void;
  tray: RefTray;
  /** "new" or "changed" from the latest poll; triggers a border flash. */
  flash?: ChangeKind | null;
  /** Manual pane height in px, or undefined for content-sized. */
  height?: number;
  onSetHeight?: (path: string, h: number) => void;
  onClearHeight?: (path: string) => void;
  /** When focused, register j/k navigation handlers (null to clear). */
  onRegisterNav?: (path: string, nav: PaneNav | null) => void;
}

function PaneImpl({
  file,
  base,
  mode,
  onToggleMode,
  focused,
  onFocus,
  tray,
  flash,
  height,
  onSetHeight,
  onClearHeight,
  onRegisterNav,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const interact = useLineInteract(file, tray);
  const paneRef = useRef<HTMLDivElement | null>(null);

  // Drag the bottom edge to set an explicit height; double-click clears it.
  const resizeDrag = useRef<{ startY: number; startH: number } | null>(null);
  const onResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const h = paneRef.current?.getBoundingClientRect().height ?? 200;
      resizeDrag.current = { startY: e.clientY, startH: h };
      const move = (ev: MouseEvent) => {
        const d = resizeDrag.current;
        if (!d) return;
        onSetHeight?.(file.path, d.startH + (ev.clientY - d.startY));
      };
      const up = () => {
        resizeDrag.current = null;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [file.path, onSetHeight],
  );

  const canFull =
    !file.binary &&
    !file.error &&
    !file.special &&
    file.status !== FileStatus.Untracked;
  const effectiveMode: ViewMode = canFull ? mode : ViewMode.Diff;

  // Flash the border briefly when this pane's content changed on a poll. Keyed
  // on file.hash so a genuine change re-triggers even for the same flash kind.
  const [flashing, setFlashing] = useState(false);
  const flashKind = useRef<ChangeKind | null>(null);
  useEffect(() => {
    if (!flash) return;
    flashKind.current = flash;
    setFlashing(true);
    const id = window.setTimeout(() => setFlashing(false), 1500);
    return () => window.clearTimeout(id);
    // file.hash in deps: a new change with the same `flash` value still flashes.
  }, [flash, file.hash]);

  const flashClass = flashing
    ? ` flash-${flashKind.current ?? "changed"}`
    : "";

  return (
    <div
      ref={paneRef}
      className={`pane${focused ? " focused" : ""}${flashClass}${
        collapsed ? " collapsed" : ""
      }`}
      style={height && !collapsed ? { height } : undefined}
      onMouseDown={() => onFocus(file.path)}
    >
      <div className="pane-header">
        <span
          className="header-main"
          onClick={() => setCollapsed((c) => !c)}
          title="collapse / expand"
        >
          <span className={`status-dot status-${file.status}`} />
          <span className="path" title={file.path}>
            {file.oldPath && (
              <>
                <span className="old-path">{file.oldPath}</span>
                {" → "}
              </>
            )}
            {file.path}
          </span>
        </span>
        <span className="counts">
          {file.added > 0 && <span className="add">+{file.added}</span>}
          {file.added > 0 && file.removed > 0 && " "}
          {file.removed > 0 && <span className="del">−{file.removed}</span>}
        </span>
        {file.special && <span className="tag special">{file.special}</span>}
        <span className="tag">{STATUS_TAG[file.status] ?? "?"}</span>
        {canFull && (
          <button
            className="mode-toggle"
            onClick={() => onToggleMode(file.path)}
            title="toggle diff / full-file view (e)"
          >
            {effectiveMode === ViewMode.Diff ? "diff" : "full"}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="pane-content">
          {effectiveMode === ViewMode.Full ? (
            <FullBody
              file={file}
              base={base}
              focused={focused}
              path={file.path}
              interact={interact}
              onRegisterNav={onRegisterNav}
            />
          ) : (
            <DiffBody file={file} base={base} interact={interact} />
          )}
        </div>
      )}

      {!collapsed && (
        <div
          className="pane-resize"
          title="drag to resize · double-click to auto-size"
          onMouseDown={onResizeDown}
          onDoubleClick={() => onClearHeight?.(file.path)}
        />
      )}
    </div>
  );
}

// ---- Diff view with gap expansion --------------------------------------------

function DiffBody({
  file,
  base,
  interact,
}: {
  file: FileDiff;
  base: string;
  interact: LineInteract;
}) {
  // Gaps the user has expanded, keyed by the hunk index they precede.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const needFull = expanded.size > 0;
  const side = file.status === FileStatus.Deleted ? "old" : "new";
  const full = useFullFile(file.path, base, file.hash, side, needFull);

  if (file.error) return <div className="pane-note error">error: {file.error}</div>;
  if (file.binary) return <div className="pane-note">binary file — no text diff</div>;
  if (file.hunks.length === 0) return <div className="pane-note">no changes to show</div>;

  // New-line index by which we look up full-file lines (1-based new numbers).
  const fullByNew = full.data
    ? indexByNew(full.data.lines)
    : null;

  return (
    <div className="pane-body diff">
      {file.hunks.map((h, hi) => {
        const prev = hi > 0 ? file.hunks[hi - 1] : null;
        const prevEndNew = prev ? lastNew(prev) : 0;
        const thisStartNew = h.newStart;
        const gap = thisStartNew - prevEndNew - 1;
        const showGap = gap > 0;
        const isOpen = expanded.has(hi);

        return (
          <div key={hi}>
            {showGap && !isOpen && (
              <div
                className="gap"
                onClick={() => setExpanded((s) => new Set(s).add(hi))}
                title="expand skipped lines"
              >
                ⋯ {gap} unchanged line{gap === 1 ? "" : "s"}
              </div>
            )}
            {showGap && isOpen && fullByNew && (
              <GapLines
                lines={fullByNew}
                fromNew={prevEndNew + 1}
                toNew={thisStartNew - 1}
                interact={interact}
              />
            )}
            {showGap && isOpen && !fullByNew && (
              <div className="gap loading">loading skipped lines…</div>
            )}
            <div className="hunk-header">{h.header}</div>
            {h.lines.map((line, li) => (
              <DiffLine key={li} line={line} interact={interact} />
            ))}
          </div>
        );
      })}
      {file.truncated && (
        <div className="pane-note truncated">
          diff truncated at the per-file line cap
        </div>
      )}
    </div>
  );
}

function GapLines({
  lines,
  fromNew,
  toNew,
  interact,
}: {
  lines: Map<number, Line>;
  fromNew: number;
  toNew: number;
  interact: LineInteract;
}) {
  const out: Line[] = [];
  for (let n = fromNew; n <= toNew; n++) {
    const l = lines.get(n);
    if (l) out.push(l);
  }
  return (
    <>
      {out.map((line, i) => (
        <DiffLine key={i} line={line} interact={interact} />
      ))}
    </>
  );
}

function indexByNew(lines: Line[]): Map<number, Line> {
  const m = new Map<number, Line>();
  for (const l of lines) {
    if (l.new != null) m.set(l.new, l);
  }
  return m;
}

function lastNew(h: FileDiff["hunks"][number]): number {
  for (let i = h.lines.length - 1; i >= 0; i--) {
    const n = h.lines[i]!.new;
    if (n != null) return n;
  }
  return h.newStart;
}

// ---- Full-file view (virtualized) --------------------------------------------

function FullBody({
  file,
  base,
  focused,
  path,
  interact,
  onRegisterNav,
}: {
  file: FileDiff;
  base: string;
  focused: boolean;
  path: string;
  interact: LineInteract;
  onRegisterNav?: (path: string, nav: PaneNav | null) => void;
}) {
  const side = file.status === FileStatus.Deleted ? "old" : "new";
  const { data, loading, error } = useFullFile(file.path, base, file.hash, side, true);
  const vlRef = useRef<VirtualLinesHandle | null>(null);
  const cursor = useRef(-1);

  // Collapse consecutive changed lines into regions; navigate between regions.
  const regions = useMemo(() => {
    if (!data) return [];
    const out: number[] = [];
    let prev = -2;
    data.lines.forEach((l, i) => {
      if (l.kind !== LineKind.Ctx) {
        if (i !== prev + 1) out.push(i); // start of a new region
        prev = i;
      }
    });
    return out;
  }, [data]);

  const changedRows = useMemo(() => {
    if (!data) return [];
    const rows: number[] = [];
    data.lines.forEach((l, i) => {
      if (l.kind !== LineKind.Ctx) rows.push(i);
    });
    return rows;
  }, [data]);

  // Register j/k handlers with App while this pane is focused.
  const jump = useCallback(
    (delta: number) => {
      if (regions.length === 0) return;
      cursor.current = Math.max(
        0,
        Math.min(regions.length - 1, cursor.current + delta),
      );
      const target = regions[cursor.current] ?? 0;
      vlRef.current?.scrollToIndex(Math.max(0, target - 2));
    },
    [regions],
  );

  useEffect(() => {
    if (!focused || !onRegisterNav) return;
    onRegisterNav(path, {
      next: () => jump(1),
      prev: () => jump(-1),
    });
    return () => onRegisterNav(path, null);
  }, [focused, onRegisterNav, path, jump]);

  // On first load of the full view, land on the first changed region instead of
  // the top of the file — so switching diff→full doesn't make you scroll back
  // down to where the change is. Runs once per fetched file (keyed by hash).
  const landedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data || regions.length === 0) return;
    if (landedFor.current === file.hash) return;
    landedFor.current = file.hash;
    cursor.current = 0;
    const target = regions[0] ?? 0;
    // Defer to let VirtualLines mount and measure its viewport first.
    const id = window.setTimeout(
      () => vlRef.current?.scrollToIndex(Math.max(0, target - 3)),
      0,
    );
    return () => window.clearTimeout(id);
  }, [data, regions, file.hash]);

  if (error) return <div className="pane-note error">error: {error}</div>;
  if (loading && !data) return <div className="pane-note">loading file…</div>;
  if (!data) return <div className="pane-note">no content</div>;

  return (
    <>
      <VirtualLines
        ref={vlRef}
        lines={data.lines}
        rowHeight={ROW_HEIGHT}
        changedRows={changedRows}
        interact={interact}
      />
      {data.truncated && (
        <div className="pane-note truncated">
          file truncated at 20,000 lines
        </div>
      )}
    </>
  );
}

export const Pane = memo(PaneImpl);
export type { Line };
