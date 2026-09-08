// Renders a (potentially huge) list of diff lines using fixed-height
// virtualization, plus a change minimap strip so you can find changed regions in
// a long file. Body scrolls independently; only the visible slice is in the DOM.

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { LineKind } from "../shared/types.js";
import type { DiffLine as Line } from "../shared/types.js";
import { DiffLine, type LineInteract } from "./DiffLine.js";
import { useVirtualList } from "./useVirtualList.js";

export interface VirtualLinesHandle {
  scrollToIndex: (index: number) => void;
}

interface Props {
  lines: Line[];
  rowHeight: number;
  /** Indices (into `lines`) of changed rows, for the minimap + navigation. */
  changedRows: number[];
  interact?: LineInteract;
  maxHeight?: number;
}

export const VirtualLines = forwardRef<VirtualLinesHandle, Props>(
  function VirtualLines(
    { lines, rowHeight, changedRows, interact, maxHeight = 600 },
    ref,
  ) {
    const { scrollRef, window, scrollToIndex } = useVirtualList(
      lines.length,
      rowHeight,
    );
    const bodyRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({ scrollToIndex }), [scrollToIndex]);

    const slice = lines.slice(window.start, window.end);
    const totalHeight = lines.length * rowHeight;

    // Minimap ticks: fractional position of each changed row.
    const ticks = useMemo(
      () =>
        changedRows.map((r) => ({
          top: `${(r / Math.max(1, lines.length)) * 100}%`,
          kind: lines[r]?.kind ?? LineKind.Ctx,
        })),
      [changedRows, lines],
    );

    return (
      <div className="full-wrap">
        <div
          className="pane-body full"
          ref={(el) => {
            scrollRef.current = el;
            bodyRef.current = el;
          }}
          style={{ maxHeight }}
        >
          <div style={{ height: window.padTop }} />
          {slice.map((line, i) => (
            <DiffLine key={window.start + i} line={line} interact={interact} />
          ))}
          <div style={{ height: window.padBottom }} />
        </div>
        {ticks.length > 0 && (
          <div className="minimap" aria-hidden style={{ height: Math.min(totalHeight, maxHeight) }}>
            {ticks.map((t, i) => (
              <div
                key={i}
                className={`tick tick-${t.kind}`}
                style={{ top: t.top }}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);
