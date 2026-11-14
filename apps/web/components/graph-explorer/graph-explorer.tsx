"use client";
// The knowledge graph explorer: the filters, then the graph (or the same nodes as a table) with a search box and a
// size control, and beside it the legend and the node you opened. The filters that change what's read are links the
// server answers; what only changes the drawing (size, the list view, the node open) is kept in the address in place,
// so any view can be linked to.
import { List, Network, Waypoints } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GraphData,
  type GraphFilters,
  type GraphNode,
  graphHref,
  KIND_LABEL,
  kindsOf,
  type NodeMetrics,
  RANGE_LABEL,
  SIZE_LABEL,
  SIZE_METRICS,
  type SizeMetric,
} from "../../server/hub/graph-model.ts";
import { FilterBar } from "./filter-bar.tsx";
import { plural, radii } from "./format.ts";
import { GraphCanvas, MIN_ZOOM, type View } from "./graph-canvas.tsx";
import { Inspector } from "./inspector.tsx";
import { boundsOf, layoutGraph, type Point } from "./layout.ts";
import { Legend } from "./legend.tsx";
import { NodeTable } from "./node-table.tsx";
import { NodeSearch } from "./search.tsx";

type Mode = "graph" | "list";

// The address, changed in place: no request, and the back button isn't filled with every click.
function syncAddress(change: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(change))
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function fitView(positions: Map<string, Point>, box: { w: number; h: number }): View {
  const b = boundsOf(positions.values());
  if (!b) return { x: box.w / 2, y: box.h / 2, k: 1 };
  const pad = 40;
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  const k = Math.min(1.6, Math.max(MIN_ZOOM, Math.min((box.w - pad * 2) / w, (box.h - pad * 2) / h)));
  return { k, x: box.w / 2 - ((b.minX + b.maxX) / 2) * k, y: box.h / 2 - ((b.minY + b.maxY) / 2) * k };
}

const SORT_FOR: Record<SizeMetric, keyof NodeMetrics> = {
  degree: "degree",
  recency: "lastSeen",
  hours: "hoursLost",
  recurrence: "recurrence",
};

export function GraphExplorer({
  graph,
  filters,
  products,
  initialMode,
  initialNode,
}: {
  graph: GraphData;
  filters: GraphFilters;
  products: { id: string; name: string }[];
  initialMode: Mode;
  initialNode: string | null;
}) {
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      map.set(e.source, (map.get(e.source) ?? new Set()).add(e.target));
      map.set(e.target, (map.get(e.target) ?? new Set()).add(e.source));
    }
    return map;
  }, [graph]);

  const [size, setSize] = useState<SizeMetric>(filters.size);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [selected, setSelected] = useState<string | null>(
    initialNode && nodesById.has(initialNode) ? initialNode : null,
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [userView, setUserView] = useState<View | null>(null);
  const [moved, setMoved] = useState<Map<string, Point>>(() => new Map());

  // Laid out in the browser once the box is measured: the server draws an empty box, so nothing differs on hydration.
  const measured = box !== null;
  const base = useMemo(
    () =>
      measured
        ? layoutGraph(
            graph.nodes.map((n) => n.id),
            graph.edges,
          )
        : null,
    [graph, measured],
  );
  const positions = useMemo(
    () => (base ? (moved.size ? new Map([...base, ...moved]) : base) : new Map<string, Point>()),
    [base, moved],
  );
  const fitted = useMemo(() => (base && box ? fitView(base, box) : { x: 0, y: 0, k: 1 }), [base, box]);
  const view = userView ?? fitted;
  const radius = useMemo(() => radii(graph.nodes, size), [graph, size]);

  const onSize = useCallback((next: { w: number; h: number }) => {
    setBox((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
  }, []);
  const fittedRef = useRef(fitted);
  fittedRef.current = fitted;
  const onView = useCallback(
    (next: View | ((prev: View) => View)) =>
      setUserView((prev) => (typeof next === "function" ? next(prev ?? fittedRef.current) : next)),
    [],
  );
  const onMove = useCallback((id: string, at: Point) => setMoved((prev) => new Map(prev).set(id, at)), []);
  const onFit = useCallback(() => setUserView(null), []);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    syncAddress({ node: id });
  }, []);

  // Open a node and bring it to the middle of the box.
  const boxRef = useRef(box);
  boxRef.current = box;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const focusOn = useCallback(
    (id: string) => {
      select(id);
      const p = positionsRef.current.get(id);
      const b = boxRef.current;
      if (!p || !b) return;
      setUserView((prev) => {
        const k = Math.max((prev ?? fittedRef.current).k, 1.2);
        return { k, x: b.w / 2 - p.x * k, y: b.h / 2 - p.y * k };
      });
    },
    [select],
  );

  // A node named in the address comes into view once the graph is laid out.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !base || !selected) return;
    opened.current = true;
    focusOn(selected);
  }, [base, selected, focusOn]);

  const focusId = hovered ?? selected;
  const focus = useMemo(
    () =>
      focusId && nodesById.has(focusId)
        ? { id: focusId, lit: new Set([focusId, ...(neighbours.get(focusId) ?? [])]) }
        : null,
    [focusId, nodesById, neighbours],
  );

  const changeSize = (next: SizeMetric) => {
    setSize(next);
    syncAddress({ size: next === "degree" ? null : next });
  };
  const changeMode = (next: Mode) => {
    setMode(next);
    syncAddress({ view: next === "list" ? "list" : null });
  };

  const node = selected ? (nodesById.get(selected) ?? null) : null;
  const extra = { view: mode === "list" ? "list" : null, node: selected };
  const current = { ...filters, size };
  const mine = filters.scope === "mine";

  return (
    <>
      <FilterBar filters={current} products={products} extra={extra} />
      {graph.nodes.length ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="card min-w-0 overflow-hidden" aria-labelledby="graph-title">
            <h2 id="graph-title" className="sr-only">
              {mine ? "Your memories" : "Approved work"}, as a graph
            </h2>
            <div className="flex flex-col gap-2 border-line border-b p-3 sm:flex-row sm:items-center">
              <NodeSearch nodes={graph.nodes} onPick={(id) => (mode === "graph" ? focusOn(id) : select(id))} />
              <div className="flex gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
                  <span className="whitespace-nowrap text-[13px] text-ink-2">Size by</span>
                  <select
                    value={size}
                    onChange={(e) => changeSize(e.target.value as SizeMetric)}
                    className="input min-h-11 w-auto min-w-0 flex-1 text-[14px] sm:min-h-9"
                  >
                    {SIZE_METRICS.map((metric) => (
                      <option key={metric} value={metric}>
                        {SIZE_LABEL[metric]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => changeMode(mode === "graph" ? "list" : "graph")}
                  className="btn min-h-11 flex-none sm:min-h-9"
                >
                  {mode === "graph" ? <List size={15} aria-hidden /> : <Network size={15} aria-hidden />}
                  {mode === "graph" ? "View as list" : "View as graph"}
                </button>
              </div>
            </div>

            {mode === "graph" ? (
              <GraphCanvas
                nodes={graph.nodes}
                edges={graph.edges}
                positions={positions}
                radius={radius}
                view={view}
                onView={onView}
                onMove={onMove}
                focus={focus}
                selected={selected}
                onHover={setHovered}
                onSelect={select}
                onFit={onFit}
                onSize={onSize}
                label={`Graph of ${plural(graph.nodes.length, "node")} and ${plural(graph.edges.length, "connection")}`}
              />
            ) : (
              <NodeTable nodes={graph.nodes} selected={selected} onSelect={select} initialSort={SORT_FOR[size]} />
            )}

            <Summary graph={graph} filters={filters} />
          </section>

          <aside className="flex min-w-0 flex-col gap-5" aria-label="About the graph">
            {node ? (
              <Inspector
                node={node}
                edges={graph.edges}
                nodesById={nodesById}
                mine={mine}
                onSelect={mode === "graph" ? focusOn : select}
                onClose={() => select(null)}
              />
            ) : (
              <p className="card px-5 py-4 text-[13px] text-ink-3 max-lg:hidden">
                Hover a node to light up what it connects to; click one to open it. Drag to pan, scroll or pinch to
                zoom, and drag a node to move it.
              </p>
            )}
            <Legend nodes={graph.nodes} scope={filters.scope} size={size} />
          </aside>
        </div>
      ) : (
        <EmptyGraph graph={graph} filters={current} products={products} />
      )}
    </>
  );
}

// What was drawn, and what wasn't and why.
function Summary({ graph, filters }: { graph: GraphData; filters: GraphFilters }) {
  const s = graph.stats;
  const cut = Object.entries(s.cutByKind)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(
      ([kind, n]) =>
        `${(n ?? 0).toLocaleString("en-GB")} ${KIND_LABEL[kind as GraphNode["kind"]][n === 1 ? "one" : "many"].toLowerCase()}`,
    );
  const parts = [
    `Showing ${plural(s.nodes, "node")} and ${plural(s.edges, "connection")}${
      filters.range === "all" ? "" : ` from the last ${RANGE_LABEL[filters.range]}`
    }.`,
    s.hiddenByKind ? `${s.hiddenByKind.toLocaleString("en-GB")} hidden by kind.` : null,
    s.belowMinDegree
      ? `${s.belowMinDegree.toLocaleString("en-GB")} with fewer than ${plural(filters.minDegree, "connection")} left out.`
      : null,
    s.cut
      ? `To keep it readable, ${s.cut.toLocaleString("en-GB")} more were left out (${cut.join(", ")}): the most connected and the most recent are kept.`
      : null,
    s.sourceLimited
      ? filters.scope === "mine"
        ? "Only your latest 2,000 memories are read."
        : "Only the latest 1,000 approved lines are read: pick a product or a shorter range to see older work."
      : null,
  ].filter(Boolean);
  return <p className="border-line border-t px-4 py-3 text-[12.5px] text-ink-3 leading-relaxed">{parts.join(" ")}</p>;
}

function EmptyGraph({
  graph,
  filters,
  products,
}: {
  graph: GraphData;
  filters: GraphFilters;
  products: { id: string; name: string }[];
}) {
  const s = graph.stats;
  const mine = filters.scope === "mine";
  const everyKind = [...kindsOf(filters.scope)];
  const reset = graphHref({ ...filters, kinds: everyKind, minDegree: 0 });
  let title: string;
  let body: string;
  let action: { href: string; label: string } | null = null;
  if (filters.scope === "product" && !products.length) {
    title = "No products yet";
    body =
      "A repository becomes a product once someone approves work from it. Until then, what happens in it stays with the person who did it.";
  } else if (s.missingProduct) {
    title = "That product isn't listed";
    body = "There's no such product, or it has no approved work yet. Choose another above.";
  } else if (!filters.kinds.length) {
    title = "Every kind is hidden";
    body = "Choose at least one kind above to draw the graph.";
    action = { href: graphHref({ ...filters, kinds: everyKind }), label: "Show every kind" };
  } else if (!s.totalNodes) {
    title = mine
      ? "No memories yet"
      : filters.scope === "product"
        ? "Nothing approved here yet"
        : "No approved work yet";
    body = mine
      ? filters.range === "all"
        ? "When your agents save what they learn, or you add a memory yourself, it shows up here, by kind and project. Only you see it."
        : `You have no memories from the last ${RANGE_LABEL[filters.range]}${filters.status === "all" ? "" : " with this status"}.`
      : filters.range === "all"
        ? "The graph draws approved work: session summaries and the findings people approved. When someone approves work, it shows up here with what it connects to."
        : `Nothing was approved in the last ${RANGE_LABEL[filters.range]}.`;
    if (filters.range !== "all" || filters.status !== "all")
      action = { href: graphHref({ ...filters, range: "all", status: "all" }), label: "Show all time" };
    else if (mine) action = { href: "/memories", label: "Open Knowledge" };
  } else {
    title = "Nothing matches these filters";
    body = `There ${s.totalNodes === 1 ? "is" : "are"} ${plural(s.totalNodes, "node")} in this scope, but the kinds or the minimum connections chosen leave none of them.`;
    action = { href: reset, label: "Clear the filters" };
  }
  return (
    <section className="card px-6 py-12 text-center" aria-labelledby="graph-empty">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
        <Waypoints size={17} aria-hidden />
      </span>
      <h2 id="graph-empty" className="mt-4 font-semibold text-[16px]">
        {title}
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">{body}</p>
      {action ? (
        <Link href={action.href} className="btn mt-5 min-h-11 sm:min-h-9">
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
