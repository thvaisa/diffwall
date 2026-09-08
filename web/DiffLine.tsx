// One rendered diff line: old gutter, new gutter, +/-/space marker, and the
// Shiki-highlighted content injected as HTML. Memoized so unchanged lines don't
// re-render when a pane updates.

import { memo } from "react";
import type { DiffLine as Line } from "../shared/types.js";

interface Props {
  line: Line;
}

function DiffLineImpl({ line }: Props) {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  return (
    <div className={`line ${line.kind}`}>
      <span className="gutter old">{line.old ?? ""}</span>
      <span className="gutter new">{line.new ?? ""}</span>
      <span className="marker">{marker}</span>
      <span
        className="content"
        dangerouslySetInnerHTML={{ __html: line.html }}
      />
    </div>
  );
}

export const DiffLine = memo(DiffLineImpl);
