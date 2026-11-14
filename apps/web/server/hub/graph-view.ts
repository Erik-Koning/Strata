// The knowledge graph (/graph): approved work across the organisation or in one product, or the viewer's own memories,
// as nodes and typed edges, each node with a few measures (connections, when it was last seen, how often it came up,
// hours lost, how often a gap came back).
//
// Approved work is read only through the hub's read models (recordsFor, listProducts, listGaps, timeLost), as the
// viewer, so their rules hold here: approved work only, never anyone's draft; nothing for a suspended viewer. "My
// memories" reads the viewer's own memories (active and candidates) and nobody else's, whatever their role
// (access.ts, seePrivate). There are no person nodes and nothing is sized, coloured or filtered by a person: a node
// carries the names of who worked on it, in alphabetical order, and nothing that says how much.
//
// Everything returned is plain data (strings, numbers, booleans), so it goes to the explorer in the browser as it is.
import type { Filter } from "mongodb";
import { can } from "../access.ts";
import { DEFAULT_ORG } from "../api-auth.ts";
import { type MemoryDoc, memories } from "../collections.ts";
import { type Gap, listGaps } from "./gaps.ts";
import {
  type GraphData,
  type GraphEdge,
  type GraphEdgeType,
  type GraphNode,
  type GraphNodeKind,
  type GraphScope,
  type GraphStats,
  kindsOf,
  NODE_CAP,
} from "./graph-model.ts";
import { getProduct, listProducts, type Product } from "./products.ts";
import { reader, type ViewerRef, viewerIdOf } from "./reader.ts";
import { timeLost } from "./signals.ts";
import { recordsFor, type TeamRecord } from "./team-records.ts";
import { normalizePath, normalizeRepo, normalizeText, pathWithin, textKey } from "./text.ts";
import { toHours } from "./time-math.ts";

export interface GraphQuery {
  scope: GraphScope;
  productId?: string | null;
  kinds?: GraphNodeKind[];
  since?: Date;
  until?: Date;
  minDegree?: number;
  // My memories only: one status, else active and candidates.
  status?: "active" | "candidate";
}

// How much is read before the graph is cut down: recordsFor's own most, and as many memories.
const RECORD_LIMIT = 1000;
const MEMORY_LIMIT = 2000;
// Of the nodes kept when there are too many: the most connected first, then the most recent of the rest.
const KEEP_CONNECTED = Math.round((NODE_CAP * 2) / 3);
// A ticket or area hidden by the filters joins at most this many of its neighbours to each other.
const PROJECT_NEIGHBOURS = 10;
// The folders a session's files are in that count as the areas it changed.
const FOLDERS_PER_SESSION = 4;
const FOLDER_DEPTH = 3;
const TEXT_MAX = 600;
const LABEL_MAX = 56;

const FINDING_KINDS = new Set<GraphNodeKind>([
  "summary",
  "decision",
  "insight",
  "workflow",
  "pain_point",
  "context_gap",
  "open",
  "preference",
  "fact",
  "convention",
]);
const CONTEXT_KINDS = new Set<GraphNodeKind>(["product", "project", "ticket", "pr", "area"]);

interface Draft {
  id: string;
  kind: GraphNodeKind;
  label: string;
  text: string | null;
  href: string | null;
  external: string | null;
  context: string | null;
  status: GraphNode["status"];
  people: Set<string>;
  sessions: Set<string>;
  last: number;
  // Times it came up, when that isn't the sessions it was seen in.
  count: number | null;
  hoursLost: number | null;
  recurrence: number | null;
}

type DraftFields = Partial<Omit<Draft, "id" | "kind" | "people" | "sessions">> & { label: string };

// The graph as it's put together: nodes by id, and at most one edge between any two nodes (the first one made wins, so
// the closer relation is made first).
class Builder {
  readonly nodes = new Map<string, Draft>();
  readonly edges = new Map<string, GraphEdge>();

  add(id: string, kind: GraphNodeKind, fields: DraftFields): Draft {
    const existing = this.nodes.get(id);
    if (existing) return existing;
    const draft: Draft = {
      id,
      kind,
      text: null,
      href: null,
      external: null,
      context: null,
      status: null,
      last: 0,
      count: null,
      hoursLost: null,
      recurrence: null,
      ...fields,
      people: new Set(),
      sessions: new Set(),
    };
    this.nodes.set(id, draft);
    return draft;
  }

  link(source: string, target: string, type: GraphEdgeType): void {
    if (this.nodes.has(source) && this.nodes.has(target)) linkInto(this.edges, source, target, type, false);
  }
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u001f${b}` : `${b}\u001f${a}`);

function linkInto(
  edges: Map<string, GraphEdge>,
  source: string,
  target: string,
  type: GraphEdgeType,
  derived: boolean,
): void {
  if (source === target) return;
  const key = pairKey(source, target);
  if (edges.has(key)) return;
  edges.set(key, { id: `${type}\u001f${key}`, source, target, type, derived });
}

function touch(draft: Draft, at: Date, sessionId?: string | null, person?: string | null): void {
  draft.last = Math.max(draft.last, at.getTime());
  if (sessionId) draft.sessions.add(sessionId);
  if (person) draft.people.add(person);
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
const clip = (text: string, max: number): string => {
  const line = oneLine(text);
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};
const safeUrl = (url: unknown): string | null =>
  typeof url === "string" && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
const dayLabel = (at: Date): string =>
  at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const sessionHref = (sessionId: string): string => `/sessions/${encodeURIComponent(sessionId)}`;

// A code area as a key: a folder written either way (./apps/web/, apps/web) is one area.
const areaKey = (area: string): string => normalizePath(area.replace(/^\.\//, "")).toLowerCase();
const isPathLike = (area: string): boolean => !/\s/.test(area.trim()) && area.trim().length > 1;

// The folder a file is in, to FOLDER_DEPTH levels; null for a file at the root.
function folderOf(file: string): string | null {
  const parts = normalizePath(file).split("/").filter(Boolean);
  parts.pop();
  return parts.length ? parts.slice(0, FOLDER_DEPTH).join("/") : null;
}

const emptyStats = (scope: GraphScope, missingProduct = false): GraphStats => ({
  scope,
  totalNodes: 0,
  totalEdges: 0,
  nodes: 0,
  edges: 0,
  hiddenByKind: 0,
  belowMinDegree: 0,
  cut: 0,
  cutByKind: {},
  cap: NODE_CAP,
  sourceLimited: false,
  missingProduct,
});

// The graph for a scope, as the viewer may see it. Empty for a viewer who can't read approved work (suspended).
export async function graphFor(query: GraphQuery, viewer: ViewerRef): Promise<GraphData> {
  const access = await reader(viewer);
  if (!access) return { nodes: [], edges: [], stats: emptyStats(query.scope) };
  if (query.scope === "mine") {
    const userId = viewerIdOf(viewer);
    if (!can.seePrivate(access, userId)) return { nodes: [], edges: [], stats: emptyStats(query.scope) };
    const built = await mineGraph(userId, query);
    return shape(built.graph, query, { sourceLimited: built.limited, missingProduct: false });
  }
  const built = await teamGraph(query, viewer);
  return shape(built.graph, query, { sourceLimited: built.limited, missingProduct: built.missingProduct });
}

// Approved work: products, their sessions and what each found, the tickets, pull requests and code areas they touched.
async function teamGraph(
  query: GraphQuery,
  viewer: ViewerRef,
): Promise<{ graph: Builder; limited: boolean; missingProduct: boolean }> {
  const g = new Builder();
  let productId: string | undefined;
  if (query.scope === "product") {
    const product = query.productId ? await getProduct(query.productId, viewer) : null;
    if (!product) return { graph: g, limited: false, missingProduct: true };
    productId = product.id;
  }
  const until = query.until ?? new Date();
  const [records, products, gapList, lost] = await Promise.all([
    recordsFor({ productId, since: query.since, until: query.until, limit: RECORD_LIMIT }, viewer),
    listProducts(viewer),
    listGaps({ productId }, viewer),
    timeLost({ productId, since: query.since ?? new Date(0), until }, viewer),
  ]);

  const byId = new Map<string, Product>(products.map((p) => [p.id, p]));
  const lostMs = new Map<string, number>();
  for (const item of lost.items)
    if (item.productId) lostMs.set(item.productId, (lostMs.get(item.productId) ?? 0) + item.lost.totalMs);

  const productNode = (id: string | null): Draft | null => {
    const product = id ? byId.get(id) : undefined;
    if (!product) return null;
    return g.add(`product:${product.id}`, "product", {
      label: clip(product.name, LABEL_MAX),
      text: product.name,
      href: `/products/${encodeURIComponent(product.id)}`,
      context: product.repos.map((r) => (r.path ? `${r.repo}/${r.path}` : r.repo)).join(", ") || null,
      hoursLost: toHours(lostMs.get(product.id) ?? 0),
    });
  };
  if (productId) productNode(productId);
  for (const [id, ms] of lostMs) if (ms > 0 && (!productId || id === productId)) productNode(id);

  const contextOf = (r: TeamRecord): string | null =>
    (r.productId ? byId.get(r.productId)?.name : undefined) ?? (r.repo || null);
  // Areas belong to a product (or a repository no product covers): "api" in two products is two areas.
  const scopeOf = (r: TeamRecord): string => r.productId ?? r.repo ?? "";

  // The areas summaries name, by scope, for matching the folders of files to.
  const named = new Map<string, Map<string, string>>();
  for (const r of records)
    for (const area of r.areas) {
      const key = areaKey(area);
      if (!key) continue;
      const areas = named.get(scopeOf(r)) ?? new Map<string, string>();
      if (!areas.has(key)) areas.set(key, area.trim());
      named.set(scopeOf(r), areas);
    }
  const areaNode = (r: TeamRecord, key: string, label: string): Draft =>
    g.add(`area:${scopeOf(r)}:${key}`, "area", {
      label: clip(label, LABEL_MAX),
      text: label,
      href: r.productId && byId.has(r.productId) ? `/products/${encodeURIComponent(r.productId)}` : null,
      context: contextOf(r),
    });

  const bySession = new Map<string, TeamRecord[]>();
  for (const r of records) bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), r]);

  const prByUrl = new Map<string, string>();
  const findings = new Map<string, { scope: string; words: string }>();

  for (const [sessionId, items] of bySession) {
    const first = items[0]!;
    const newest = new Date(Math.max(...items.map((r) => r.at.getTime())));
    const summary = items.find((r) => r.kind === "summary");
    const refs = items.flatMap((r) => r.refs);
    const tickets = [
      ...new Set(refs.filter((r) => r.type === "ticket" || r.type === "issue").map((r) => r.id.trim())),
    ].filter(Boolean);
    const product = productNode(first.productId);

    const session = g.add(`session:${sessionId}`, "session", {
      label: `Session ${dayLabel(newest)}${tickets[0] ? ` · ${clip(tickets[0], 16)}` : ""}`,
      text: summary ? (summary.title ?? clip(summary.text, TEXT_MAX)) : null,
      href: sessionHref(sessionId),
      context: contextOf(first),
      count: items.length,
    });
    for (const r of items) touch(session, r.at, sessionId, r.author?.name);
    if (product) {
      g.link(product.id, session.id, "contains");
      for (const r of items) touch(product, r.at, sessionId, r.author?.name);
    }

    // What it found: one node per line, the same line said in two sessions being one node seen twice.
    for (const r of items) {
      const words = normalizeText(r.text);
      const id = `${r.kind}:${textKey(scopeOf(r), words)}`;
      const node = g.add(id, r.kind, {
        label: clip(r.title ?? r.text, LABEL_MAX),
        text: clip(r.title && r.kind === "summary" ? `${r.title}. ${r.text}` : r.text, TEXT_MAX),
        href: sessionHref(sessionId),
        context: contextOf(r),
      });
      touch(node, r.at, sessionId, r.author?.name);
      g.link(node.id, session.id, "found_in");
      if (!findings.has(node.id)) findings.set(node.id, { scope: scopeOf(r), words });
    }

    // Tickets and pull requests it worked on; a ticket and a pull request of the same session: the one resolved by the
    // other.
    const ticketIds: string[] = [];
    for (const ref of refs.filter((r) => r.type === "ticket" || r.type === "issue")) {
      const key = ref.id.trim().toUpperCase();
      if (!key) continue;
      const ticket = g.add(`ticket:${key}`, "ticket", {
        label: clip(ref.id.trim(), LABEL_MAX),
        text: summary?.title ?? null,
        external: safeUrl(ref.url),
        context: typeof ref.system === "string" ? ref.system : null,
      });
      if (!ticket.external) ticket.external = safeUrl(ref.url);
      for (const r of items) touch(ticket, r.at, sessionId, r.author?.name);
      g.link(session.id, ticket.id, "worked_on");
      ticketIds.push(ticket.id);
    }
    const prIds: string[] = [];
    for (const ref of refs.filter((r) => r.type === "pr")) {
      const url = safeUrl(ref.url);
      const key = url ?? `${first.repo}#${ref.id}`;
      const title = typeof ref.title === "string" ? ref.title : null;
      const pr = g.add(`pr:${key}`, "pr", {
        label: /^\d+$/.test(ref.id) ? `PR #${ref.id}` : clip(title ?? ref.id, LABEL_MAX),
        text: title,
        external: url,
        context: contextOf(first),
      });
      if (!pr.text && title) pr.text = title;
      for (const r of items) touch(pr, r.at, sessionId, r.author?.name);
      if (url) prByUrl.set(url.replace(/\/+$/, ""), pr.id);
      g.link(session.id, pr.id, "worked_on");
      prIds.push(pr.id);
    }
    for (const ticket of new Set(ticketIds)) for (const pr of new Set(prIds)) g.link(ticket, pr, "resolved_by");

    // Code areas: the ones its summary names, then the folders its files are in (a named area holding a folder wins).
    const areas = new Set<string>();
    for (const r of items)
      for (const raw of r.areas) {
        const key = areaKey(raw);
        if (!key || areas.has(key)) continue;
        areas.add(key);
        const area = areaNode(r, key, raw.trim());
        for (const x of items) touch(area, x.at, sessionId, x.author?.name);
        g.link(session.id, area.id, "worked_on");
        if (product) g.link(product.id, area.id, "contains");
      }
    const files = [...new Set(items.flatMap((r) => r.files ?? []))];
    if (files.length) {
      const paths = [...(named.get(scopeOf(first))?.entries() ?? [])].filter(([, label]) => isPathLike(label));
      const folders = new Map<string, { label: string; files: number }>();
      for (const file of files) {
        const folder = folderOf(file);
        if (!folder) continue;
        const lower = normalizePath(file).toLowerCase();
        const holder = paths.filter(([key]) => pathWithin(lower, key)).sort((a, b) => b[0].length - a[0].length)[0];
        const [key, label] = holder ?? [folder.toLowerCase(), folder];
        const entry = folders.get(key) ?? { label, files: 0 };
        entry.files++;
        folders.set(key, entry);
      }
      const top = [...folders.entries()]
        .sort((a, b) => b[1].files - a[1].files || a[0].localeCompare(b[0]))
        .slice(0, FOLDERS_PER_SESSION);
      for (const [key, { label }] of top) {
        const area = areaNode(first, key, label);
        for (const x of items) touch(area, x.at, sessionId, x.author?.name);
        g.link(session.id, area.id, "changes");
        for (const pr of prIds) g.link(pr, area.id, "changes");
        if (product) g.link(product.id, area.id, "contains");
      }
    }

    // A record's own tickets and pull requests (a summary's lines share the session's, already linked).
    for (const r of items) {
      if (r.source !== "record") continue;
      const id = `${r.kind}:${textKey(scopeOf(r), normalizeText(r.text))}`;
      for (const ref of r.refs) {
        if (ref.type === "ticket" || ref.type === "issue") g.link(id, `ticket:${ref.id.trim().toUpperCase()}`, "about");
        if (ref.type === "pr") g.link(id, `pr:${safeUrl(ref.url) ?? `${r.repo}#${ref.id}`}`, "about");
      }
    }
  }

  // A finding that names a code area of its product is about it.
  for (const [id, f] of findings) {
    if (g.nodes.get(id)?.kind === "summary") continue;
    const words = ` ${f.words} `;
    for (const [key, label] of named.get(f.scope) ?? []) {
      const area = normalizeText(label);
      if (area.length >= 4 && words.includes(` ${area} `)) g.link(id, `area:${f.scope}:${key}`, "about");
    }
  }

  // Context gaps: how often each came back (sessions plus unanswered questions), from the gaps the hub keeps.
  const gapsByText = new Map<string, Gap[]>();
  for (const gap of gapList) {
    const key = normalizeText(gap.text);
    gapsByText.set(key, [...(gapsByText.get(key) ?? []), gap]);
  }
  const since = query.since?.getTime() ?? 0;
  const gapNode = (draft: Draft, gap: Gap) => {
    draft.recurrence = gap.sessions + gap.fromPeople;
    draft.status = gap.status;
    draft.href = `/gaps/${gap.id}`;
    draft.last = Math.max(draft.last, gap.lastSeen.getTime());
    const fixedBy = safeUrl(gap.resolution?.url)?.replace(/\/+$/, "");
    const pr = fixedBy ? prByUrl.get(fixedBy) : undefined;
    if (pr) g.link(draft.id, pr, "resolved_by");
  };
  for (const [id, f] of findings) {
    const draft = g.nodes.get(id);
    if (draft?.kind !== "context_gap") continue;
    const candidates = gapsByText.get(f.words) ?? [];
    const gap =
      candidates.find((c) => c.productId === f.scope) ??
      candidates.find((c) => c.productId === null || !byId.has(f.scope));
    if (gap) gapNode(draft, gap);
    else draft.recurrence = draft.sessions.size;
  }
  // Questions Ask Strata couldn't answer that no session ran into: gaps all the same, part of their product.
  for (const gap of gapList) {
    if (gap.fromAgents > 0 || gap.lastSeen.getTime() < since || gap.lastSeen >= until) continue;
    const draft = g.add(`gap:${gap.id}`, "context_gap", {
      label: clip(gap.text, LABEL_MAX),
      text: clip(gap.text, TEXT_MAX),
      context: gap.productId ? (byId.get(gap.productId)?.name ?? null) : null,
      count: gap.fromPeople,
    });
    gapNode(draft, gap);
    const product = productNode(gap.productId);
    if (product) g.link(product.id, draft.id, "contains");
  }

  return { graph: g, limited: records.length >= RECORD_LIMIT, missingProduct: false };
}

// The viewer's own memories: by kind, in the projects they belong to, from the sessions they came out of.
async function mineGraph(userId: string, query: GraphQuery): Promise<{ graph: Builder; limited: boolean }> {
  const g = new Builder();
  const filter: Filter<MemoryDoc> = {
    "scope.org": DEFAULT_ORG,
    "scope.user": userId,
    status: query.status ?? { $in: ["active", "candidate"] },
  };
  if (query.since || query.until)
    filter.createdAt = { ...(query.since ? { $gte: query.since } : {}), ...(query.until ? { $lt: query.until } : {}) };
  const docs = await memories()
    .find(filter, { projection: { embedding: 0 } })
    .sort({ _id: -1 })
    .limit(MEMORY_LIMIT)
    .toArray();

  for (const doc of docs) {
    const kind = doc.kind as GraphNodeKind;
    if (!kindsOf("mine").includes(kind) || (doc.status !== "active" && doc.status !== "candidate")) continue;
    const at = doc.updatedAt ?? doc.createdAt;
    const projectName =
      doc.scope.project === "*" ? "Every project" : (normalizeRepo(doc.scope.project) ?? doc.scope.project);
    const project = g.add(`project:${doc.scope.project}`, "project", {
      label: clip(projectName, LABEL_MAX),
      text: projectName,
      href: `/memories?project=${encodeURIComponent(doc.scope.project)}`,
      count: 0,
    });
    project.count = (project.count ?? 0) + 1;
    touch(project, at);

    const params = new URLSearchParams({ status: doc.status, kind: doc.kind, project: doc.scope.project });
    const memory = g.add(`memory:${doc._id.toHexString()}`, kind, {
      label: clip(doc.text, LABEL_MAX),
      text: clip(doc.text, TEXT_MAX),
      href: `/memories?${params}`,
      context: projectName,
      status: doc.status,
      count: 1,
    });
    touch(memory, at);
    g.link(project.id, memory.id, "contains");

    const sessionId = doc.provenance?.sessionID;
    if (sessionId) {
      const session = g.add(`session:${sessionId}`, "session", {
        label: `Session ${dayLabel(doc.createdAt)}`,
        href: sessionHref(sessionId),
        context: projectName,
        count: 0,
      });
      session.count = (session.count ?? 0) + 1;
      touch(session, at, sessionId);
      g.link(memory.id, session.id, "found_in");
    }
  }
  return { graph: g, limited: docs.length >= MEMORY_LIMIT };
}

// From everything put together to what's drawn: the kinds asked for (joining what a hidden ticket, area or session
// held together), the minimum connections, then the cap.
function shape(g: Builder, query: GraphQuery, flags: { sourceLimited: boolean; missingProduct: boolean }): GraphData {
  const stats = emptyStats(query.scope, flags.missingProduct);
  stats.sourceLimited = flags.sourceLimited;
  stats.totalNodes = g.nodes.size;
  stats.totalEdges = g.edges.size;

  const shownKinds = new Set<GraphNodeKind>(query.kinds ?? kindsOf(query.scope));
  const visible = new Set([...g.nodes.values()].filter((n) => shownKinds.has(n.kind)).map((n) => n.id));
  stats.hiddenByKind = g.nodes.size - visible.size;

  const neighbours = new Map<string, Set<string>>();
  for (const e of g.edges.values()) {
    neighbours.set(e.source, (neighbours.get(e.source) ?? new Set()).add(e.target));
    neighbours.set(e.target, (neighbours.get(e.target) ?? new Set()).add(e.source));
  }
  const edges = new Map<string, GraphEdge>();
  for (const [key, e] of g.edges) if (visible.has(e.source) && visible.has(e.target)) edges.set(key, e);

  // Through what's hidden: two sessions on a hidden ticket are on the same ticket; a finding of a hidden session is
  // about that session's tickets, pull requests and areas, and part of its product.
  const recent = (ids: Iterable<string>) =>
    [...ids].sort((a, b) => (g.nodes.get(b)?.last ?? 0) - (g.nodes.get(a)?.last ?? 0) || a.localeCompare(b));
  for (const hidden of g.nodes.values()) {
    if (visible.has(hidden.id)) continue;
    const around = recent([...(neighbours.get(hidden.id) ?? [])].filter((id) => visible.has(id)));
    if (hidden.kind === "ticket" || hidden.kind === "area") {
      const type = hidden.kind === "ticket" ? "same_ticket" : "same_area";
      const joined = around.slice(0, PROJECT_NEIGHBOURS);
      for (let i = 0; i < joined.length; i++)
        for (let j = i + 1; j < joined.length; j++) linkInto(edges, joined[i]!, joined[j]!, type, true);
    } else if (hidden.kind === "session") {
      const found = around.filter((id) => FINDING_KINDS.has(g.nodes.get(id)!.kind));
      const context = around.filter((id) => CONTEXT_KINDS.has(g.nodes.get(id)!.kind));
      for (const f of found)
        for (const c of context) {
          const kind = g.nodes.get(c)!.kind;
          if (kind === "product" || kind === "project") linkInto(edges, c, f, "contains", true);
          else linkInto(edges, f, c, "about", true);
        }
    }
  }

  const degreeIn = (ids: Set<string>, list: Iterable<GraphEdge>) => {
    const degree = new Map<string, number>([...ids].map((id) => [id, 0]));
    for (const e of list)
      if (ids.has(e.source) && ids.has(e.target)) {
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
      }
    return degree;
  };

  let degree = degreeIn(visible, edges.values());
  const minDegree = Math.max(0, query.minDegree ?? 0);
  const enough = new Set([...visible].filter((id) => (degree.get(id) ?? 0) >= minDegree));
  stats.belowMinDegree = visible.size - enough.size;

  // The cap: the most connected, then the most recent of the rest.
  let kept = enough;
  if (enough.size > NODE_CAP) {
    const ids = [...enough];
    const byDegree = [...ids].sort(
      (a, b) =>
        (degree.get(b) ?? 0) - (degree.get(a) ?? 0) ||
        (g.nodes.get(b)?.last ?? 0) - (g.nodes.get(a)?.last ?? 0) ||
        a.localeCompare(b),
    );
    kept = new Set(byDegree.slice(0, KEEP_CONNECTED));
    for (const id of recent(ids.filter((id) => !kept.has(id)))) {
      if (kept.size >= NODE_CAP) break;
      kept.add(id);
    }
    for (const id of ids)
      if (!kept.has(id)) {
        const kind = g.nodes.get(id)!.kind;
        stats.cutByKind[kind] = (stats.cutByKind[kind] ?? 0) + 1;
      }
    stats.cut = ids.length - kept.size;
  }

  const finalEdges = [...edges.values()].filter((e) => kept.has(e.source) && kept.has(e.target));
  degree = degreeIn(kept, finalEdges);

  const order = kindsOf(query.scope);
  const nodes: GraphNode[] = [...kept]
    .map((id) => g.nodes.get(id)!)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.last - a.last || a.id.localeCompare(b.id))
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      text: d.text,
      href: d.href,
      external: d.external,
      context: d.context,
      status: d.status,
      workedOnBy: [...d.people].sort((a, b) => a.localeCompare(b)),
      metrics: {
        degree: degree.get(d.id) ?? 0,
        lastSeen: d.last ? new Date(d.last).toISOString() : null,
        occurrences: d.count ?? Math.max(d.sessions.size, 1),
        hoursLost: d.hoursLost,
        recurrence: d.recurrence,
      },
    }));
  stats.nodes = nodes.length;
  stats.edges = finalEdges.length;
  return { nodes, edges: finalEdges, stats };
}
