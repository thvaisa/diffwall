// Lazily fetch /api/file for a pane in full mode. Refetches only when the file's
// hash changes (an unchanged file keeps its cached full view across polls) or
// when the base ref changes. Deleted files are fetched from the old side.

import { useEffect, useRef, useState } from "react";
import type { FileResponse } from "../shared/types.js";
import { fetchFile } from "./api.js";

interface State {
  data: FileResponse | null;
  loading: boolean;
  error: string | null;
}

export function useFullFile(
  path: string,
  base: string,
  hash: string,
  side: "new" | "old",
  active: boolean,
): State {
  const [state, setState] = useState<State>({
    data: null,
    loading: false,
    error: null,
  });
  // Track what we last fetched so we refetch only on real change.
  const fetchedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const key = `${path}\0${base}\0${hash}\0${side}`;
    if (fetchedKey.current === key && state.data) return;

    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchFile(path, base, side, ac.signal)
      .then((data) => {
        fetchedKey.current = key;
        setState({ data, loading: false, error: null });
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setState({ data: null, loading: false, error: e.message });
      });
    return () => ac.abort();
    // state.data intentionally omitted: we gate on fetchedKey, not data identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, base, hash, side, active]);

  return state;
}
