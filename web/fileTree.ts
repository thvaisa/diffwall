// Build a folder tree from the flat list of changed files. Only changed files
// appear (that is the whole point of the wall). Folders are collapsible and can
// be hidden; hidden folders remove their files from the wall entirely.

import type { FileDiff } from "../shared/types.js";

export interface TreeFile {
  kind: "file";
  path: string; // full repo-relative path
  name: string; // basename
  file: FileDiff;
}

export interface TreeDir {
  kind: "dir";
  path: string; // folder path relative to repo root, e.g. "src/core"
  name: string; // last segment
  children: TreeNode[];
  fileCount: number; // total files under this dir (recursive)
}

export type TreeNode = TreeDir | TreeFile;

/** Build a nested tree of the changed files, folders sorted before files, both
 *  alphabetical. Directory `path` values let the UI key collapse/hide state. */
export function buildTree(files: FileDiff[]): TreeNode[] {
  const root: TreeDir = {
    kind: "dir",
    path: "",
    name: "",
    children: [],
    fileCount: 0,
  };

  for (const file of files) {
    const parts = file.path.split("/");
    const fileName = parts.pop()!;
    let dir = root;
    let acc = "";
    for (const seg of parts) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = dir.children.find(
        (c): c is TreeDir => c.kind === "dir" && c.path === acc,
      );
      if (!next) {
        next = { kind: "dir", path: acc, name: seg, children: [], fileCount: 0 };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ kind: "file", path: file.path, name: fileName, file });
  }

  sortAndCount(root);
  return root.children;
}

function sortAndCount(dir: TreeDir): number {
  let count = 0;
  for (const c of dir.children) {
    if (c.kind === "dir") count += sortAndCount(c);
    else count += 1;
  }
  dir.fileCount = count;
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return count;
}

/** A file is hidden if any of its ancestor folder paths is in the hidden set. */
export function isHidden(path: string, hidden: Set<string>): boolean {
  if (hidden.size === 0) return false;
  const parts = path.split("/");
  parts.pop(); // drop filename
  let acc = "";
  for (const seg of parts) {
    acc = acc ? `${acc}/${seg}` : seg;
    if (hidden.has(acc)) return true;
  }
  return false;
}
