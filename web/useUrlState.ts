// Mirror the toolbar settings into the URL query so a configured view can be
// bookmarked and each tab can carry its own config independent of localStorage.
// The URL is the source of truth on first load (see readInitial); thereafter we
// push changes into it with replaceState (no history spam).

import { useEffect } from "react";

export interface UrlSettings {
  base: string;
  columns: number;
  view: string;
  sort: string;
  interval: number;
  auto: boolean;
}

/** Read any settings present in the URL query at load time. Missing keys → null. */
export function readUrlSettings(): Partial<UrlSettings> {
  const q = new URLSearchParams(location.search);
  const out: Partial<UrlSettings> = {};
  const base = q.get("base");
  if (base) out.base = base;
  const columns = q.get("columns");
  if (columns && /^[1-6]$/.test(columns)) out.columns = Number(columns);
  const view = q.get("view");
  if (view === "diff" || view === "full") out.view = view;
  const sort = q.get("sort");
  if (sort === "path" || sort === "recent") out.sort = sort;
  const interval = q.get("interval");
  if (interval && /^\d+$/.test(interval)) out.interval = Number(interval);
  const auto = q.get("auto");
  if (auto === "0" || auto === "1") out.auto = auto === "1";
  return out;
}

/** Keep the URL query in sync with current settings (replaceState, no reload). */
export function useUrlSync(settings: UrlSettings): void {
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("base", settings.base);
    q.set("columns", String(settings.columns));
    q.set("view", settings.view);
    q.set("sort", settings.sort);
    q.set("interval", String(settings.interval));
    q.set("auto", settings.auto ? "1" : "0");
    const next = `${location.pathname}?${q.toString()}`;
    if (next !== location.pathname + location.search) {
      history.replaceState(null, "", next);
    }
  }, [
    settings.base,
    settings.columns,
    settings.view,
    settings.sort,
    settings.interval,
    settings.auto,
  ]);
}
