// Milestone 6: live. Polls /api/diff on an interval, flashes only the panes that
// changed, preserves everything else (scroll, view mode) via keyed reconciliation,
// freezes on demand with a pending-change count, sorts by path or recency, and
// reconnects with backoff when the server dies. Interval + freeze + sort are in
// the toolbar and persist.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileDiff, ViewMode } from "../shared/types.js";
import { assignColumns } from "./layout.js";
import { Pane, type PaneNav } from "./Pane.js";
import { loadJson, saveJson } from "./persist.js";
import { useReferences } from "./references.js";
import { RefTray } from "./RefTray.js";
import { useDiffPoll } from "./useDiffPoll.js";

type SortMode = "path" | "recent";

export function App() {
  const [base, setBase] = useState("HEAD");
  const [columnCount, setColumnCount] = useState(() =>
    loadJson<number>("columns", 3),
  );
  const [context] = useState(3);
  const [untracked] = useState(true);
  const [intervalMs, setIntervalMs] = useState(() =>
    loadJson<number>("interval", 2000),
  );
  const [autoPoll, setAutoPoll] = useState(() =>
    loadJson<boolean>("autoPoll", true),
  );
  const [frozen, setFrozen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    loadJson<SortMode>("sort", "path"),
  );
  const [defaultMode, setDefaultMode] = useState<ViewMode>(() => {
    const q = new URLSearchParams(location.search).get("view");
    if (q === "full" || q === "diff") return q;
    return loadJson<ViewMode>("defaultMode", "diff");
  });

  const [modes, setModes] = useState<Record<string, ViewMode>>(() =>
    loadJson<Record<string, ViewMode>>("modes", {}),
  );
  const [focused, setFocused] = useState<string | null>(null);

  const tray = useReferences();

  useEffect(() => saveJson("columns", columnCount), [columnCount]);
  useEffect(() => saveJson("defaultMode", defaultMode), [defaultMode]);
  useEffect(() => saveJson("modes", modes), [modes]);
  useEffect(() => saveJson("interval", intervalMs), [intervalMs]);
  useEffect(() => saveJson("sort", sortMode), [sortMode]);
  useEffect(() => saveJson("autoPoll", autoPoll), [autoPoll]);

  const params = useMemo(
    () => ({ base, context, untracked, whitespace: false }),
    [base, context, untracked],
  );

  const [poll, controls] = useDiffPoll(params, intervalMs, frozen, autoPoll);
  const { data, connected, lastUpdated, changed, pending } = poll;

  // Track most-recent-change time per path for the `recent` sort.
  const recencyRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (changed.size === 0) return;
    const now = Date.now();
    for (const path of changed.keys()) recencyRef.current.set(path, now);
  }, [changed]);

  // Order the file set. `path` is stable; `recent` puts freshest first. We only
  // reorder when the file set or sort changes — never mid-read while frozen.
  const orderedFiles = useMemo<FileDiff[]>(() => {
    if (!data) return [];
    const files = [...data.files];
    if (sortMode === "recent" && !frozen) {
      files.sort((a, b) => {
        const ra = recencyRef.current.get(a.path) ?? 0;
        const rb = recencyRef.current.get(b.path) ?? 0;
        if (ra !== rb) return rb - ra;
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
      });
    } else {
      files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    }
    return files;
    // recencyRef is a ref; changed drives re-eval so recency updates take effect.
  }, [data, sortMode, frozen, changed]);

  const columns = useMemo(
    () => assignColumns(orderedFiles, columnCount),
    [orderedFiles, columnCount],
  );

  const modeFor = useCallback(
    (path: string): ViewMode => modes[path] ?? defaultMode,
    [modes, defaultMode],
  );

  const toggleMode = useCallback(
    (path: string) => {
      setModes((m) => {
        const cur = m[path] ?? defaultMode;
        return { ...m, [path]: cur === "diff" ? "full" : "diff" };
      });
    },
    [defaultMode],
  );

  const setAllModes = useCallback(
    (mode: ViewMode) => {
      setDefaultMode(mode);
      if (!data) return;
      const next: Record<string, ViewMode> = {};
      for (const f of data.files) next[f.path] = mode;
      setModes(next);
    },
    [data],
  );

  const orderedPaths = useMemo(
    () => columns.flat().map((f) => f.path),
    [columns],
  );

  const moveFocus = useCallback(
    (delta: number) => {
      if (orderedPaths.length === 0) return;
      const i = focused ? orderedPaths.indexOf(focused) : -1;
      const next = Math.max(0, Math.min(orderedPaths.length - 1, i + delta));
      setFocused(orderedPaths[next] ?? null);
    },
    [orderedPaths, focused],
  );

  const baseInputRef = useRef<HTMLInputElement | null>(null);
  const navRef = useRef<{ path: string; nav: PaneNav } | null>(null);
  const registerNav = useCallback((path: string, nav: PaneNav | null) => {
    if (nav) navRef.current = { path, nav };
    else if (navRef.current?.path === path) navRef.current = null;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")
        return;
      switch (e.key) {
        case "a":
          setAutoPoll((v) => !v);
          break;
        case "f":
          setFrozen((v) => (autoPoll ? !v : v));
          break;
        case "r":
          controls.refreshNow();
          break;
        case "e":
          if (focused) toggleMode(focused);
          break;
        case "E":
          setAllModes(defaultMode === "diff" ? "full" : "diff");
          break;
        case "j":
          navRef.current?.nav.next();
          break;
        case "k":
          navRef.current?.nav.prev();
          break;
        case "J":
          moveFocus(1);
          break;
        case "K":
          moveFocus(-1);
          break;
        case "/":
          e.preventDefault();
          baseInputRef.current?.focus();
          break;
        default:
          if (e.key >= "1" && e.key <= "6") setColumnCount(Number(e.key));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controls, focused, toggleMode, setAllModes, defaultMode, moveFocus, autoPoll]);

  return (
    <div className="app">
      <div className="toolbar">
        <span className="brand">diffwall</span>

        <label>
          base
          <input
            ref={baseInputRef}
            className="base-input"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            spellCheck={false}
          />
        </label>

        <label>
          columns
          <select
            value={columnCount}
            onChange={(e) => setColumnCount(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label>
          view
          <select
            value={defaultMode}
            onChange={(e) => setAllModes(e.target.value as ViewMode)}
            title="default view mode; sets all panes"
          >
            <option value="diff">diff</option>
            <option value="full">full</option>
          </select>
        </label>

        <label>
          sort
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            title="pane order"
          >
            <option value="path">path</option>
            <option value="recent">recent</option>
          </select>
        </label>

        <label title="turn automatic polling on/off (a)">
          <input
            type="checkbox"
            checked={autoPoll}
            onChange={(e) => setAutoPoll(e.target.checked)}
          />
          auto
        </label>

        <label>
          every
          <input
            type="number"
            min={250}
            step={250}
            value={intervalMs}
            disabled={!autoPoll}
            onChange={(e) =>
              setIntervalMs(Math.max(250, Number(e.target.value) || 2000))
            }
            title="poll interval (ms)"
          />
          ms
        </label>

        <button
          className={frozen ? "frozen" : ""}
          onClick={() => setFrozen((v) => !v)}
          disabled={!autoPoll}
          title={
            autoPoll
              ? "freeze / unfreeze polling (f)"
              : "auto-poll is off; nothing to freeze"
          }
        >
          {frozen ? `frozen${pending ? ` · ${pending} pending` : ""}` : "freeze"}
        </button>

        <button onClick={() => controls.refreshNow()}>refresh</button>

        <span className="spacer" />

        {data && (
          <span className="totals">
            {data.totals.files} files{" "}
            <span className="add">+{data.totals.added}</span>{" "}
            <span className="del">−{data.totals.removed}</span>
          </span>
        )}
        <LastUpdated at={lastUpdated} />
      </div>

      {!connected && (
        <div className="banner error">
          disconnected from server — retrying…
        </div>
      )}
      {data?.state.midOperation && (
        <div className="banner warn">
          {data.state.operation} in progress — the diff may be misleading.
        </div>
      )}

      <div className="wall">
        {data && data.files.length === 0 ? (
          <div className="empty-state">
            No changes against <code>{data.base}</code>.
          </div>
        ) : (
          <div className="columns">
            {columns.map((col, ci) => (
              <div
                key={ci}
                className="column"
                style={{ flex: `1 1 ${100 / columnCount}%` }}
              >
                {col.map((file) => (
                  <Pane
                    key={file.path}
                    file={file}
                    base={data!.base}
                    mode={modeFor(file.path)}
                    onToggleMode={toggleMode}
                    focused={focused === file.path}
                    onFocus={setFocused}
                    tray={tray}
                    flash={changed.get(file.path) ?? null}
                    onRegisterNav={registerNav}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <RefTray tray={tray} />
    </div>
  );
}

// Live-updating "updated Ns ago" label.
function LastUpdated({ at }: { at: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (at == null) return null;
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  return <span className="last-updated">updated {secs}s ago</span>;
}
