// Milestone 7: resize + persistence. Adds draggable column splitters (flex
// ratios) and per-pane height resize, a base-ref combobox, a help overlay, and
// URL-query mirroring of all settings so a view is bookmarkable and each tab can
// hold its own config. Builds on M6's live polling.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SortMode, ViewMode } from "../shared/types.js";
import type { FileDiff } from "../shared/types.js";
import { assignColumns } from "./layout.js";
import { Pane, type PaneNav } from "./Pane.js";
import { loadJson, saveJson } from "./persist.js";
import { useReferences } from "./references.js";
import { RefTray } from "./RefTray.js";
import { useNotes } from "./notes.js";
import { NotePad } from "./NotePad.js";
import { useDiffPoll } from "./useDiffPoll.js";
import { useColumnWidths } from "./useColumnWidths.js";
import { usePaneHeights } from "./usePaneHeights.js";
import { readUrlSettings, useUrlSync } from "./useUrlState.js";
import { BaseSelect } from "./BaseSelect.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { FileTree } from "./FileTree.js";
import { isHidden } from "./fileTree.js";

export function App() {
  // URL query overrides localStorage on first load (bookmarkable / per-tab).
  const url = readUrlSettings();

  const [base, setBase] = useState(url.base ?? "HEAD");
  const [columnCount, setColumnCount] = useState(
    () => url.columns ?? loadJson<number>("columns", 3),
  );
  const [context] = useState(3);
  const [untracked] = useState(true);
  const [intervalMs, setIntervalMs] = useState(
    () => url.interval ?? loadJson<number>("interval", 2000),
  );
  const [autoPoll, setAutoPoll] = useState(
    () => url.auto ?? loadJson<boolean>("autoPoll", true),
  );
  const [frozen, setFrozen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (url.sort as SortMode) ?? loadJson<SortMode>("sort", SortMode.Path),
  );
  const [defaultMode, setDefaultMode] = useState<ViewMode>(() => {
    if (url.view === ViewMode.Full || url.view === ViewMode.Diff) return url.view;
    return loadJson<ViewMode>("defaultMode", ViewMode.Diff);
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(() =>
    loadJson<boolean>("treeOpen", false),
  );
  const [hiddenDirs, setHiddenDirs] = useState<Set<string>>(
    () => new Set(loadJson<string[]>("hiddenDirs", [])),
  );

  const columnWidths = useColumnWidths(columnCount);
  const paneHeights = usePaneHeights();

  const [modes, setModes] = useState<Record<string, ViewMode>>(() =>
    loadJson<Record<string, ViewMode>>("modes", {}),
  );
  const [focused, setFocused] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);

  const tray = useReferences();
  const notes = useNotes();

  useEffect(() => saveJson("columns", columnCount), [columnCount]);
  useEffect(() => saveJson("defaultMode", defaultMode), [defaultMode]);
  useEffect(() => saveJson("modes", modes), [modes]);
  useEffect(() => saveJson("interval", intervalMs), [intervalMs]);
  useEffect(() => saveJson("sort", sortMode), [sortMode]);
  useEffect(() => saveJson("autoPoll", autoPoll), [autoPoll]);
  useEffect(() => saveJson("treeOpen", treeOpen), [treeOpen]);
  useEffect(
    () => saveJson("hiddenDirs", [...hiddenDirs]),
    [hiddenDirs],
  );

  const toggleHiddenDir = useCallback((dirPath: string) => {
    setHiddenDirs((cur) => {
      const next = new Set(cur);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const toggleZoom = useCallback((path: string) => {
    setZoomed((cur) => (cur === path ? null : path));
  }, []);

  // Scroll to and focus a file's pane when picked from the tree.
  const pickFile = useCallback((path: string) => {
    setFocused(path);
    const el = document.querySelector(
      `[data-pane-path="${CSS.escape(path)}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Mirror settings into the URL so a configured view is bookmarkable and each
  // tab can carry its own config independent of shared localStorage.
  useUrlSync({
    base,
    columns: columnCount,
    view: defaultMode,
    sort: sortMode,
    interval: intervalMs,
    auto: autoPoll,
  });

  const params = useMemo(
    () => ({ base, context, untracked, whitespace: false }),
    [base, context, untracked],
  );

  const [poll, controls] = useDiffPoll(params, intervalMs, frozen, autoPoll);
  const { data, connected, lastUpdated, changed, pending } = poll;

  // If the zoomed file vanishes from the diff (reverted, staged away), drop
  // the zoom instead of showing a stale/empty overlay.
  useEffect(() => {
    if (!zoomed || !data) return;
    if (!data.files.some((f) => f.path === zoomed)) setZoomed(null);
  }, [zoomed, data]);

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
    // Drop files under any hidden folder (the tree's eye toggles).
    const files = data.files.filter((f) => !isHidden(f.path, hiddenDirs));
    if (sortMode === SortMode.Recent && !frozen) {
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
  }, [data, sortMode, frozen, changed, hiddenDirs]);

  const columns = useMemo(
    () => assignColumns(orderedFiles, columnCount),
    [orderedFiles, columnCount],
  );

  // Markdown files default to full view (rendered preview) unless the user has
  // explicitly overridden the mode for that path.
  const modeFor = useCallback(
    (path: string): ViewMode => {
      const override = modes[path];
      if (override) return override;
      if (/\.(md|markdown)$/i.test(path)) return ViewMode.Full;
      return defaultMode;
    },
    [modes, defaultMode],
  );

  const toggleMode = useCallback(
    (path: string) => {
      setModes((m) => {
        const cur = m[path] ?? defaultMode;
        return {
          ...m,
          [path]: cur === ViewMode.Diff ? ViewMode.Full : ViewMode.Diff,
        };
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
        case "z":
          if (focused) toggleZoom(focused);
          break;
        case "E":
          setAllModes(
            defaultMode === ViewMode.Diff ? ViewMode.Full : ViewMode.Diff,
          );
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
        case "b":
          setTreeOpen((v) => !v);
          break;
        case "?":
          setHelpOpen((v) => !v);
          break;
        case "Escape":
          if (zoomed) setZoomed(null);
          else setHelpOpen(false);
          break;
        default:
          if (e.key >= "1" && e.key <= "6") setColumnCount(Number(e.key));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    controls,
    focused,
    toggleMode,
    setAllModes,
    defaultMode,
    moveFocus,
    autoPoll,
    zoomed,
    toggleZoom,
  ]);

  return (
    <div className="app">
      <div className="toolbar">
        <button
          className={`tree-btn${treeOpen ? " on" : ""}`}
          onClick={() => setTreeOpen((v) => !v)}
          title="toggle file tree (b)"
        >
          ☰
        </button>
        <span className="brand">diffwall</span>

        <label>
          base
          <BaseSelect value={base} onChange={setBase} inputRef={baseInputRef} />
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
          <IntervalInput
            value={intervalMs}
            disabled={!autoPoll}
            onCommit={setIntervalMs}
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
        <button
          className="help-btn"
          onClick={() => setHelpOpen((v) => !v)}
          title="keyboard & mouse help (?)"
        >
          ?
        </button>
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

      <div className="main">
        {treeOpen && data && (
          <FileTree
            files={data.files}
            hidden={hiddenDirs}
            onToggleHidden={toggleHiddenDir}
            onPickFile={pickFile}
            focusedPath={focused}
            onClose={() => setTreeOpen(false)}
          />
        )}
        <div className="wall">
        {data && data.files.length === 0 ? (
          <div className="empty-state">
            No changes against <code>{data.base}</code>.
          </div>
        ) : (
          <div className="columns" ref={columnWidths.containerRef}>
            {columns.map((col, ci) => (
              <FragmentColumn key={ci}>
                <div
                  className="column"
                  style={{ flex: `${columnWidths.ratios[ci] ?? 1 / columnCount} 1 0` }}
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
                      height={paneHeights.get(file.path)}
                      onSetHeight={paneHeights.set}
                      onClearHeight={paneHeights.clear}
                      onRegisterNav={registerNav}
                      zoomed={zoomed === file.path}
                      onToggleZoom={toggleZoom}
                    />
                  ))}
                </div>
                {ci < columns.length - 1 && (
                  <div
                    className="col-splitter"
                    title="drag to resize columns"
                    onMouseDown={(e) => columnWidths.onSplitterDown(ci, e)}
                  />
                )}
              </FragmentColumn>
            ))}
          </div>
        )}
        </div>
      </div>

      <RefTray tray={tray} />
      <NotePad pad={notes} />
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      {zoomed && data && (() => {
        const file = data.files.find((f) => f.path === zoomed);
        if (!file) return null;
        return (
          <div className="zoom-overlay" onMouseDown={() => setZoomed(null)}>
            <div className="zoom-frame" onMouseDown={(e) => e.stopPropagation()}>
              <Pane
                file={file}
                base={data.base}
                mode={modeFor(file.path)}
                onToggleMode={toggleMode}
                focused={true}
                onFocus={setFocused}
                tray={tray}
                flash={changed.get(file.path) ?? null}
                onRegisterNav={registerNav}
                zoomed={true}
                onToggleZoom={toggleZoom}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// A keyed fragment wrapper so a column + its splitter share one list key.
function FragmentColumn({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// Poll-interval field. A plain text box (no native number spinner — its arrows
// fired onChange but never committed) flanked by explicit − / + steppers that
// apply immediately. Typing holds free text so you can clear and retype without
// it fighting back; it commits on Enter or blur. Arrow keys also step.
const MIN_INTERVAL = 250;
const STEP = 250;
function IntervalInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (ms: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // Reflect external changes only while the user isn't typing.
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const clamp = (n: number) => Math.max(MIN_INTERVAL, Math.round(n));

  const commit = () => {
    setEditing(false);
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && n > 0) onCommit(clamp(n));
    else setText(String(value)); // reject junk, restore last good value
  };

  const step = (delta: number) => {
    // Step from the current committed value and apply immediately.
    const next = clamp(value + delta);
    onCommit(next);
    setText(String(next));
  };

  return (
    <span className="interval-input">
      <button
        type="button"
        disabled={disabled}
        onClick={() => step(-STEP)}
        title="decrease interval"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "ArrowUp") {
            e.preventDefault();
            step(STEP);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            step(-STEP);
          }
        }}
        title="poll interval (ms); applies on Enter or blur"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => step(STEP)}
        title="increase interval"
      >
        +
      </button>
    </span>
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
