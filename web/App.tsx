// Milestone 4: view modes. Per-path diff/full toggle (persisted), a default
// mode for new panes, lazy full-file fetch + virtualization, gap expansion, and
// focus + j/k/e keyboard navigation. Still one-shot fetch + manual refresh;
// polling lands in M6.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffResponse, ViewMode } from "../shared/types.js";
import { fetchDiff } from "./api.js";
import { assignColumns } from "./layout.js";
import { Pane, type PaneNav } from "./Pane.js";
import { loadJson, saveJson } from "./persist.js";

export function App() {
  const [base, setBase] = useState("HEAD");
  const [columnCount, setColumnCount] = useState(() =>
    loadJson<number>("columns", 3),
  );
  const [context] = useState(3);
  const [untracked] = useState(true);
  const [defaultMode, setDefaultMode] = useState<ViewMode>(() => {
    // URL query wins on first load (bookmarkable view); else persisted; else diff.
    const q = new URLSearchParams(location.search).get("view");
    if (q === "full" || q === "diff") return q;
    return loadJson<ViewMode>("defaultMode", "diff");
  });

  // Per-path view-mode overrides. A path absent here uses defaultMode.
  const [modes, setModes] = useState<Record<string, ViewMode>>(() =>
    loadJson<Record<string, ViewMode>>("modes", {}),
  );
  const [focused, setFocused] = useState<string | null>(null);

  const [data, setData] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => saveJson("columns", columnCount), [columnCount]);
  useEffect(() => saveJson("defaultMode", defaultMode), [defaultMode]);
  useEffect(() => saveJson("modes", modes), [modes]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const d = await fetchDiff(
          { base, context, untracked, whitespace: false },
          signal,
        );
        setData(d);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [base, context, untracked],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const columns = useMemo(
    () => (data ? assignColumns(data.files, columnCount) : []),
    [data, columnCount],
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

  // Ordered list of visible paths (column-major) for J/K pane navigation.
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

  // The focused pane registers its j/k navigation here.
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
        case "r":
          void load();
          break;
        case "e":
          if (focused) toggleMode(focused);
          break;
        case "j":
          navRef.current?.nav.next();
          break;
        case "k":
          navRef.current?.nav.prev();
          break;
        case "E":
          setAllModes(defaultMode === "diff" ? "full" : "diff");
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
  }, [load, focused, toggleMode, setAllModes, defaultMode, moveFocus]);

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

        <button onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "refresh"}
        </button>

        <span className="spacer" />

        {data && (
          <span className="totals">
            {data.totals.files} files{" "}
            <span className="add">+{data.totals.added}</span>{" "}
            <span className="del">−{data.totals.removed}</span>
          </span>
        )}
      </div>

      {data?.state.midOperation && (
        <div className="banner warn">
          {data.state.operation} in progress — the diff may be misleading.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

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
                    onRegisterNav={registerNav}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
