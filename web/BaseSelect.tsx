// Base-ref picker: a free-text input backed by a datalist of the repo's
// branches and tags (fetched once from the read-only /api/refs). You can type
// any ref — a commit sha, HEAD~3, origin/main — or pick a known one from the
// dropdown. Choosing/typing a base only changes what git diffs against; it never
// modifies the repository.

import { useEffect, useState } from "react";
import type { RefsResponse } from "../shared/types.js";

export function BaseSelect({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (base: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [refs, setRefs] = useState<RefsResponse | null>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/refs", { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<RefsResponse>) : null))
      .then((d) => d && setRefs(d))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onChange(v);
    else setDraft(value);
  };

  return (
    <>
      <input
        ref={inputRef}
        className="base-input"
        list="diffwall-refs"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        title="base ref to diff against (read-only; type any ref or pick one)"
      />
      <datalist id="diffwall-refs">
        <option value="HEAD" />
        {refs?.branches.map((b) => (
          <option key={`b:${b}`} value={b} />
        ))}
        {refs?.tags.map((t) => (
          <option key={`t:${t}`} value={t} />
        ))}
      </datalist>
    </>
  );
}
