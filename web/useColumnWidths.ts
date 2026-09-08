// Column widths as flex ratios, resized by dragging the splitters between
// columns. Ratios persist in localStorage keyed by column count (a 3-column
// layout and a 4-column layout keep separate widths). Dragging a splitter moves
// weight between the two adjacent columns only, so the others stay put.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadJson, saveJson } from "./persist.js";

const MIN_RATIO = 0.05; // keep every column at least a sliver wide

function evenRatios(count: number): number[] {
  return new Array<number>(count).fill(1 / count);
}

export function useColumnWidths(count: number) {
  const key = `colWidths:${count}`;
  const [ratios, setRatios] = useState<number[]>(() => {
    const saved = loadJson<number[]>(key, []);
    return saved.length === count ? saved : evenRatios(count);
  });

  // Reset when the column count changes to a layout we have no saved ratios for.
  useEffect(() => {
    const saved = loadJson<number[]>(key, []);
    setRatios(saved.length === count ? saved : evenRatios(count));
  }, [count, key]);

  useEffect(() => {
    if (ratios.length === count) saveJson(key, ratios);
  }, [ratios, key, count]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ index: number; startX: number; a: number; b: number } | null>(
    null,
  );

  const onSplitterDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      const a = ratios[index] ?? 0;
      const b = ratios[index + 1] ?? 0;
      drag.current = { index, startX: e.clientX, a, b };
    },
    [ratios],
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = drag.current;
      const el = containerRef.current;
      if (!d || !el) return;
      const width = el.clientWidth || 1;
      const deltaRatio = (e.clientX - d.startX) / width;
      // Shift weight from column b to column a (or vice-versa), clamped.
      const pair = d.a + d.b;
      let na = d.a + deltaRatio;
      na = Math.max(MIN_RATIO, Math.min(pair - MIN_RATIO, na));
      const nb = pair - na;
      setRatios((cur) => {
        const next = [...cur];
        next[d.index] = na;
        next[d.index + 1] = nb;
        return next;
      });
    }
    function onUp() {
      drag.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const reset = useCallback(() => setRatios(evenRatios(count)), [count]);

  return { ratios, containerRef, onSplitterDown, reset };
}
