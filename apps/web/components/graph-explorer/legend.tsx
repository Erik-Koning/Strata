// What the marks mean: a colour per kind (with how many of each are drawn), what sets a node's size, and the three
// kinds of line.
import {
  type GraphNode,
  type GraphNodeKind,
  type GraphScope,
  KIND_COLOR,
  KIND_LABEL,
  kindsOf,
  SIZE_LABEL,
  type SizeMetric,
} from "../../server/hub/graph-model.ts";

const SIZE_HINT: Record<SizeMetric, string> = {
  degree: "Bigger nodes have more connections in this view.",
  recency: "Bigger nodes were seen more recently.",
  hours: "Bigger products lost more hours on tools. Only products have hours: the rest are drawn small.",
  recurrence: "Bigger gaps came back more often, in sessions and questions. Only gaps recur: the rest are drawn small.",
};

export function Legend({ nodes, scope, size }: { nodes: GraphNode[]; scope: GraphScope; size: SizeMetric }) {
  const counts = new Map<GraphNodeKind, number>();
  for (const n of nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  const kinds = kindsOf(scope).filter((k) => counts.has(k));
  const candidates = nodes.some((n) => n.status === "candidate");

  return (
    <section className="card px-5 py-4" aria-labelledby="legend-title">
      <h2 id="legend-title" className="section-title">
        Legend
      </h2>
      <p className="mt-0.5 text-[12.5px] text-ink-3">Colour by kind. Size by {SIZE_LABEL[size].toLowerCase()}.</p>
      {kinds.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
          {kinds.map((kind) => (
            <li key={kind} className="flex min-w-0 items-center gap-2 text-ink-2">
              <span className="dot" style={{ color: KIND_COLOR[kind] }} aria-hidden />
              <span className="min-w-0 truncate">{KIND_LABEL[kind].many}</span>
              <span className="count ml-auto">{(counts.get(kind) ?? 0).toLocaleString("en-GB")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[12.5px] text-ink-3 leading-snug">{SIZE_HINT[size]}</p>
      <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px] text-ink-2">
        <li className="flex items-center gap-2.5">
          <svg width="28" height="6" aria-hidden className="flex-none">
            <line x1="0" y1="3" x2="28" y2="3" strokeWidth="1.5" style={{ stroke: "var(--ink-3)" }} />
          </svg>
          Part of, found in, worked on, changes
        </li>
        <li className="flex items-center gap-2.5">
          <svg width="28" height="6" aria-hidden className="flex-none">
            <line
              x1="0"
              y1="3"
              x2="28"
              y2="3"
              strokeWidth="1.5"
              strokeDasharray="1.5 2.5"
              style={{ stroke: "var(--ink-3)" }}
            />
          </svg>
          About: a finding that names it
        </li>
        <li className="flex items-center gap-2.5">
          <svg width="28" height="6" aria-hidden className="flex-none">
            <line
              x1="0"
              y1="3"
              x2="28"
              y2="3"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              style={{ stroke: "var(--ink-3)" }}
            />
          </svg>
          Through a hidden kind: same ticket, same area
        </li>
        {candidates ? (
          <li className="flex items-center gap-2.5">
            <svg width="28" height="12" aria-hidden className="flex-none">
              <circle
                cx="14"
                cy="6"
                r="4.5"
                strokeWidth="1.5"
                strokeDasharray="2.5 2"
                style={{ fill: "var(--surface)", stroke: "var(--ink-3)" }}
              />
            </svg>
            Hollow: a memory that needs review
          </li>
        ) : null}
      </ul>
    </section>
  );
}
