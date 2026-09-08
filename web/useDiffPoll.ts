// The live polling engine — the feature that justifies diffwall. Polls
// /api/diff on an interval, diffs each file's `hash` against the previous poll
// to drive per-pane flashing, and tracks connection health with backoff so a
// dead server shows a banner and reconnects on its own. Freezing pauses polling
// (but keeps counting pending changes so you know how far behind you are).

import { useCallback, useEffect, useRef, useState } from "react";
import { ChangeKind } from "../shared/types.js";
import type { DiffResponse } from "../shared/types.js";
import { fetchDiff, type DiffParams } from "./api.js";

export type { ChangeKind };

export interface PollState {
  data: DiffResponse | null;
  connected: boolean;
  /** Wall-clock ms of the last successful poll, for the "updated Ns ago" label. */
  lastUpdated: number | null;
  loading: boolean;
  /** Per-path change flags from the most recent applied poll (for flashing). */
  changed: Map<string, ChangeKind>;
  /** When frozen: number of files that changed/appeared/vanished since freezing. */
  pending: number;
  error: string | null;
}

export interface PollControls {
  refreshNow: () => void;
}

const MAX_BACKOFF = 15000;

export function useDiffPoll(
  params: DiffParams,
  intervalMs: number,
  frozen: boolean,
  /** When false, the polling loop is off entirely — no requests until a manual
   *  refresh. Distinct from `frozen`, which keeps polling to count pending. */
  autoPoll: boolean,
): [PollState, PollControls] {
  const [state, setState] = useState<PollState>({
    data: null,
    connected: true,
    lastUpdated: null,
    loading: false,
    changed: new Map(),
    pending: 0,
    error: null,
  });

  // Hash map from the last applied response, to detect per-file changes.
  const prevHashes = useRef<Map<string, string>>(new Map());
  // Hashes captured at the moment of freezing, to count pending changes.
  const frozenHashes = useRef<Map<string, string> | null>(null);
  const backoff = useRef(0);
  const timer = useRef<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  // Latest params/interval/frozen without retriggering the effect each render.
  const paramsRef = useRef(params);
  const intervalRef = useRef(intervalMs);
  const frozenRef = useRef(frozen);
  paramsRef.current = params;
  intervalRef.current = intervalMs;

  const computeChanges = useCallback(
    (files: DiffResponse["files"]): Map<string, ChangeKind> => {
      const changes = new Map<string, ChangeKind>();
      const prev = prevHashes.current;
      for (const f of files) {
        const before = prev.get(f.path);
        if (before === undefined) changes.set(f.path, ChangeKind.New);
        else if (before !== f.hash) changes.set(f.path, ChangeKind.Changed);
      }
      return changes;
    },
    [],
  );

  const hashesOf = (d: DiffResponse): Map<string, string> => {
    const m = new Map<string, string>();
    for (const f of d.files) m.set(f.path, f.hash);
    return m;
  };

  const countPending = (d: DiffResponse): number => {
    const base = frozenHashes.current;
    if (!base) return 0;
    let n = 0;
    const seen = new Set<string>();
    for (const f of d.files) {
      seen.add(f.path);
      const before = base.get(f.path);
      if (before === undefined || before !== f.hash) n++;
    }
    for (const path of base.keys()) if (!seen.has(path)) n++; // vanished
    return n;
  };

  const poll = useCallback(async () => {
    inFlight.current?.abort();
    const ac = new AbortController();
    inFlight.current = ac;
    setState((s) => ({ ...s, loading: true }));
    try {
      const d = await fetchDiff(paramsRef.current, ac.signal);
      backoff.current = 0;

      if (frozenRef.current) {
        // Frozen: don't swap the visible data; just track how far behind we are.
        setState((s) => ({
          ...s,
          connected: true,
          loading: false,
          error: null,
          pending: countPending(d),
        }));
      } else {
        const changes = computeChanges(d.files);
        prevHashes.current = hashesOf(d);
        setState({
          data: d,
          connected: true,
          lastUpdated: Date.now(),
          loading: false,
          changed: changes,
          pending: 0,
          error: null,
        });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      backoff.current = Math.min(
        MAX_BACKOFF,
        backoff.current ? backoff.current * 2 : 1000,
      );
      setState((s) => ({
        ...s,
        connected: false,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [computeChanges]);

  // Freeze/unfreeze bookkeeping.
  useEffect(() => {
    frozenRef.current = frozen;
    if (frozen) {
      frozenHashes.current = new Map(prevHashes.current);
      setState((s) => ({ ...s, pending: 0 }));
    } else {
      frozenHashes.current = null;
      setState((s) => ({ ...s, pending: 0 }));
      void poll(); // catch up immediately on unfreeze
    }
  }, [frozen, poll]);

  // The polling loop. Always does one initial poll so the wall shows current
  // state on load; reschedules itself only while autoPoll is on (honoring
  // backoff after failures). With autoPoll off, it stops after the first poll
  // and only a manual refresh fetches again. (Freeze still polls to count
  // pending changes; that is the point of freeze vs. turning auto-poll off.)
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await poll();
      if (stopped || !autoPoll) return;
      const wait = backoff.current || intervalRef.current;
      timer.current = window.setTimeout(tick, wait);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer.current) window.clearTimeout(timer.current);
      inFlight.current?.abort();
    };
    // Re-arm the loop when params, interval, or the autoPoll switch change.
  }, [
    poll,
    autoPoll,
    params.base,
    params.context,
    params.untracked,
    params.whitespace,
    intervalMs,
  ]);

  const refreshNow = useCallback(() => void poll(), [poll]);

  return [state, { refreshNow }];
}
