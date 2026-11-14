// The graph page's vocabulary: the kinds of node and edge, what each is called, the colour each kind takes (from the
// theme's tokens), and the filters as the address carries them. Pure, with no database, so both the server (graph-view.ts)
// and the explorer in the browser read the same rules.

// Approved work, for the organisation or one product.
export const TEAM_NODE_KINDS = [
  "product",
  "area",
  "ticket",
  "pr",
  "session",
  "summary",
  "decision",
  "insight",
  "workflow",
  "pain_point",
  "context_gap",
  "open",
] as const;

// The viewer's own memories, by kind, and the projects and sessions they came from.
export const MINE_NODE_KINDS = [
  "project",
  "session",
  "preference",
  "fact",
  "decision",
  "convention",
  "summary",
] as const;

export type GraphNodeKind = (typeof TEAM_NODE_KINDS)[number] | (typeof MINE_NODE_KINDS)[number];

export const EDGE_TYPES = [
  "contains",
  "about",
  "worked_on",
  "found_in",
  "changes",
  "resolved_by",
  "same_ticket",
  "same_area",
] as const;
export type GraphEdgeType = (typeof EDGE_TYPES)[number];

export const GRAPH_SCOPES = ["org", "product", "mine"] as const;
export type GraphScope = (typeof GRAPH_SCOPES)[number];

export const SIZE_METRICS = ["degree", "recency", "hours", "recurrence"] as const;
export type SizeMetric = (typeof SIZE_METRICS)[number];

export const GRAPH_RANGES = ["7", "30", "90", "all"] as const;
export type GraphRange = (typeof GRAPH_RANGES)[number];

export const MIN_DEGREES = [0, 1, 2, 3, 5] as const;

export const MEMORY_STATUS_FILTERS = ["all", "active", "candidate"] as const;
export type MemoryStatusFilter = (typeof MEMORY_STATUS_FILTERS)[number];

// The most nodes one view draws. The rest are left out, and the page says how many of which kind.
export const NODE_CAP = 300;

export interface NodeMetrics {
  // Connections in this view.
  degree: number;
  // ISO time it was last seen: the newest approved work (or memory) that touches it.
  lastSeen: string | null;
  // Times it came up: sessions for most things, findings for a session, memories for a project.
  occurrences: number;
  // Hours lost on tools, for a product (signal_daily); null where time isn't measured.
  hoursLost: number | null;
  // For a context gap: the sessions it came up in plus the questions Ask Strata couldn't answer.
  recurrence: number | null;
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  // Short, for the canvas.
  label: string;
  // The whole line, for the inspector.
  text: string | null;
  // A page in the app; and a web address outside it (a ticket or a pull request), when there's a safe one.
  href: string | null;
  external: string | null;
  // The product's name, or the repository, it belongs to.
  context: string | null;
  // A memory's status, or a gap's.
  status: "active" | "candidate" | "open" | "resolved" | null;
  // Who worked on it: names only, in alphabetical order, never how much.
  workedOnBy: string[];
  metrics: NodeMetrics;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  // Drawn through a node the filters hide (two sessions on the same ticket, with tickets hidden).
  derived: boolean;
}

export interface GraphStats {
  scope: GraphScope;
  // Before the filters on kind and connections, and the cap.
  totalNodes: number;
  totalEdges: number;
  // What's drawn.
  nodes: number;
  edges: number;
  // Hidden by kind, by the minimum number of connections, and by the cap (by kind).
  hiddenByKind: number;
  belowMinDegree: number;
  cut: number;
  cutByKind: Partial<Record<GraphNodeKind, number>>;
  cap: number;
  // The source list hit its read limit: older work isn't in the graph at all.
  sourceLimited: boolean;
  // Product scope with a product that isn't listed.
  missingProduct: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export const KIND_LABEL: Record<GraphNodeKind, { one: string; many: string }> = {
  product: { one: "Product", many: "Products" },
  area: { one: "Code area", many: "Code areas" },
  ticket: { one: "Ticket", many: "Tickets" },
  pr: { one: "Pull request", many: "Pull requests" },
  session: { one: "Session", many: "Sessions" },
  summary: { one: "Summary", many: "Summaries" },
  decision: { one: "Decision", many: "Decisions" },
  insight: { one: "Insight", many: "Insights" },
  workflow: { one: "Workflow", many: "Workflow" },
  pain_point: { one: "Pain point", many: "Pain points" },
  context_gap: { one: "Context gap", many: "Context gaps" },
  open: { one: "Open question", many: "Open questions" },
  project: { one: "Project", many: "Projects" },
  preference: { one: "Preference", many: "Preferences" },
  fact: { one: "Fact", many: "Facts" },
  convention: { one: "Convention", many: "Conventions" },
};

// Each kind's colour, as CSS from the theme's tokens: a light or a dark theme recolours the graph with it.
const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, var(--${a}) ${pct}%, var(--${b}))`;
export const KIND_COLOR: Record<GraphNodeKind, string> = {
  product: "var(--ink)",
  area: "var(--verified)",
  ticket: "var(--relay-blue)",
  pr: mix("relay-blue", "accent", 50),
  session: "var(--ink-3)",
  summary: "var(--accent)",
  decision: "var(--fuchsia)",
  insight: mix("verified", "relay-blue", 50),
  workflow: mix("accent", "verified", 45),
  pain_point: "var(--danger)",
  context_gap: "var(--amber)",
  open: mix("amber", "danger", 50),
  project: "var(--ink-2)",
  preference: "var(--accent)",
  fact: "var(--relay-blue)",
  convention: "var(--verified)",
};

// How an edge reads from each end: "found in" from a finding, "findings" from its session.
export const EDGE_LABEL: Record<GraphEdgeType, { out: string; in: string }> = {
  contains: { out: "Contains", in: "Part of" },
  about: { out: "About", in: "Mentioned by" },
  worked_on: { out: "Worked on", in: "Worked on in" },
  found_in: { out: "Found in", in: "Findings" },
  changes: { out: "Changes", in: "Changed by" },
  resolved_by: { out: "Resolved by", in: "Resolves" },
  same_ticket: { out: "Same ticket as", in: "Same ticket as" },
  same_area: { out: "Same area as", in: "Same area as" },
};

export const SIZE_LABEL: Record<SizeMetric, string> = {
  degree: "Connections",
  recency: "Recency",
  hours: "Hours lost",
  recurrence: "Gap recurrence",
};

export const RANGE_LABEL: Record<GraphRange, string> = { "7": "7 days", "30": "30 days", "90": "90 days", all: "All" };

export const kindsOf = (scope: GraphScope): readonly GraphNodeKind[] =>
  scope === "mine" ? MINE_NODE_KINDS : TEAM_NODE_KINDS;

export interface GraphFilters {
  scope: GraphScope;
  productId: string | null;
  // The kinds shown; every kind of the scope when the address names none.
  kinds: GraphNodeKind[];
  range: GraphRange;
  minDegree: number;
  status: MemoryStatusFilter;
  size: SizeMetric;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;
const one = (params: Params, key: string): string | undefined => {
  const value = params instanceof URLSearchParams ? (params.get(key) ?? undefined) : params[key];
  return Array.isArray(value) ? value[0] : value;
};
// A product's id is a slug (products.ts): anything else can't be one.
const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const pick = <T extends string>(list: readonly T[], value: string | undefined, fallback: T): T =>
  value !== undefined && (list as readonly string[]).includes(value) ? (value as T) : fallback;

export const DEFAULT_RANGE: GraphRange = "all";

// The filters from the address: ?scope=org|product|mine&product=<id>&kinds=a,b&range=7|30|90|all&min=<n>
// &status=active|candidate&size=degree|recency|hours|recurrence. Anything else falls back to the default.
export function parseGraphFilters(params: Params): GraphFilters {
  const scope = pick(GRAPH_SCOPES, one(params, "scope"), "org");
  const product = one(params, "product")?.trim() ?? "";
  const all = kindsOf(scope);
  const rawKinds = one(params, "kinds");
  const kinds =
    rawKinds === undefined
      ? [...all]
      : rawKinds === "none"
        ? []
        : all.filter((kind) => rawKinds.split(",").includes(kind));
  const min = Number(one(params, "min"));
  return {
    scope,
    productId: scope === "product" && PRODUCT_ID.test(product) ? product : null,
    kinds,
    range: pick(GRAPH_RANGES, one(params, "range"), DEFAULT_RANGE),
    minDegree: (MIN_DEGREES as readonly number[]).includes(min) ? min : 0,
    status: scope === "mine" ? pick(MEMORY_STATUS_FILTERS, one(params, "status"), "all") : "all",
    size: pick(SIZE_METRICS, one(params, "size"), "degree"),
  };
}

// The page's address for some filters, leaving out the defaults. `extra` carries the explorer's own state (the node
// in focus, the list view) when it should survive the change.
export function graphHref(filters: GraphFilters, extra: Record<string, string | null | undefined> = {}): string {
  const params = new URLSearchParams();
  if (filters.scope !== "org") params.set("scope", filters.scope);
  if (filters.scope === "product" && filters.productId) params.set("product", filters.productId);
  const all = kindsOf(filters.scope);
  const kinds = all.filter((kind) => filters.kinds.includes(kind));
  if (kinds.length !== all.length) params.set("kinds", kinds.length ? kinds.join(",") : "none");
  if (filters.range !== DEFAULT_RANGE) params.set("range", filters.range);
  if (filters.minDegree) params.set("min", String(filters.minDegree));
  if (filters.scope === "mine" && filters.status !== "all") params.set("status", filters.status);
  if (filters.size !== "degree") params.set("size", filters.size);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `/graph?${query}` : "/graph";
}

export const RANGE_DAYS: Record<GraphRange, number | null> = { "7": 7, "30": 30, "90": 90, all: null };
