// The notepad: annotated notes the user attaches to a spot in the diff, to
// paste at an agent. Each note captures where (file + line range), a snippet
// (the first line of the selected/annotated text) and the user's note text.
// Persisted for the session. Copy-all emits agent-ready lines.

import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson } from "./persist.js";
import { copyText } from "./references.js";

export interface Note {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  /** First line of the referenced text, trimmed — context for the note. */
  snippet: string;
  /** The user's note. */
  text: string;
}

/** How a note pastes at an agent: `path:line — "snippet" — note`. */
export function formatNote(n: Note): string {
  const loc =
    n.startLine === n.endLine
      ? `${n.path}:${n.startLine}`
      : `${n.path}:${n.startLine}-${n.endLine}`;
  const snip = n.snippet ? ` — "${n.snippet}"` : "";
  const body = n.text ? ` — ${n.text}` : "";
  return `${loc}${snip}${body}`;
}

export interface NotePad {
  notes: Note[];
  add: (n: Omit<Note, "id">) => string;
  update: (id: string, text: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  copyAll: () => Promise<void>;
}

let seq = 0;
const newId = () => `n${Date.now()}_${seq++}`;

export function useNotes(): NotePad {
  const [notes, setNotes] = useState<Note[]>(() =>
    loadJson<Note[]>("notes", []),
  );

  useEffect(() => saveJson("notes", notes), [notes]);

  const add = useCallback((n: Omit<Note, "id">) => {
    const id = newId();
    setNotes((cur) => [...cur, { ...n, id }]);
    return id;
  }, []);

  const update = useCallback((id: string, text: string) => {
    setNotes((cur) => cur.map((n) => (n.id === id ? { ...n, text } : n)));
  }, []);

  const remove = useCallback((id: string) => {
    setNotes((cur) => cur.filter((n) => n.id !== id));
  }, []);

  const clear = useCallback(() => setNotes([]), []);

  const copyAll = useCallback(async () => {
    await copyText(notes.map(formatNote).join("\n"));
  }, [notes]);

  return { notes, add, update, remove, clear, copyAll };
}
