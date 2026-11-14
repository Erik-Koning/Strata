// Where each box of a product's graph sits, worked out the same way every time from the nodes and edges alone: the
// product in the middle, its code areas on an inner ring, and its insights, tickets, pull requests and gaps on an outer
// ring, each as near as it can be to the areas it's about. The outer ring is evenly spaced, so no two boxes overlap;
// only the order around it follows the areas. Pure, so the tests can pin it down.
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeKind } from "../../server/hub/graph.ts";

export const VIEW_W = 640;
export const VIEW_H = 480;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;

export const SIZES = {
  product: { w: 136, h: 44 },
  area: { w: 112, h: 36 },
  outer: { w: 112, h: 44 },
} as const;

const MARGIN = 6;
const INNER = { rx: 150, ry: 102 };
const OUTER = { rx: CX - SIZES.outer.w / 2 - MARGIN, ry: CY - SIZES.outer.h / 2 - MARGIN };

// The order kinds take around the ring when they want the same place.
const OUTER_ORDER: GraphNodeKind[] = ["insight", "workflow", "ticket", "pr", "gap", "answer"];

export const EDGE_LABELS: Record<GraphEdgeKind, string> = {
  contains: "contains",
  about: "about",
  worked_on: "worked on",
  changes: "changes",
  resolved_by: "resolved by",
};

// About how wide an edge's label is at 9px, with room either side.
export const labelWidth = (kind: GraphEdgeKind): number => EDGE_LABELS[kind].length * 5.2 + 8;

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedEdge extends GraphEdge {
  // The line between the two boxes' borders.
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // Where its label goes; null when the line between the boxes is too short to hold one, and for "contains".
  label: { x: number; y: number } | null;
}

const BOTTOM = Math.PI / 2;
const TOP = -Math.PI / 2;
const TAU = 2 * Math.PI;

const turn = (angle: number): number => ((angle % TAU) + TAU) % TAU;

function circularMean(angles: number[], fallback: number): number {
  let sin = 0;
  let cos = 0;
  for (const a of angles) {
    sin += Math.sin(a);
    cos += Math.cos(a);
  }
  return Math.abs(sin) < 1e-9 && Math.abs(cos) < 1e-9 ? fallback : Math.atan2(sin, cos);
}

const onRing = (ring: { rx: number; ry: number }, angle: number) => ({
  x: CX + ring.rx * Math.cos(angle),
  y: CY + ring.ry * Math.sin(angle),
});

const round = (n: number): number => Math.round(n * 10) / 10;

// How far along the line from a box's centre (toward dx, dy) its border is, as a share of the line.
function exitShare(box: { w: number; h: number }, dx: number, dy: number): number {
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : box.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : box.h / 2 / Math.abs(dy);
  return Math.min(sx, sy);
}

export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): { nodes: PlacedNode[]; edges: PlacedEdge[] } {
  const placed = new Map<string, PlacedNode>();
  const product = nodes.find((n) => n.kind === "product");
  if (product) placed.set(product.id, { ...product, x: CX, y: CY, ...SIZES.product });

  // Areas, evenly round the inner ring from the top. When something links straight to the product, the bottom is kept
  // clear for its line.
  const areas = nodes.filter((n) => n.kind === "area");
  const straight = edges.some((e) => e.to === product?.id && nodes.find((n) => n.id === e.from)?.kind !== "area");
  const angleOf = new Map<string, number>();
  areas.forEach((area, i) => {
    const angle = straight ? BOTTOM + (TAU * (i + 1)) / (areas.length + 1) : TOP + (TAU * i) / areas.length;
    angleOf.set(area.id, angle);
    placed.set(area.id, { ...area, ...onRing(INNER, angle), ...SIZES.area });
  });

  // Where each outer node would like to be: among the areas it's about, else at the bottom by the product; an answer by
  // its gap.
  const outer = nodes.filter((n) => n.kind !== "product" && n.kind !== "area");
  const wanted = new Map<string, number>();
  const answers: GraphNode[] = [];
  for (const node of outer) {
    if (node.kind === "answer") {
      answers.push(node);
      continue;
    }
    const angles = edges
      .filter((e) => e.from === node.id)
      .flatMap((e) => (angleOf.has(e.to) ? [angleOf.get(e.to) as number] : []));
    wanted.set(node.id, angles.length ? circularMean(angles, BOTTOM) : BOTTOM);
  }
  const gapOf = new Map<string, string>();
  for (const answer of answers) {
    const gap = edges.find((e) => e.to === answer.id && e.kind === "resolved_by")?.from;
    if (gap) gapOf.set(answer.id, gap);
    wanted.set(answer.id, gap ? (wanted.get(gap) ?? BOTTOM) : BOTTOM);
  }
  // An answer sorts straight after its gap.
  const sortKey = (node: GraphNode) => {
    const gap = gapOf.get(node.id);
    const kind = gap ? "gap" : node.kind;
    return {
      angle: turn(wanted.get(node.id) ?? BOTTOM),
      kind: OUTER_ORDER.indexOf(kind),
      id: gap ? `${gap}~` : node.id,
    };
  };
  const ordered = [...outer].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka.angle - kb.angle || ka.kind - kb.kind || (ka.id < kb.id ? -1 : ka.id > kb.id ? 1 : 0);
  });

  // Evenly round the outer ring in that order, turned so each is as near as it can be to where it wants to be.
  const m = ordered.length;
  if (m) {
    const step = TAU / m;
    const first = wanted.get(ordered[0]?.id ?? "") ?? BOTTOM;
    const offset = circularMean(
      ordered.map((node, j) => (wanted.get(node.id) ?? BOTTOM) - step * j),
      first - (step * (m - 1)) / 2,
    );
    ordered.forEach((node, j) => {
      placed.set(node.id, { ...node, ...onRing(OUTER, offset + step * j), ...SIZES.outer });
    });
  }

  const lines: PlacedEdge[] = [];
  for (const edge of edges) {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const from = exitShare(a, dx, dy);
    const to = exitShare(b, -dx, -dy);
    if (from + to >= 1) continue;
    const x1 = a.x + dx * from;
    const y1 = a.y + dy * from;
    const x2 = b.x - dx * to;
    const y2 = b.y - dy * to;
    const length = Math.hypot(x2 - x1, y2 - y1);
    lines.push({
      ...edge,
      x1: round(x1),
      y1: round(y1),
      x2: round(x2),
      y2: round(y2),
      label:
        edge.kind !== "contains" && length >= labelWidth(edge.kind) + 4
          ? { x: round((x1 + x2) / 2), y: round((y1 + y2) / 2) }
          : null,
    });
  }

  const round2 = (n: PlacedNode): PlacedNode => ({ ...n, x: round(n.x), y: round(n.y) });
  return {
    nodes: nodes.flatMap((n) => (placed.has(n.id) ? [round2(placed.get(n.id) as PlacedNode)] : [])),
    edges: lines,
  };
}

// Text cut to what fits a box of this width at this size: Geist is about 0.56 of its size per character, Geist Mono
// 0.6.
export function fitText(text: string, width: number, size: number, mono = false): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const max = Math.max(4, Math.floor((width - 14) / (size * (mono ? 0.6 : 0.56))));
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
