// Keyboard-shortcut help overlay, toggled with `?`. Purely informational.

const KEYS: [string, string][] = [
  ["b", "toggle the file tree sidebar"],
  ["f", "freeze / unfreeze polling"],
  ["a", "toggle automatic polling"],
  ["r", "refresh now"],
  ["e", "toggle diff / full view on the focused pane"],
  ["E", "toggle view mode on all panes"],
  ["j / k", "jump to next / previous changed region (full view)"],
  ["J / K", "focus next / previous pane"],
  ["1 – 6", "set column count"],
  ["/", "focus the base input"],
  ["?", "show / hide this help"],
];

const MOUSE: [string, string][] = [
  ["click line number", "copy path:line reference"],
  ["shift-click", "copy a range path:a-b"],
  ["drag across gutter", "select a line range"],
  ["alt-click / ⧉ icon", "open the line in VS Code"],
  ["drag column splitter", "resize columns"],
  ["drag pane bottom edge", "resize pane height (double-click: auto)"],
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <span>diffwall — shortcuts</span>
          <button onClick={onClose} title="close (?)">
            ×
          </button>
        </div>
        <div className="help-cols">
          <div>
            <h4>keyboard</h4>
            {KEYS.map(([k, d]) => (
              <div className="help-row" key={k}>
                <kbd>{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
          <div>
            <h4>mouse</h4>
            {MOUSE.map(([k, d]) => (
              <div className="help-row" key={k}>
                <span className="help-gesture">{k}</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="help-foot">
          read-only viewer · binds 127.0.0.1 · never writes to the repo
        </div>
      </div>
    </div>
  );
}
