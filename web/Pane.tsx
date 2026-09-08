// One file's pane: header (status dot, path, counts, tag) and a diff body of
// hunks. Header click collapses/expands. Milestone 2 is diff-view only, no
// highlighting toggle, no resize, no polling — those arrive in later milestones.

import { memo, useState } from "react";
import type { FileDiff } from "../shared/types.js";
import { DiffLine } from "./DiffLine.js";

const STATUS_TAG: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  typechange: "T",
};

interface Props {
  file: FileDiff;
}

function PaneImpl({ file }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="pane">
      <div className="pane-header" onClick={() => setCollapsed((c) => !c)}>
        <span className={`status-dot status-${file.status}`} />
        <span className="path" title={file.path}>
          {file.oldPath && (
            <>
              <span className="old-path">{file.oldPath}</span>
              {" → "}
            </>
          )}
          {file.path}
        </span>
        <span className="counts">
          {file.added > 0 && <span className="add">+{file.added}</span>}
          {file.added > 0 && file.removed > 0 && " "}
          {file.removed > 0 && <span className="del">−{file.removed}</span>}
        </span>
        <span className="tag">{STATUS_TAG[file.status] ?? "?"}</span>
      </div>

      {!collapsed && <PaneBody file={file} />}
    </div>
  );
}

function PaneBody({ file }: { file: FileDiff }) {
  if (file.error) {
    return <div className="pane-note error">error: {file.error}</div>;
  }
  if (file.binary) {
    return <div className="pane-note">binary file — no text diff</div>;
  }
  if (file.hunks.length === 0) {
    return <div className="pane-note">no changes to show</div>;
  }

  return (
    <div className="pane-body">
      {file.hunks.map((h, hi) => (
        <div key={hi}>
          <div className="hunk-header">{h.header}</div>
          {h.lines.map((line, li) => (
            <DiffLine key={li} line={line} />
          ))}
        </div>
      ))}
      {file.truncated && (
        <div className="pane-note truncated">
          diff truncated at the per-file line cap
        </div>
      )}
    </div>
  );
}

export const Pane = memo(PaneImpl);
