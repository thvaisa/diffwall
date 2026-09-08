// Column assignment. Panes go greedily into the shortest column, where a
// column's "height" is estimated from the line counts of the panes in it. This
// is recomputed only when the file set changes (App decides that), never on a
// poll — panes must not jump around while you read.

import type { FileDiff } from "../shared/types.js";

/** Estimate a pane's rendered height in lines (for greedy balancing). */
export function estimatePaneLines(file: FileDiff): number {
  const HEADER = 2;
  if (file.binary || file.error) return HEADER + 1;
  let n = 0;
  for (const h of file.hunks) n += 1 + h.lines.length; // +1 for hunk header
  // Cap the estimate so one huge file doesn't distort balancing.
  return HEADER + Math.min(n, 40);
}

/** Assign files to `count` columns, greedily filling the shortest. */
export function assignColumns(files: FileDiff[], count: number): FileDiff[][] {
  const cols: FileDiff[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const f of files) {
    let min = 0;
    for (let i = 1; i < count; i++) {
      if (heights[i]! < heights[min]!) min = i;
    }
    cols[min]!.push(f);
    heights[min]! += estimatePaneLines(f);
  }
  return cols;
}
