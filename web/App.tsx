// Milestone 2: static wall. Fetches /api/diff once (plus manual refresh),
// renders all panes in fixed greedy columns, unified diff with gutters. No
// polling, no highlighting toggle, no resize yet — those land in M3, M6, M7.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiffResponse } from "../shared/types.js";
import { fetchDiff } from "./api.js";
import { assignColumns } from "./layout.js";
import { Pane } from "./Pane.js";

export function App() {
  const [base, setBase] = useState("HEAD");
  const [columnCount, setColumnCount] = useState(3);
  const [context] = useState(3);
  const [untracked] = useState(true);

  const [data, setData] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="app">
      <div className="toolbar">
        <span className="brand">diffwall</span>

        <label>
          base
          <input
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
                  <Pane key={file.path} file={file} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
