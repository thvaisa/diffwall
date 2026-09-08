// One rendered diff line: old gutter, new gutter, +/-/space marker, and the
// Shiki-highlighted content. The gutters are interactive:
//   plain click        → copy `path:line`
//   shift-click        → copy `path:a-b` range (from the last clicked line)
//   drag across gutter  → select a range, same result
//   alt/ctrl/meta click → open the line in VS Code
//   the ⧉ icon          → also opens in VS Code (obvious alternative to copy)
// Memoized so unchanged lines don't re-render on a pane update.

import { memo } from "react";
import { LineKind } from "../shared/types.js";
import type { DiffLine as Line } from "../shared/types.js";

export interface LineInteract {
  /** Repo-relative path, for building the reference string. */
  path: string;
  /** Absolute path, for the vscode:// link. */
  absPath: string;
  onCopy: (line: number, shift: boolean) => void;
  onOpen: (line: number) => void;
  onDragStart: (line: number) => void;
  onDragOver: (line: number) => void;
  onDragEnd: () => void;
  /** Line number (new-side, else old) currently flashed as "copied". */
  flashed: number | null;
  /** Line numbers currently inside a drag/range selection (new-side/old). */
  selected: Set<number>;
}

interface Props {
  line: Line;
  interact?: LineInteract;
}

function DiffLineImpl({ line, interact }: Props) {
  const marker =
    line.kind === LineKind.Add ? "+" : line.kind === LineKind.Del ? "−" : " ";
  // Reference number: prefer new-side; deletions reference their old number.
  const refNo = line.new ?? line.old;

  if (!interact || refNo == null) {
    return (
      <div className={`line ${line.kind}`}>
        <span className="gutter old">{line.old ?? ""}</span>
        <span className="gutter new">{line.new ?? ""}</span>
        <span className="marker">{marker}</span>
        <span className="content" dangerouslySetInnerHTML={{ __html: line.html }} />
      </div>
    );
  }

  const flash = interact.flashed === refNo;
  const sel = interact.selected.has(refNo);

  const gutterProps = {
    onMouseDown: (e: React.MouseEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        interact.onOpen(refNo);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        interact.onCopy(refNo, true);
        return;
      }
      interact.onDragStart(refNo);
    },
    onMouseEnter: () => interact.onDragOver(refNo),
  };

  return (
    <div className={`line ${line.kind}${sel ? " selected" : ""}`}>
      <span
        className="gutter old refable"
        title="click: copy ref · shift: range · alt: open in VS Code"
        {...gutterProps}
      >
        {line.old ?? ""}
      </span>
      <span
        className="gutter new refable"
        title="click: copy ref · shift: range · alt: open in VS Code"
        {...gutterProps}
      >
        {line.new ?? ""}
      </span>
      <span className="marker">{marker}</span>
      <span className="content" dangerouslySetInnerHTML={{ __html: line.html }} />
      <button
        className="open-icon"
        title="open in VS Code"
        onClick={(e) => {
          e.stopPropagation();
          interact.onOpen(refNo);
        }}
      >
        ⧉
      </button>
      {flash && <span className="ref-flash">copied {interact.path}:{refNo}</span>}
    </div>
  );
}

export const DiffLine = memo(DiffLineImpl);
