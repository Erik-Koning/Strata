"use client";
// One node, opened: what it is, its measures, who worked on it (names only), its connections by type, and where to read
// more. A side panel from lg up; a sheet over the bottom of the screen below it.
import { ArrowUpRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  EDGE_LABEL,
  type GraphEdge,
  type GraphEdgeType,
  type GraphNode,
  KIND_COLOR,
  KIND_LABEL,
} from "../../server/hub/graph-model.ts";
import { Markdown } from "../markdown.tsx";
import { Ago } from "../time.tsx";
import { externalLabel, hoursText, occurrencesText, openLabel, recurrenceText } from "./format.ts";

const CONNECTIONS_SHOWN = 12;

const STATUS_TEXT: Record<NonNullable<GraphNode["status"]>, { label: string; className: string }> = {
  active: { label: "Remembered", className: "status-active" },
  candidate: { label: "Needs review", className: "status-candidate" },
  open: { label: "Open", className: "pill-claimed" },
  resolved: { label: "Resolved", className: "pill-completed" },
};

function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

export function Inspector({
  node,
  edges,
  nodesById,
  mine,
  onSelect,
  onClose,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  nodesById: Map<string, GraphNode>;
  mine: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new node is the trigger.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [node.id]);

  const groups = new Map<string, { label: string; type: GraphEdgeType; nodes: GraphNode[] }>();
  for (const e of edges) {
    const out = e.source === node.id;
    if (!out && e.target !== node.id) continue;
    const other = nodesById.get(out ? e.target : e.source);
    if (!other) continue;
    const label = EDGE_LABEL[e.type][out ? "out" : "in"];
    const group = groups.get(label) ?? { label, type: e.type, nodes: [] };
    group.nodes.push(other);
    groups.set(label, group);
  }
  const status = node.status ? STATUS_TEXT[node.status] : null;
  const m = node.metrics;
  const cameUp = occurrencesText(node, mine);

  return (
    <section
      aria-labelledby="inspector-title"
      className="card flex min-w-0 flex-col max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[72dvh] max-lg:overflow-y-auto max-lg:rounded-b-none max-lg:shadow-[var(--shadow-pop)]"
    >
      <header className="flex items-start gap-3 border-line border-b px-5 pt-4 pb-3.5 max-lg:sticky max-lg:top-0 max-lg:bg-surface">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip">
              <span className="dot" style={{ color: KIND_COLOR[node.kind] }} aria-hidden />
              {KIND_LABEL[node.kind].one}
            </span>
            {status ? <span className={`chip ${status.className}`}>{status.label}</span> : null}
          </div>
          <h2
            id="inspector-title"
            ref={heading}
            tabIndex={-1}
            className="mt-2 font-semibold text-[15px] text-ink leading-snug outline-none"
          >
            {node.label}
          </h2>
          {node.context ? <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{node.context}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-quiet size-11 flex-none p-0 sm:size-8"
          aria-label="Close the details"
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="flex flex-col gap-5 px-5 py-4">
        {node.text && node.text !== node.label ? (
          <Markdown className="break-words text-[13.5px] text-ink-2 leading-relaxed">{node.text}</Markdown>
        ) : null}

        {node.href || node.external ? (
          <div className="flex flex-wrap gap-2">
            {node.href ? (
              <Link href={node.href} className="btn btn-sm min-h-11 sm:min-h-8">
                {openLabel(node)}
              </Link>
            ) : null}
            {node.external ? (
              <a href={node.external} target="_blank" rel="noreferrer" className="btn btn-sm min-h-11 sm:min-h-8">
                {externalLabel(node)} <ArrowUpRight size={14} aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <div>
            <dt className="text-ink-3">Connections</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{m.degree.toLocaleString("en-GB")}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Last seen</dt>
            <dd className="mt-0.5 font-medium">{m.lastSeen ? <Ago at={m.lastSeen} /> : "Not known"}</dd>
          </div>
          {cameUp ? (
            <div>
              <dt className="text-ink-3">Came up</dt>
              <dd className="mt-0.5 font-medium">{cameUp}</dd>
            </div>
          ) : null}
          {m.hoursLost !== null ? (
            <div>
              <dt className="text-ink-3">Hours lost on tools</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{hoursText(m.hoursLost)}</dd>
            </div>
          ) : null}
          {m.recurrence !== null ? (
            <div className="col-span-2">
              <dt className="text-ink-3">Came back</dt>
              <dd className="mt-0.5 font-medium">{recurrenceText(m.recurrence)}</dd>
            </div>
          ) : null}
        </dl>

        {node.workedOnBy.length ? (
          <p className="text-[13px] text-ink-2">
            <span className="text-ink-3">Worked on by </span>
            {names(node.workedOnBy)}
          </p>
        ) : null}

        {groups.size ? (
          <div className="flex flex-col gap-4">
            {[...groups.values()].map((group) => (
              <div key={group.label}>
                <h3 className="eyebrow mb-1">
                  {group.label} <span className="count">{group.nodes.length.toLocaleString("en-GB")}</span>
                </h3>
                <ul className="-mx-2 flex flex-col">
                  {group.nodes.slice(0, CONNECTIONS_SHOWN).map((other) => (
                    <li key={other.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(other.id)}
                        className="flex min-h-11 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink sm:min-h-8"
                      >
                        <span className="dot" style={{ color: KIND_COLOR[other.kind] }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{other.label}</span>
                        <span className="sr-only">, {KIND_LABEL[other.kind].one}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {group.nodes.length > CONNECTIONS_SHOWN ? (
                  <p className="mt-1 text-[12px] text-ink-3">
                    And {(group.nodes.length - CONNECTIONS_SHOWN).toLocaleString("en-GB")} more in the graph.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">Nothing in this view connects to it.</p>
        )}
      </div>
    </section>
  );
}
