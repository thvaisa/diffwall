// Shiki highlighting, server-side, cached. We highlight WHOLE files (never diff
// fragments) so grammar state — block comments, raw string literals, nested
// template angle brackets — is correct. Callers pass full old/new file content;
// this module returns per-line HTML that diff.ts maps by line number.
//
// Uses Shiki's fine-grained core bundle: createHighlighterCore with only the
// grammars and themes we register, loaded lazily on first use. No full bundle.

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

// Language id -> dynamic import of its Shiki grammar. Register only what the
// target codebase needs (physics-heavy C++ plus common repo files).
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  cmake: () => import("shiki/langs/cmake.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
};

const THEME_LOADERS: Record<string, () => Promise<unknown>> = {
  "one-dark-pro": () => import("shiki/themes/one-dark-pro.mjs"),
  "github-dark": () => import("shiki/themes/github-dark.mjs"),
  "github-light": () => import("shiki/themes/github-light.mjs"),
};

// Map file extensions / basenames to Shiki language ids.
const EXT_LANG: Record<string, string> = {
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",
  ipp: "cpp",
  tpp: "cpp",
  inl: "cpp",
  cu: "cpp",
  cuh: "cpp",
  py: "python",
  pyi: "python",
  cmake: "cmake",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
};

const BASENAME_LANG: Record<string, string> = {
  "CMakeLists.txt": "cmake",
  Dockerfile: "shellscript",
  Makefile: "shellscript",
};

/** Resolve a Shiki language id from a repo-relative path, or null for plaintext. */
export function langForPath(path: string): string | null {
  const slash = path.lastIndexOf("/");
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  if (BASENAME_LANG[base]) return BASENAME_LANG[base]!;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? null;
}

/** The public `lang` label shown to the client (falls back to "text"). */
export function langLabel(path: string): string {
  return langForPath(path) ?? "text";
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const loadedThemes = new Set<string>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [],
      langs: [],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
  }
  return highlighterPromise;
}

async function ensureLang(hl: HighlighterCore, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true;
  const loader = LANG_LOADERS[lang];
  if (!loader) return false;
  try {
    const mod = (await loader()) as { default: unknown };
    await hl.loadLanguage(mod.default as never);
    loadedLangs.add(lang);
    return true;
  } catch {
    return false;
  }
}

async function ensureTheme(hl: HighlighterCore, theme: string): Promise<string> {
  if (loadedThemes.has(theme)) return theme;
  const loader = THEME_LOADERS[theme] ?? THEME_LOADERS["one-dark-pro"]!;
  const resolved = THEME_LOADERS[theme] ? theme : "one-dark-pro";
  if (loadedThemes.has(resolved)) return resolved;
  const mod = (await loader()) as { default: unknown };
  await hl.loadTheme(mod.default as never);
  loadedThemes.add(resolved);
  return resolved;
}

// ---- LRU cache of highlighted files -------------------------------------------

import { createHash } from "node:crypto";

interface CacheEntry {
  lines: string[];
}

class Lru<V> {
  private map = new Map<string, V>();
  constructor(private limit: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

const cache = new Lru<CacheEntry>(400);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Plaintext fallback: one escaped line per input line, no highlighting. */
function plaintextLines(content: string): string[] {
  return content.split("\n").map((l) => escapeHtml(l));
}

/**
 * Highlight a whole file into per-line HTML strings (one entry per source line).
 * Cache key is sha1(content)+lang+theme. Never throws — falls back to escaped
 * plaintext on any highlighting failure or unknown language.
 */
export async function highlightFile(
  content: string,
  path: string,
  theme: string,
): Promise<string[]> {
  const lang = langForPath(path);
  const key =
    createHash("sha1").update(content).digest("hex") +
    "\0" +
    (lang ?? "text") +
    "\0" +
    theme;

  const hit = cache.get(key);
  if (hit) return hit.lines;

  let lines: string[];
  if (!lang) {
    lines = plaintextLines(content);
  } else {
    try {
      const hl = await getHighlighter();
      const okLang = await ensureLang(hl, lang);
      if (!okLang) {
        lines = plaintextLines(content);
      } else {
        const resolvedTheme = await ensureTheme(hl, theme);
        lines = highlightToLines(hl, content, lang, resolvedTheme);
      }
    } catch {
      lines = plaintextLines(content);
    }
  }

  cache.set(key, { lines });
  return lines;
}

/**
 * Run Shiki and extract inner HTML per line. We render to hast tokens and build
 * a <span> soup per line so the client can wrap each line itself. Using
 * codeToTokens keeps us independent of Shiki's <pre>/<code> wrapper markup.
 */
function highlightToLines(
  hl: HighlighterCore,
  content: string,
  lang: string,
  theme: string,
): string[] {
  const { tokens } = hl.codeToTokens(content, {
    lang: lang as never,
    theme: theme as never,
  });
  return tokens.map((lineTokens) =>
    lineTokens
      .map((t) => {
        const decls: string[] = [];
        if (t.color) decls.push(`color:${t.color}`);
        const fs = t.fontStyle;
        if (fs) {
          if (fs & 1) decls.push("font-style:italic");
          if (fs & 2) decls.push("font-weight:bold");
          if (fs & 4) decls.push("text-decoration:underline");
        }
        const style = decls.length ? ` style="${decls.join(";")}"` : "";
        return `<span${style}>${escapeHtml(t.content)}</span>`;
      })
      .join(""),
  );
}
