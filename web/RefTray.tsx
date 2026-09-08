// The reference tray at the bottom of the window. Shows collected refs as
// chips; "copy all" emits them one per line, ready to paste at an agent. Hidden
// when empty so it takes no space until you start collecting.

import { formatRef, type RefTray as Tray } from "./references.js";

export function RefTray({ tray }: { tray: Tray }) {
  if (tray.refs.length === 0) return null;

  return (
    <div className="ref-tray">
      <span className="ref-tray-label">
        {tray.refs.length} ref{tray.refs.length === 1 ? "" : "s"}
      </span>
      <div className="ref-chips">
        {tray.refs.map((r, i) => (
          <span key={i} className="ref-chip">
            {formatRef(r)}
            <button
              className="ref-chip-x"
              title="remove"
              onClick={() => tray.remove(i)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <span className="spacer" />
      <button onClick={() => void tray.copyAll()} title="copy all, one per line">
        copy all
      </button>
      <button onClick={() => tray.clear()} title="clear the tray">
        clear
      </button>
    </div>
  );
}
