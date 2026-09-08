// Typed fetch wrappers for the diffwall API. Same-origin only.

import type {
  DiffResponse,
  FileResponse,
  HealthResponse,
  OpenResponse,
} from "../shared/types.js";

export interface DiffParams {
  base: string;
  context: number;
  untracked: boolean;
  whitespace: boolean;
}

export async function fetchDiff(
  params: DiffParams,
  signal?: AbortSignal,
): Promise<DiffResponse> {
  const q = new URLSearchParams({
    base: params.base,
    context: String(params.context),
    untracked: params.untracked ? "1" : "0",
    ws: params.whitespace ? "1" : "0",
  });
  const res = await fetch(`/api/diff?${q}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `diff request failed: ${res.status}`);
  }
  return (await res.json()) as DiffResponse;
}

export async function fetchFile(
  path: string,
  base: string,
  side: "new" | "old",
  signal?: AbortSignal,
): Promise<FileResponse> {
  const q = new URLSearchParams({ path, base, side });
  const res = await fetch(`/api/file?${q}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `file request failed: ${res.status}`);
  }
  return (await res.json()) as FileResponse;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch("/api/health", { signal });
  if (!res.ok) throw new Error(`health failed: ${res.status}`);
  return (await res.json()) as HealthResponse;
}

export async function openInVsCode(
  path: string,
  line: number,
): Promise<OpenResponse> {
  const res = await fetch("/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, line }),
  });
  return (await res.json()) as OpenResponse;
}
