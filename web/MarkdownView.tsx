// Rendered Markdown view for .md files in full mode. markdown-it produces the
// HTML (raw inline HTML disabled — we render repo content, so no passthrough of
// arbitrary tags); fenced ```mermaid blocks are extracted and rendered as SVG by
// mermaid on the client. A "source" toggle in the pane flips back to the
// highlighted source view.

import { useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";

// One shared parser. `html: false` means embedded raw HTML in the Markdown is
// escaped, not passed through — safe for rendering untrusted repo files.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

// Mermaid is loaded lazily on first use so a repo with no diagrams pays nothing.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

interface Block {
  kind: "html" | "mermaid";
  content: string;
}

/**
 * Split source into rendered-HTML segments and mermaid segments. We pull fenced
 * ```mermaid blocks out first so markdown-it doesn't turn them into <pre><code>,
 * then render the surrounding Markdown normally.
 */
function toBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const re = /^```mermaid[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const before = source.slice(last, m.index);
    if (before.trim()) blocks.push({ kind: "html", content: md.render(before) });
    blocks.push({ kind: "mermaid", content: m[1] ?? "" });
    last = re.lastIndex;
  }
  const rest = source.slice(last);
  if (rest.trim()) blocks.push({ kind: "html", content: md.render(rest) });
  return blocks;
}

export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => toBlocks(source), [source]);

  return (
    <div className="markdown-body">
      {blocks.map((b, i) =>
        b.kind === "html" ? (
          <div key={i} dangerouslySetInnerHTML={{ __html: b.content }} />
        ) : (
          <MermaidBlock key={i} code={b.content} />
        ),
      )}
    </div>
  );
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A stable-ish unique id per instance for mermaid's render call.
  const id = useMemo(() => `mmd-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg }) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <pre className="mermaid-error" title={error}>
        mermaid error — showing source:{"\n"}
        {code}
      </pre>
    );
  }
  return <div className="mermaid-diagram" ref={ref} />;
}
