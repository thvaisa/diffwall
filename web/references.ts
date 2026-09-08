// The line-reference tray: an ordered list of `path:line` / `path:a-b` refs the
// user has collected to paste at an agent. Deduplicated, persisted for the
// session so an accidental reload doesn't lose the list.

import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson } from "./persist.js";

export interface Reference {
  path: string;
  start: number;
  /** Inclusive end for a range; equal to start for a single line. */
  end: number;
}

/** Format a reference the way it pastes at an agent: repo-relative, forward slashes. */
export function formatRef(r: Reference): string {
  return r.start === r.end
    ? `${r.path}:${r.start}`
    : `${r.path}:${r.start}-${r.end}`;
}

function sameRef(a: Reference, b: Reference): boolean {
  return a.path === b.path && a.start === b.start && a.end === b.end;
}

export interface RefTray {
  refs: Reference[];
  add: (r: Reference) => void;
  remove: (index: number) => void;
  clear: () => void;
  copyAll: () => Promise<void>;
}

export function useReferences(): RefTray {
  const [refs, setRefs] = useState<Reference[]>(() =>
    loadJson<Reference[]>("refs", []),
  );

  useEffect(() => saveJson("refs", refs), [refs]);

  const add = useCallback((r: Reference) => {
    setRefs((cur) => (cur.some((x) => sameRef(x, r)) ? cur : [...cur, r]));
  }, []);

  const remove = useCallback((index: number) => {
    setRefs((cur) => cur.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => setRefs([]), []);

  const copyAll = useCallback(async () => {
    const text = refs.map(formatRef).join("\n");
    await copyText(text);
  }, [refs]);

  return { refs, add, remove, clear, copyAll };
}

/** Copy text to the clipboard, with a textarea fallback for non-secure origins. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to legacy path */
  }
  // Fallback: hidden textarea + execCommand. Works on http://127.0.0.1.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* give up silently; UI still shows the ref */
  }
}

/** Build a VS Code deep link to a file:line (primary open mechanism). */
export function vscodeLink(absPath: string, line: number): string {
  // vscode://file/<abs path>:<line>:<col>
  return `vscode://file${absPath}:${line}:1`;
}
