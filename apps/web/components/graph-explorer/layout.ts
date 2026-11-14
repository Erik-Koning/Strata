// A small force layout, written for the graph page so it needs no library: velocity Verlet with decaying "heat"
// (alpha), as d3-force does it. Nodes push each other apart, edges pull their ends to a rest length, and a weak pull to
// the middle keeps separate clusters on screen.
//
// Deterministic: nodes are placed and stepped in an order that depends only on the graph, and the little randomness it
// needs (to pull apart two nodes on the same spot) comes from a generator seeded by the graph itself. The same graph
// lays out the same way every time, on every screen. Pure, so it runs anywhere.

export interface Point {
  x: number;
  y: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutOptions {
  iterations?: number;
  // Rest length of an edge, and how hard nodes push each other apart.
  linkDistance?: number;
  charge?: number;
  // Pull towards the middle.
  gravity?: number;
}

// FNV-1a: a stable 32-bit hash of a string.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: a small seeded generator, uniform in [0, 1).
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The order nodes start in: breadth first from the most connected node of each cluster, so neighbours start near each
// other and the layout settles sooner. Ties go by id, so the order depends on the graph alone.
function startOrder(ids: string[], adjacency: Map<string, string[]>): string[] {
  const byDegree = [...ids].sort(
    (a, b) => (adjacency.get(b)?.length ?? 0) - (adjacency.get(a)?.length ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const seen = new Set<string>();
  const order: string[] = [];
  for (const root of byDegree) {
    if (seen.has(root)) continue;
    seen.add(root);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of adjacency.get(id) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
  }
  return order;
}

export function layoutGraph(
  nodeIds: readonly string[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, Point> {
  const iterations = options.iterations ?? 300;
  const linkDistance = options.linkDistance ?? 42;
  const charge = options.charge ?? -90;
  const gravity = options.gravity ?? 0.045;

  const ids = [...new Set(nodeIds)].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const out = new Map<string, Point>();
  if (!n) return out;

  const links = edges
    .map((e) => ({ s: index.get(e.source), t: index.get(e.target) }))
    .filter((l): l is { s: number; t: number } => l.s !== undefined && l.t !== undefined && l.s !== l.t)
    .sort((a, b) => a.s - b.s || a.t - b.t);
  const adjacency = new Map<string, string[]>();
  for (const { s, t } of links) {
    adjacency.set(ids[s]!, [...(adjacency.get(ids[s]!) ?? []), ids[t]!]);
    adjacency.set(ids[t]!, [...(adjacency.get(ids[t]!) ?? []), ids[s]!]);
  }
  const count = new Float64Array(n);
  for (const { s, t } of links) {
    count[s]!++;
    count[t]!++;
  }

  const rand = random(hash(`${ids.join("\u001f")}\u001e${links.map((l) => `${l.s}-${l.t}`).join(",")}`));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  // A sunflower spiral, in start order.
  const golden = Math.PI * (3 - Math.sqrt(5));
  startOrder(ids, adjacency).forEach((id, k) => {
    const i = index.get(id)!;
    const r = 12 * Math.sqrt(0.5 + k);
    x[i] = r * Math.cos(k * golden);
    y[i] = r * Math.sin(k * golden);
  });

  const jiggle = () => (rand() - 0.5) * 1e-6;
  const distanceMax2 = (linkDistance * 12) ** 2;
  let alpha = 1;
  const alphaMin = 0.001;
  const alphaDecay = 1 - alphaMin ** (1 / iterations);
  const keep = 0.6;

  for (let step = 0; step < iterations; step++) {
    alpha += (0 - alpha) * alphaDecay;

    // Edges: towards their rest length, the lighter end moving more.
    for (const { s, t } of links) {
      let dx = x[t]! + vx[t]! - x[s]! - vx[s]!;
      let dy = y[t]! + vy[t]! - y[s]! - vy[s]!;
      if (!dx) dx = jiggle();
      if (!dy) dy = jiggle();
      const l = Math.sqrt(dx * dx + dy * dy);
      const strength = 1 / Math.min(count[s]!, count[t]!);
      const k = ((l - linkDistance) / l) * alpha * strength;
      dx *= k;
      dy *= k;
      const bias = count[s]! / (count[s]! + count[t]!);
      vx[t]! -= dx * bias;
      vy[t]! -= dy * bias;
      vx[s]! += dx * (1 - bias);
      vy[s]! += dy * (1 - bias);
    }

    // Every pair pushes apart, less with distance; close enough to touch, a fixed push.
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let dx = x[j]! - x[i]!;
        let dy = y[j]! - y[i]!;
        if (!dx && !dy) {
          dx = jiggle();
          dy = jiggle();
        }
        let l2 = dx * dx + dy * dy;
        if (l2 > distanceMax2) continue;
        if (l2 < 64) l2 = Math.sqrt(64 * l2) || 1;
        const w = (charge * alpha) / l2;
        vx[i]! += dx * w;
        vy[i]! += dy * w;
        vx[j]! -= dx * w;
        vy[j]! -= dy * w;
      }

    for (let i = 0; i < n; i++) {
      vx[i]! += -x[i]! * gravity * alpha;
      vy[i]! += -y[i]! * gravity * alpha;
      vx[i]! *= keep;
      vy[i]! *= keep;
      x[i]! += vx[i]!;
      y[i]! += vy[i]!;
    }
  }

  for (let i = 0; i < n; i++) out.set(ids[i]!, { x: x[i]!, y: y[i]! });
  return out;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Iterable<Point>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points)
    b = b
      ? {
          minX: Math.min(b.minX, p.x),
          minY: Math.min(b.minY, p.y),
          maxX: Math.max(b.maxX, p.x),
          maxY: Math.max(b.maxY, p.y),
        }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  return b;
}
