// Left sidebar: a collapsible tree of the changed files grouped by folder.
// Clicking a file scrolls the wall to that file's pane and focuses it. Each
// folder has an eye toggle to hide its files from the wall (persisted). Only
// changed files appear.

import { useState } from "react";
import type { FileDiff } from "../shared/types.js";
import { buildTree, type TreeNode } from "./fileTree.js";

const STATUS_DOT: Record<string, string> = {
  modified: "status-modified",
  added: "status-added",
  deleted: "status-deleted",
  renamed: "status-renamed",
  untracked: "status-untracked",
  typechange: "status-typechange",
};

interface Props {
  files: FileDiff[];
  hidden: Set<string>;
  onToggleHidden: (dirPath: string) => void;
  onPickFile: (path: string) => void;
  focusedPath: string | null;
  onClose: () => void;
}

export function FileTree({
  files,
  hidden,
  onToggleHidden,
  onPickFile,
  focusedPath,
  onClose,
}: Props) {
  const tree = buildTree(files);

  return (
    <div className="file-tree">
      <div className="file-tree-head">
        <span>files</span>
        <button onClick={onClose} title="hide the file tree (b)">
          ×
        </button>
      </div>
      <div className="file-tree-body">
        {tree.map((node) => (
          <TreeRow
            key={node.kind === "dir" ? "d:" + node.path : "f:" + node.path}
            node={node}
            depth={0}
            hidden={hidden}
            onToggleHidden={onToggleHidden}
            onPickFile={onPickFile}
            focusedPath={focusedPath}
          />
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  hidden,
  onToggleHidden,
  onPickFile,
  focusedPath,
}: {
  node: TreeNode;
  depth: number;
  hidden: Set<string>;
  onToggleHidden: (dirPath: string) => void;
  onPickFile: (path: string) => void;
  focusedPath: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pad = { paddingLeft: `${8 + depth * 12}px` };

  if (node.kind === "file") {
    return (
      <div
        className={`tree-file${focusedPath === node.path ? " focused" : ""}`}
        style={pad}
        title={node.path}
        onClick={() => onPickFile(node.path)}
      >
        <span className={`status-dot ${STATUS_DOT[node.file.status] ?? ""}`} />
        <span className="tree-name">{node.name}</span>
        <span className="tree-counts">
          {node.file.added > 0 && <span className="add">+{node.file.added}</span>}
          {node.file.removed > 0 && <span className="del">−{node.file.removed}</span>}
        </span>
      </div>
    );
  }

  const isHiddenDir = hidden.has(node.path);
  return (
    <>
      <div className={`tree-dir${isHiddenDir ? " hidden-dir" : ""}`} style={pad}>
        <span
          className="tree-caret"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "expand" : "collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="tree-name" onClick={() => setCollapsed((c) => !c)}>
          {node.name}/
        </span>
        <span className="tree-dir-count">{node.fileCount}</span>
        <button
          className="tree-eye"
          onClick={() => onToggleHidden(node.path)}
          title={isHiddenDir ? "show this folder" : "hide this folder from the wall"}
        >
          {isHiddenDir ? "🙈" : "👁"}
        </button>
      </div>
      {!collapsed &&
        node.children.map((child) => (
          <TreeRow
            key={child.kind === "dir" ? "d:" + child.path : "f:" + child.path}
            node={child}
            depth={depth + 1}
            hidden={hidden}
            onToggleHidden={onToggleHidden}
            onPickFile={onPickFile}
            focusedPath={focusedPath}
          />
        ))}
    </>
  );
}
