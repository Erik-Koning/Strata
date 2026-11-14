// A product's graph, drawn: inline SVG at the size it's laid out at (layout.ts), in the theme's tokens, so it follows
// light and dark with no script. Every box is a link to what it stands for. Narrower than the drawing, it scrolls
// sideways in its own frame rather than shrinking the words.
import type { GraphEdgeKind, GraphNodeKind, ProductGraph } from "../../server/hub/graph.ts";
import { EDGE_LABELS, fitText, layoutGraph, type PlacedNode, VIEW_H, VIEW_W } from "./layout.ts";

interface Look {
  fill: string;
  stroke: string;
  dash?: string;
  kind: string;
  name: string;
  mono?: boolean;
}

export const NODE_LOOKS: Record<GraphNodeKind, Look> = {
  product: {
    fill: "var(--accent-soft)",
    stroke: "var(--accent)",
    kind: "var(--accent-text)",
    name: "var(--accent-text)",
  },
  area: {
    fill: "var(--surface-2)",
    stroke: "var(--line-strong)",
    kind: "var(--ink-3)",
    name: "var(--ink)",
    mono: true,
  },
  insight: { fill: "var(--surface)", stroke: "var(--accent)", kind: "var(--accent-text)", name: "var(--ink)" },
  workflow: { fill: "var(--surface)", stroke: "var(--accent)", kind: "var(--accent-text)", name: "var(--ink)" },
  ticket: { fill: "var(--surface)", stroke: "var(--ink-3)", kind: "var(--ink-3)", name: "var(--ink)", mono: true },
  pr: { fill: "var(--surface)", stroke: "var(--ink-3)", kind: "var(--ink-3)", name: "var(--ink)", mono: true },
  gap: { fill: "var(--surface)", stroke: "var(--amber)", kind: "var(--amber)", name: "var(--ink)" },
  answer: {
    fill: "var(--surface)",
    stroke: "var(--accent-text)",
    dash: "2 2",
    kind: "var(--accent-text)",
    name: "var(--ink)",
    mono: true,
  },
};

// A stale finding and an answered gap look like what they've become.
const STALE: Partial<Look> = { stroke: "var(--amber)", dash: "4 3", kind: "var(--amber)" };
const ANSWERED: Partial<Look> = { stroke: "var(--line-strong)", kind: "var(--ink-3)" };

export const NODE_NAMES: Record<GraphNodeKind, string> = {
  product: "Product",
  area: "Code area",
  insight: "Insight",
  workflow: "Workflow finding",
  ticket: "Ticket",
  pr: "Pull request",
  gap: "Context gap",
  answer: "Answer",
};

const KIND_CAPS: Record<GraphNodeKind, string> = {
  product: "PRODUCT",
  area: "AREA",
  insight: "INSIGHT",
  workflow: "WORKFLOW",
  ticket: "TICKET",
  pr: "PULL REQUEST",
  gap: "CONTEXT GAP",
  answer: "ANSWER",
};

export const EDGE_LOOKS: Record<GraphEdgeKind, { stroke: string; dash?: string; opacity: number }> = {
  contains: { stroke: "var(--line-strong)", opacity: 1 },
  about: { stroke: "var(--accent)", dash: "5 3", opacity: 0.7 },
  worked_on: { stroke: "var(--ink-3)", opacity: 0.6 },
  changes: { stroke: "var(--ink-3)", dash: "1.5 3", opacity: 0.85 },
  resolved_by: { stroke: "var(--accent-text)", opacity: 0.85 },
};

export const lookOf = (node: Pick<PlacedNode, "kind" | "stale" | "resolved">): Look => ({
  ...NODE_LOOKS[node.kind],
  ...(node.stale ? STALE : {}),
  ...(node.resolved ? ANSWERED : {}),
});

const capsOf = (node: PlacedNode): string =>
  node.stale ? "MAY BE STALE" : node.kind === "gap" && node.resolved ? "ANSWERED GAP" : KIND_CAPS[node.kind];

function NodeBox({ node }: { node: PlacedNode }) {
  const look = lookOf(node);
  const nameSize = node.kind === "product" ? 12 : 11;
  const top = node.y - node.h / 2;
  return (
    <a
      href={node.href}
      aria-label={node.title}
      {...(node.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <title>{node.title}</title>
      <rect
        x={node.x - node.w / 2}
        y={top}
        width={node.w}
        height={node.h}
        rx={node.kind === "area" ? node.h / 2 : 9}
        fill={look.fill}
        stroke={look.stroke}
        strokeWidth={node.kind === "product" ? 1.5 : 1.25}
        strokeDasharray={look.dash}
      />
      <text
        x={node.x}
        y={node.y - (node.kind === "area" ? 4.5 : 6)}
        textAnchor="middle"
        fontSize={7.5}
        fontWeight={600}
        letterSpacing="0.1em"
        className="font-label"
        fill={look.kind}
      >
        {capsOf(node)}
      </text>
      <text
        x={node.x}
        y={node.y + (node.kind === "area" ? 9 : 10)}
        textAnchor="middle"
        fontSize={nameSize}
        fontWeight={node.kind === "product" ? 600 : 400}
        className={look.mono ? "font-mono" : "font-sans"}
        fill={look.name}
      >
        {fitText(node.label, node.w, nameSize, look.mono)}
      </text>
    </a>
  );
}

export function GraphSvg({ graph, titleId }: { graph: ProductGraph; titleId: string }) {
  const { nodes, edges } = layoutGraph(graph.nodes, graph.edges);
  const count = (kinds: GraphNodeKind[], one: string, many: string) => {
    const n = graph.nodes.filter((node) => kinds.includes(node.kind)).length;
    return n === 1 ? `one ${one}` : `${n} ${many}`;
  };
  const summary = [
    count(["area"], "code area", "code areas"),
    count(["insight", "workflow"], "insight or workflow finding", "insights and workflow findings"),
    count(["ticket", "pr"], "ticket or pull request", "tickets and pull requests"),
    count(["gap"], "context gap", "context gaps"),
  ].join(", ");
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        aria-describedby={`${titleId}-desc`}
        className="mx-auto block h-auto w-full min-w-[600px] max-w-[720px] [&_a:focus-visible]:outline-none [&_a:focus-visible_rect]:[stroke-width:3px] [&_a:focus-visible_rect]:stroke-[var(--focus)] [&_a:hover_rect]:[stroke-width:2.25px]"
      >
        <title>{`How ${graph.product.name} links up`}</title>
        <desc id={`${titleId}-desc`}>
          {graph.product.name} in the middle; around it {summary}. Each box is a link.
        </desc>
        <g aria-hidden>
          {edges.map((e, i) => {
            const look = EDGE_LOOKS[e.kind];
            return (
              <line
                key={`${e.from}-${e.to}-${i}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={look.stroke}
                strokeOpacity={look.opacity}
                strokeWidth={1.5}
                strokeDasharray={look.dash}
                strokeLinecap="round"
              />
            );
          })}
          {edges.map((e, i) =>
            e.label ? (
              <text
                key={`label-${e.from}-${e.to}-${i}`}
                x={e.label.x}
                y={e.label.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                className="font-sans"
                fill="var(--ink-3)"
                stroke="var(--surface)"
                strokeWidth={3.5}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {EDGE_LABELS[e.kind]}
              </text>
            ) : null,
          )}
        </g>
        {nodes.map((node) => (
          <NodeBox key={node.id} node={node} />
        ))}
      </svg>
    </div>
  );
}

// The legend: the kinds of box and line in this graph, drawn as they are in it.
export function GraphLegend({ graph }: { graph: ProductGraph }) {
  const kinds = (Object.keys(NODE_LOOKS) as GraphNodeKind[]).filter((k) => graph.nodes.some((n) => n.kind === k));
  const stale = graph.nodes.some((n) => n.stale);
  const lines = (Object.keys(EDGE_LOOKS) as GraphEdgeKind[]).filter((k) => graph.edges.some((e) => e.kind === k));
  const swatch = (look: Look, rounded: boolean) => (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true" className="flex-none">
      <rect
        x="1"
        y="1"
        width="16"
        height="10"
        rx={rounded ? 5 : 3}
        fill={look.fill}
        stroke={look.stroke}
        strokeWidth="1.25"
        strokeDasharray={look.dash}
      />
    </svg>
  );
  return (
    <div className="flex flex-col gap-1.5 px-5 py-3 text-[12.5px] text-ink-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Boxes">
        {kinds.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            {swatch(NODE_LOOKS[k], k === "area")}
            {NODE_NAMES[k]}
          </li>
        ))}
        {stale ? (
          <li className="flex items-center gap-1.5">
            {swatch(lookOf({ kind: "insight", stale: true, resolved: false }), false)}
            May be stale
          </li>
        ) : null}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Lines">
        {lines.map((k) => {
          const look = EDGE_LOOKS[k];
          return (
            <li key={k} className="flex items-center gap-1.5">
              <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true" className="flex-none">
                <line
                  x1="1"
                  y1="4"
                  x2="21"
                  y2="4"
                  stroke={look.stroke}
                  strokeOpacity={look.opacity}
                  strokeWidth="1.5"
                  strokeDasharray={look.dash}
                  strokeLinecap="round"
                />
              </svg>
              {EDGE_LABELS[k]}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
