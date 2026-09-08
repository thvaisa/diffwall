// Hand-written fixed-height list virtualization (dependency policy: write it,
// don't install it). Every diff line is the same height, which is the trivial
// case: render only the visible slice plus overscan, and pad above/below with
// spacers so the scrollbar stays correct. ~60 lines, no library.

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface VirtualWindow {
  /** First index to render (inclusive). */
  start: number;
  /** One past the last index to render. */
  end: number;
  /** Spacer height above the rendered slice, px. */
  padTop: number;
  /** Spacer height below the rendered slice, px. */
  padBottom: number;
}

export interface UseVirtualListResult {
  /** Attach to the scroll container. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  window: VirtualWindow;
  /** Scroll so that `index` is visible (aligned to top). */
  scrollToIndex: (index: number) => void;
}

/**
 * @param count total number of items
 * @param rowHeight fixed pixel height of one row
 * @param overscan extra rows to render above/below the viewport
 */
export function useVirtualList(
  count: number,
  rowHeight: number,
  overscan = 8,
): UseVirtualListResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewport(el.clientHeight);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  const visibleRows = viewport > 0 ? Math.ceil(viewport / rowHeight) : 0;
  const first = Math.floor(scrollTop / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visibleRows + overscan);

  const window: VirtualWindow = {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
  };

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = Math.max(0, index * rowHeight);
    },
    [rowHeight],
  );

  return { scrollRef, window, scrollToIndex };
}
