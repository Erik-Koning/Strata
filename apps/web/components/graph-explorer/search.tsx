"use client";
// Find a node by its name or words: the matches drop down as you type, and choosing one opens it and brings it into
// view. Arrow keys move through the matches, Enter opens one, Escape closes the list.
import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { type GraphNode, KIND_COLOR, KIND_LABEL } from "../../server/hub/graph-model.ts";

const MATCHES_SHOWN = 8;

export function NodeSearch({ nodes, onPick }: { nodes: GraphNode[]; onPick: (id: string) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored = nodes.flatMap((n) => {
      const label = n.label.toLowerCase();
      const at = label.indexOf(q);
      if (at >= 0) return [{ n, score: at === 0 ? 0 : 1 }];
      return (n.text ?? "").toLowerCase().includes(q) || (n.context ?? "").toLowerCase().includes(q)
        ? [{ n, score: 2 }]
        : [];
    });
    return scored
      .sort(
        (a, b) => a.score - b.score || b.n.metrics.degree - a.n.metrics.degree || a.n.label.localeCompare(b.n.label),
      )
      .slice(0, MATCHES_SHOWN)
      .map((s) => s.n);
  }, [nodes, query]);

  const pick = (node: GraphNode | undefined) => {
    if (!node) return;
    onPick(node.id);
    setOpen(false);
  };
  const expanded = open && query.trim().length > 0;

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={`${id}-input`} className="sr-only">
        Find a node
      </label>
      <Search
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
        aria-hidden
      />
      <input
        id={`${id}-input`}
        type="search"
        role="combobox"
        aria-expanded={expanded && matches.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={expanded && matches[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
        placeholder="Find a node"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="input min-h-11 pl-9 text-[14px] sm:min-h-9"
      />
      {expanded && matches.length ? (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Matching nodes"
          className="absolute inset-x-0 top-[calc(100%+4px)] z-30 max-h-80 overflow-y-auto rounded-[10px] bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          {matches.map((n, i) => (
            <div
              key={n.id}
              id={`${id}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              // Chosen on press, before the input's blur closes the list.
              onPointerDown={(e) => {
                e.preventDefault();
                pick(n);
              }}
              onPointerEnter={() => setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[7px] px-2.5 text-[13px] sm:min-h-9 ${
                i === active ? "bg-surface-2 text-ink" : "text-ink-2"
              }`}
            >
              <span className="dot" style={{ color: KIND_COLOR[n.kind] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
              <span className="flex-none text-[11.5px] text-ink-3">{KIND_LABEL[n.kind].one}</span>
            </div>
          ))}
        </div>
      ) : expanded ? (
        <p
          role="status"
          className="absolute inset-x-0 top-[calc(100%+4px)] z-30 rounded-[10px] bg-surface px-3.5 py-2.5 text-[13px] text-ink-3 shadow-[var(--shadow-pop)]"
        >
          Nothing in this view matches.
        </p>
      ) : null}
    </div>
  );
}
