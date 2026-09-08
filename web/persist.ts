// Tiny localStorage helpers. All reads/writes are wrapped so a private window,
// disabled storage, or a parse error never breaks the app — we just fall back
// to the provided default. Keys are namespaced under "diffwall:".

const PREFIX = "diffwall:";

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore: storage unavailable or full */
  }
}
