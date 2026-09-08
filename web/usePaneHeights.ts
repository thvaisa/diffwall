// Per-pane manual heights, keyed by file path, persisted in localStorage. A pane
// with no stored height sizes to its content (capped). Dragging the pane's bottom
// edge sets an explicit height; double-clicking the handle clears it (back to
// content-sized). Heights survive reload and are independent per file.

import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson } from "./persist.js";

const MIN_HEIGHT = 40;

export interface PaneHeights {
  get: (path: string) => number | undefined;
  set: (path: string, h: number) => void;
  clear: (path: string) => void;
}

export function usePaneHeights(): PaneHeights {
  const [heights, setHeights] = useState<Record<string, number>>(() =>
    loadJson<Record<string, number>>("paneHeights", {}),
  );

  useEffect(() => saveJson("paneHeights", heights), [heights]);

  const get = useCallback((path: string) => heights[path], [heights]);

  const set = useCallback((path: string, h: number) => {
    setHeights((cur) => ({ ...cur, [path]: Math.max(MIN_HEIGHT, Math.round(h)) }));
  }, []);

  const clear = useCallback((path: string) => {
    setHeights((cur) => {
      if (!(path in cur)) return cur;
      const next = { ...cur };
      delete next[path];
      return next;
    });
  }, []);

  return { get, set, clear };
}
