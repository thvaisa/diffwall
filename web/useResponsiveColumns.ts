// Caps the requested column count to what the viewport can actually show
// without squeezing panes into unreadable strips. The user's chosen column
// count is left untouched in settings/localStorage — this only clamps the
// value used for layout.
//
// The threshold is expressed in characters, not a raw px guess, so it scales
// with the user's font size / browser zoom / OS text scaling instead of
// assuming a fixed physical width. window.innerWidth is already in
// device-independent CSS px, so display resolution / devicePixelRatio don't
// factor in — only the rendered font size does.

import { useEffect, useState } from "react";

// A bit more than 80 monospace characters — the traditional terminal width —
// plus room for the line-number gutters and padding either side. User-adjustable
// via the toolbar; this is only the default/fallback.
export const DEFAULT_MIN_COLUMN_CHARS = 96;

/** Width in px of one monospace character at the page's current font size. */
function measureCharWidth(): number {
  const probe = document.createElement("span");
  probe.style.fontFamily = "var(--font-mono)";
  probe.style.fontSize = "11px";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.textContent = "0".repeat(100);
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 100;
  document.body.removeChild(probe);
  return width || 6.6;
}

function computeMax(minColumnChars: number): number {
  const minColumnWidth = minColumnChars * measureCharWidth();
  return Math.max(1, Math.floor(window.innerWidth / minColumnWidth));
}

export function useResponsiveColumns(
  requested: number,
  minColumnChars: number = DEFAULT_MIN_COLUMN_CHARS,
): number {
  const [maxColumns, setMaxColumns] = useState(() => computeMax(minColumnChars));

  useEffect(() => {
    function recompute() {
      setMaxColumns(computeMax(minColumnChars));
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [minColumnChars]);

  return Math.min(requested, maxColumns);
}
