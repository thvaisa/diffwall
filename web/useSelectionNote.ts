// Watches for a text selection inside a pane body and resolves it to a note
// target: the file path (from the pane's data-pane-path), the line-number range
// the selection spans (from the .line rows it touches), and the first selected
// line's text as a snippet. Exposes the current target + where to float an
// "add note" button. Clears when the selection collapses.

import { useCallback, useEffect, useState } from "react";

export interface SelectionTarget {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  /** Viewport position to anchor the floating add-note button. */
  x: number;
  y: number;
}

/** Find the enclosing .line element and its new/old line number. */
function lineNumberOf(node: Node | null): number | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el && !el.classList?.contains("line")) el = el.parentElement;
  if (!el) return null;
  // Prefer the new-side gutter, fall back to old.
  const newG = el.querySelector(".gutter.new")?.textContent?.trim();
  const oldG = el.querySelector(".gutter.old")?.textContent?.trim();
  const n = newG && newG !== "" ? Number(newG) : oldG ? Number(oldG) : NaN;
  return Number.isFinite(n) ? n : null;
}

function panePathOf(node: Node | null): string | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el && !el.dataset?.panePath) el = el.parentElement;
  return el?.dataset.panePath ?? null;
}

function lineTextOf(node: Node | null): string {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el && !el.classList?.contains("line")) el = el.parentElement;
  return el?.querySelector(".content")?.textContent?.trim() ?? "";
}

export function useSelectionNote(): {
  target: SelectionTarget | null;
  clear: () => void;
} {
  const [target, setTarget] = useState<SelectionTarget | null>(null);

  const clear = useCallback(() => setTarget(null), []);

  useEffect(() => {
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setTarget(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const path = panePathOf(range.startContainer);
      if (!path || path !== panePathOf(range.endContainer)) {
        // Selection outside a pane or spanning two panes — ignore.
        setTarget(null);
        return;
      }
      const a = lineNumberOf(range.startContainer);
      const b = lineNumberOf(range.endContainer);
      if (a == null || b == null) {
        setTarget(null);
        return;
      }
      const startLine = Math.min(a, b);
      const endLine = Math.max(a, b);
      const snippet = lineTextOf(a <= b ? range.startContainer : range.endContainer);
      const rect = range.getBoundingClientRect();
      setTarget({
        path,
        startLine,
        endLine,
        snippet,
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  return { target, clear };
}
