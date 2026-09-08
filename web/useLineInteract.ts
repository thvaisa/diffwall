// Per-pane line-reference interaction: click to copy, shift-click / drag for a
// range, alt-click or icon to open in VS Code. Produces the LineInteract object
// DiffLine consumes, plus manages the transient flash and drag-selection state.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LineInteract } from "./DiffLine.js";
import type { FileDiff } from "../shared/types.js";
import { copyText, vscodeLink, type RefTray } from "./references.js";
import { openInVsCode } from "./api.js";

export function useLineInteract(file: FileDiff, tray: RefTray): LineInteract {
  const [flashed, setFlashed] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const anchor = useRef<number | null>(null); // last single-clicked line
  const dragging = useRef(false);
  const dragStart = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);

  const flash = useCallback((line: number) => {
    setFlashed(line);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashed(null), 1200);
  }, []);

  const commitRange = useCallback(
    (a: number, b: number) => {
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      tray.add({ path: file.path, start, end });
      void copyText(
        start === end ? `${file.path}:${start}` : `${file.path}:${start}-${end}`,
      );
      flash(end);
    },
    [file.path, tray, flash],
  );

  const onCopy = useCallback(
    (line: number, shift: boolean) => {
      if (shift && anchor.current != null) {
        commitRange(anchor.current, line);
      } else {
        anchor.current = line;
        commitRange(line, line);
      }
    },
    [commitRange],
  );

  const onOpen = useCallback(
    (line: number) => {
      // Primary: hand the OS a vscode:// link (no subprocess). Fallback to the
      // server's `code -g` if the URI handler isn't registered.
      const link = vscodeLink(file.absPath, line);
      window.location.href = link;
      // Fire the fallback shortly after; if the URI worked the page navigated
      // away/handled it, and the POST is harmless. If not, this opens the file.
      window.setTimeout(() => {
        void openInVsCode(file.path, line).catch(() => {});
      }, 400);
    },
    [file.absPath, file.path],
  );

  const onDragStart = useCallback((line: number) => {
    dragging.current = true;
    dragStart.current = line;
    setSelected(new Set([line]));
  }, []);

  const onDragOver = useCallback((line: number) => {
    if (!dragging.current || dragStart.current == null) return;
    const a = Math.min(dragStart.current, line);
    const b = Math.max(dragStart.current, line);
    const s = new Set<number>();
    for (let n = a; n <= b; n++) s.add(n);
    setSelected(s);
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragging.current || dragStart.current == null) return;
    const lines = [...selected];
    dragging.current = false;
    if (lines.length <= 1) {
      // A plain click (no drag): treat as single-line copy + anchor.
      const line = dragStart.current;
      anchor.current = line;
      commitRange(line, line);
    } else {
      const a = Math.min(...lines);
      const b = Math.max(...lines);
      anchor.current = a;
      commitRange(a, b);
    }
    dragStart.current = null;
    setSelected(new Set());
  }, [selected, commitRange]);

  // End a drag even if the mouse is released outside the gutter.
  useEffect(() => {
    function up() {
      if (dragging.current) onDragEnd();
    }
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [onDragEnd]);

  return useMemo(
    () => ({
      path: file.path,
      absPath: file.absPath,
      onCopy,
      onOpen,
      onDragStart,
      onDragOver,
      onDragEnd,
      flashed,
      selected,
    }),
    [file.path, file.absPath, onCopy, onOpen, onDragStart, onDragOver, onDragEnd, flashed, selected],
  );
}
