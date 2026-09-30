// Kanban layout: pack panes into fixed-width columns no taller than a cap,
// using each pane's measured height (first-fit, so file order is only roughly
// kept but columns fill up). Panes are capped at the column height in CSS and
// scroll inside, so a tall file simply fills one column.
//
// All panes share one parent and are placed absolutely, so moving a pane to
// another column never remounts it (a remount resets async-loaded content,
// which changes its height and would make it hop between columns). Measured
// heights are min(natural, cap) and don't depend on placement, so packing
// settles after one pass.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FileDiff } from "../shared/types.js";

const GAP = 8;
const WALL_PADDING = 8;
// Room kept for the horizontal scrollbar so its appearing doesn't resize the
// columns (which would repack, which could hide it again, and so on).
const SCROLLBAR_RESERVE = 16;
const ROW_PX = 17;
const PANE_CHROME_PX = 34;

function estimateHeight(file: FileDiff): number {
  if (file.binary || file.error) return PANE_CHROME_PX + ROW_PX;
  let n = 0;
  for (const h of file.hunks) n += 1 + h.lines.length;
  return PANE_CHROME_PX + n * ROW_PX;
}

/** Tallest column that fits in the wall without scrolling it vertically. */
export function availableKanbanHeight(wall: HTMLElement): number {
  return wall.offsetHeight - 2 * WALL_PADDING - SCROLLBAR_RESERVE;
}

export interface KanbanItem {
  file: FileDiff;
  x: number;
  y: number;
}

export function useKanban(
  enabled: boolean,
  files: FileDiff[],
  maxHeight: number,
  minColumnPx: number,
  wallRef: React.RefObject<HTMLDivElement | null>,
) {
  const [wallSize, setWallSize] = useState({ w: 0, h: 0 });
  const [heights, setHeights] = useState<Map<string, number>>(() => new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wall = wallRef.current;
    if (!enabled || !wall) return;
    const measure = () =>
      setWallSize({
        w: wall.offsetWidth - 2 * WALL_PADDING - SCROLLBAR_RESERVE,
        h: availableKanbanHeight(wall),
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wall);
    return () => ro.disconnect();
  }, [enabled, wallRef]);

  const n = Math.max(1, Math.floor((wallSize.w + GAP) / (minColumnPx + GAP)));
  const columnWidth = Math.floor(
    wallSize.w > 0 ? (wallSize.w + GAP) / n - GAP : minColumnPx,
  );
  const cap = Math.max(100, Math.min(maxHeight, wallSize.h || maxHeight));

  const layout = useMemo(() => {
    const items: KanbanItem[] = [];
    const colHeights: number[] = [];
    if (!enabled) return { items, width: 0, height: 0 };
    for (const f of files) {
      const h = Math.min(cap, heights.get(f.path) ?? estimateHeight(f));
      let ci = colHeights.findIndex((ch) => ch + GAP + h <= cap);
      if (ci === -1) {
        ci = colHeights.length;
        colHeights.push(-GAP);
      }
      items.push({ file: f, x: ci * (columnWidth + GAP), y: colHeights[ci]! + GAP });
      colHeights[ci]! += GAP + h;
    }
    return {
      items,
      width: Math.max(0, colHeights.length * (columnWidth + GAP) - GAP),
      height: Math.max(0, ...colHeights),
    };
  }, [enabled, files, heights, cap, columnWidth]);

  // Measure rendered panes; only real changes (>2px) trigger a repack.
  const paths = layout.items.map((i) => i.file.path).join("\n");
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!enabled || !root) return;
    const ro = new ResizeObserver((entries) => {
      setHeights((cur) => {
        let next: Map<string, number> | null = null;
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const path = el.dataset.panePath;
          if (!path) continue;
          const h = el.offsetHeight;
          if (Math.abs((cur.get(path) ?? -1) - h) > 2) {
            next ??= new Map(cur);
            next.set(path, h);
          }
        }
        return next ?? cur;
      });
    });
    root.querySelectorAll<HTMLElement>("[data-pane-path]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [enabled, paths]);

  return { ...layout, columnWidth, cap, containerRef };
}
