// Base-ref picker: a free-text input (backed by a datalist of branches/tags)
// plus a visible <select> for quickly jumping between HEAD and the last few
// commits (fetched once from the read-only /api/refs). You can type any ref —
// a commit sha, HEAD~3, origin/main — into the text field, or pick a recent
// commit from the dropdown. Choosing/typing a base only changes what git diffs
// against; it never modifies the repository.

import { useEffect, useState } from "react";
import type { RefsResponse } from "../shared/types.js";

export function BaseSelect({
  repoId,
  value,
  onChange,
  inputRef,
}: {
  repoId: string;
  value: string;
  onChange: (base: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [refs, setRefs] = useState<RefsResponse | null>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/refs?repo=${encodeURIComponent(repoId)}`, { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<RefsResponse>) : null))
      .then((d) => d && setRefs(d))
      .catch(() => {});
    return () => ac.abort();
  }, [repoId]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onChange(v);
    else setDraft(value);
  };

  const truncate = (s: string, n: number): string =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  // Value is the current base only when it exactly matches HEAD or one of the
  // recent commit hashes; otherwise the select shows its placeholder so a
  // custom/typed ref (a branch, HEAD~3, ...) doesn't get misrepresented as a
  // commit pick.
  const commitHashes = new Set(refs?.commits.map((c) => c.hash) ?? []);
  const selectValue = value === "HEAD" || commitHashes.has(value) ? value : "";

  return (
    <>
      <select
        className="base-select"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v) onChange(v);
        }}
        title="jump to HEAD or a recent commit"
      >
        {selectValue === "" && <option value="" disabled hidden></option>}
        <option value="HEAD">HEAD</option>
        {refs?.commits.map((c, i) => (
          <option
            key={`c:${c.hash}`}
            value={c.hash}
            title={`${c.hash} ${c.subject}`}
          >
            -{i + 1}: {truncate(c.subject, 40)}
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        className="base-input"
        list={`diffwall-refs-${repoId}`}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        title="base ref to diff against (read-only; type any ref or pick one)"
      />
      <datalist id={`diffwall-refs-${repoId}`}>
        <option value="HEAD" />
        {refs?.commits.map((c) => (
          <option key={`c:${c.hash}`} value={c.hash} label={c.subject} />
        ))}
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
