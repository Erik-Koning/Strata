"use client";
// The graph as a table: every node in view with its measures, sortable by any of them. The way to read the graph
// without a pointer or without sight, and a quicker way to compare.
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { type GraphNode, KIND_COLOR, KIND_LABEL } from "../../server/hub/graph-model.ts";
import { Ago } from "../time.tsx";
import { hoursText } from "./format.ts";

type Column = "label" | "kind" | "degree" | "lastSeen" | "occurrences" | "hoursLost" | "recurrence";

const COLUMNS: { key: Column; label: string; numeric: boolean }[] = [
  { key: "label", label: "Name", numeric: false },
  { key: "kind", label: "Kind", numeric: false },
  { key: "degree", label: "Connections", numeric: true },
  { key: "lastSeen", label: "Last seen", numeric: true },
  { key: "occurrences", label: "Came up", numeric: true },
  { key: "hoursLost", label: "Hours lost", numeric: true },
  { key: "recurrence", label: "Gap recurrence", numeric: true },
];

function value(node: GraphNode, column: Column): string | number {
  switch (column) {
    case "label":
      return node.label.toLowerCase();
    case "kind":
      return KIND_LABEL[node.kind].one;
    case "lastSeen":
      return node.metrics.lastSeen ? new Date(node.metrics.lastSeen).getTime() : -1;
    case "hoursLost":
      return node.metrics.hoursLost ?? -1;
    case "recurrence":
      return node.metrics.recurrence ?? -1;
    default:
      return node.metrics[column];
  }
}

export function NodeTable({
  nodes,
  selected,
  onSelect,
  initialSort,
}: {
  nodes: GraphNode[];
  selected: string | null;
  onSelect: (id: string) => void;
  initialSort: Column;
}) {
  const [sort, setSort] = useState<{ column: Column; down: boolean }>({ column: initialSort, down: true });
  const rows = [...nodes].sort((a, b) => {
    const x = value(a, sort.column);
    const y = value(b, sort.column);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (sort.down ? -order : order) || a.label.localeCompare(b.label);
  });
  const hasHours = nodes.some((n) => n.metrics.hoursLost !== null);
  const hasRecurrence = nodes.some((n) => n.metrics.recurrence !== null);
  const columns = COLUMNS.filter(
    (c) => (c.key !== "hoursLost" || hasHours) && (c.key !== "recurrence" || hasRecurrence),
  );

  return (
    <div className="max-h-[min(68dvh,640px)] min-h-[340px] overflow-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <caption className="sr-only">
          Every node in this view and its measures. Choose a column heading to sort by it; choose a name to open it.
        </caption>
        <thead className="sticky top-0 z-[1] bg-surface">
          <tr className="border-line border-b">
            {columns.map((c) => {
              const current = sort.column === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={current ? (sort.down ? "descending" : "ascending") : undefined}
                  className={`px-3 py-2 font-medium text-ink-3 ${c.numeric ? "text-right" : "text-left"}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort((s) =>
                        s.column === c.key ? { column: c.key, down: !s.down } : { column: c.key, down: c.numeric },
                      )
                    }
                    className={`inline-flex min-h-11 items-center gap-1 whitespace-nowrap hover:text-ink sm:min-h-8 ${current ? "text-ink" : ""}`}
                  >
                    {c.label}
                    {current ? (
                      sort.down ? (
                        <ArrowDown size={12} aria-hidden />
                      ) : (
                        <ArrowUp size={12} aria-hidden />
                      )
                    ) : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr
              key={n.id}
              className={`border-line border-b last:border-b-0 ${n.id === selected ? "bg-accent-soft" : "hover:bg-sunk"}`}
            >
              <th scope="row" className="max-w-[320px] px-3 py-1 text-left font-normal">
                <button
                  type="button"
                  onClick={() => onSelect(n.id)}
                  aria-current={n.id === selected ? "true" : undefined}
                  className="flex min-h-11 w-full items-center gap-2 text-left text-ink hover:underline sm:min-h-9"
                >
                  <span className="dot" style={{ color: KIND_COLOR[n.kind] }} aria-hidden />
                  <span className="min-w-0 truncate">{n.label}</span>
                </button>
              </th>
              <td className="whitespace-nowrap px-3 py-1 text-ink-2">{KIND_LABEL[n.kind].one}</td>
              <td className="px-3 py-1 text-right tabular-nums">{n.metrics.degree.toLocaleString("en-GB")}</td>
              <td className="whitespace-nowrap px-3 py-1 text-right text-ink-2">
                {n.metrics.lastSeen ? <Ago at={n.metrics.lastSeen} /> : "—"}
              </td>
              <td className="px-3 py-1 text-right tabular-nums">{n.metrics.occurrences.toLocaleString("en-GB")}</td>
              {hasHours ? (
                <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums">
                  {n.metrics.hoursLost === null ? "—" : hoursText(n.metrics.hoursLost)}
                </td>
              ) : null}
              {hasRecurrence ? (
                <td className="px-3 py-1 text-right tabular-nums">
                  {n.metrics.recurrence === null ? "—" : n.metrics.recurrence.toLocaleString("en-GB")}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { Column as NodeTableColumn };
