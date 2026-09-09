// Notepad UI: a floating "add note" button that appears over a text selection
// inside a pane, a small editor to type the note, and a bottom tray listing all
// notes with copy-all (agent-ready) and per-note edit/remove. Complements the
// line-reference tray — this one carries free-text annotations.

import { useEffect, useRef, useState } from "react";
import { formatNote, type NotePad as Pad } from "./notes.js";
import { useSelectionNote } from "./useSelectionNote.js";

export function NotePad({ pad }: { pad: Pad }) {
  const { target, clear } = useSelectionNote();
  // The note currently being composed (from a just-captured selection).
  const [draft, setDraft] = useState<{
    path: string;
    startLine: number;
    endLine: number;
    snippet: string;
  } | null>(null);
  const [text, setText] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (draft) editorRef.current?.focus();
  }, [draft]);

  const beginNote = () => {
    if (!target) return;
    setDraft({
      path: target.path,
      startLine: target.startLine,
      endLine: target.endLine,
      snippet: target.snippet,
    });
    setText("");
    clear();
    window.getSelection()?.removeAllRanges();
  };

  const saveDraft = () => {
    if (!draft) return;
    pad.add({ ...draft, text: text.trim() });
    setDraft(null);
    setText("");
  };

  const loc = (n: { path: string; startLine: number; endLine: number }) =>
    n.startLine === n.endLine
      ? `${n.path}:${n.startLine}`
      : `${n.path}:${n.startLine}-${n.endLine}`;

  return (
    <>
      {target && !draft && (
        <button
          className="add-note-fab"
          style={{ left: target.x, top: target.y - 34 }}
          onMouseDown={(e) => {
            // Keep the selection alive through the click.
            e.preventDefault();
            beginNote();
          }}
          title="add a note about this selection (n)"
        >
          ✎ note
        </button>
      )}

      {draft && (
        <div className="note-editor-overlay" onMouseDown={() => setDraft(null)}>
          <div className="note-editor" onMouseDown={(e) => e.stopPropagation()}>
            <div className="note-editor-loc">{loc(draft)}</div>
            {draft.snippet && (
              <div className="note-editor-snip">"{draft.snippet}"</div>
            )}
            <textarea
              ref={editorRef}
              value={text}
              placeholder="what's wrong here…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDraft();
                else if (e.key === "Escape") setDraft(null);
              }}
            />
            <div className="note-editor-actions">
              <span className="hint">⌘/Ctrl+Enter to save · Esc to cancel</span>
              <button onClick={saveDraft}>save note</button>
            </div>
          </div>
        </div>
      )}

      {pad.notes.length > 0 && (
        <div className="note-tray">
          <span className="note-tray-label">
            {pad.notes.length} note{pad.notes.length === 1 ? "" : "s"}
          </span>
          <div className="note-list">
            {pad.notes.map((n) => (
              <div key={n.id} className="note-item" title={formatNote(n)}>
                <span className="note-loc">{loc(n)}</span>
                <input
                  className="note-text"
                  value={n.text}
                  placeholder="(note)"
                  onChange={(e) => pad.update(n.id, e.target.value)}
                />
                <button
                  className="note-x"
                  onClick={() => pad.remove(n.id)}
                  title="remove note"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <span className="spacer" />
          <button onClick={() => void pad.copyAll()} title="copy all notes, one per line">
            copy all
          </button>
          <button onClick={() => pad.clear()} title="clear all notes">
            clear
          </button>
        </div>
      )}
    </>
  );
}
