// The knowledge graph, first version: how approved work links up, worked out on each read from the team read model
// (team-records.ts) and the gaps (gaps.ts), as the viewer may see them. Nothing here is stored.
//
// Two sessions are linked when they share a ticket, a pull request, a code area or a context gap. A code area is a
// place in a repository: an area a session's summary names ("billing/ledger"), or the folder of a file it changed
// (src/billing/ledger). Two places are the same when two summaries name the same area, two sessions changed files in
// the same folder, or a summary's area is part of a folder's path ("billing/ledger" is in src/billing/ledger/posting).
// Places only link sessions in the same repository; tickets, pull requests and gaps link across products. A later
// insight, workflow finding or decision replaces an earlier one when it's the same kind, in the same repository, from
// another session, and most of its words are the same.
//
// An approved insight or workflow finding may be stale when a later approved session worked in its code area: a later
// summary named the same area, or changed files in its folder or below it. It's the first version's stand-in for "a
// later pull request changed it", until there are PR lookups.
//
// Who sees what is the read model's: approved work for everyone who isn't suspended, a draft for its author only. The
// work linked to is always approved; a viewer's own drafts only add links from their own session's page. The few
// direct reads here (the files a summary lists, the gaps a session named) are of approved work only, and only for
// sessions the read model has already returned. Nothing counts, ranks or compares people.
import { ObjectId } from "mongodb";
import { gaps as gapDocs, records as recordDocs, summaryRevisions } from "../collections.ts";
import { type Gap, getGap, listGaps } from "./gaps.ts";
import { type RefLink, refLinks, webUrl } from "./product-page.ts";
import { getProduct, listProducts } from "./products.ts";
import { reader, type ViewerRef } from "./reader.ts";
import { recordsFor, sessionDetail, type TeamRecord, type TeamRecordKind } from "./team-records.ts";
import { DAY_MS, normalizePath, normalizeText, pathWithin } from "./text.ts";

// How far back related work is looked for, and how much of it.
const POOL_DAYS = 365;
const POOL_LIMIT = 1000;
// What one Related panel shows.
export const RELATED_SHOWN = 8;
// How many shared code areas count toward an item's rank: a session that touched ten of the same folders is close,
// but not ten times closer than one on the same ticket.
const AREA_LINKS_COUNTED = 3;
// The folders of a session's files looked at, the most used first.
const FOLDERS_KEPT = 40;
// The longest area, in folders, matched inside a folder's path.
const AREA_DEPTH = 8;
// A product's graph: how far back, and how many of each kind of node, so it stays readable.
export const GRAPH_DAYS = 180;
export const GRAPH_LIMITS = { areas: 6, findings: 4, tickets: 3, prs: 2, openGaps: 2, resolvedGaps: 1 } as const;
// Insights and workflow findings listed under the graph.
const FINDINGS_LISTED = 6;

const FINDINGS: TeamRecordKind[] = ["insight", "workflow"];
const REPLACEABLE: TeamRecordKind[] = ["insight", "workflow", "decision"];

export const KIND_LABELS: Record<TeamRecordKind, string> = {
  summary: "Summary",
  decision: "Decision",
  insight: "Insight",
  workflow: "Workflow finding",
  pain_point: "Pain point",
  context_gap: "Context gap",
  open: "Open question",
};

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const sessionHref = (sessionId: string, anchor?: string): string =>
  `/sessions/${encodeURIComponent(sessionId)}${anchor ? `#${anchor}` : ""}`;

// The session page's card for a kind of finding (sessions/[id]/page.tsx); decisions sit in its summary.
const findingAnchor = (kind: TeamRecordKind): string | undefined =>
  kind === "insight" || kind === "workflow" || kind === "pain_point" || kind === "context_gap" || kind === "open"
    ? `group-${kind}`
    : undefined;

// ---------------------------------------------------------------------------------------------------------------------
// Places: code areas and folders
// ---------------------------------------------------------------------------------------------------------------------

export interface Place {
  kind: "area" | "folder";
  // Lower case, forward slashes, no leading or trailing slash: what's compared.
  path: string;
  // As written: what's shown.
  label: string;
}

export function placeOf(kind: Place["kind"], raw: string): Place | null {
  const label = normalizePath(raw).replace(/\s+/g, " ");
  const path = label.toLowerCase();
  return path ? { kind, path, label } : null;
}

// The folder a file is in, or null at the repository's root.
export function folderOf(file: string): string | null {
  const path = normalizePath(file);
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : null;
}

// Every run of up to `max` folders in a path: a/b/c gives a, a/b, a/b/c, b, b/c, c.
function runsOf(path: string, max = AREA_DEPTH): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++)
    for (let n = 1; n <= max && i + n <= parts.length; n++) out.push(parts.slice(i, i + n).join("/"));
  return out;
}

// The folders above a path: a/b/c gives a and a/b.
const ancestorsOf = (path: string): string[] => {
  const parts = path.split("/");
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"));
};

// The code area two places share, as it's shown, or null. Two areas are the same area when they're named the same; two
// folders when they're the same folder (or, `nested`, when the second is inside the first: later work below an
// insight's folder changed it too); an area and a folder when the area is part of the folder's path.
export function sharedPlace(a: Place, b: Place, nested = false): string | null {
  if (a.kind === "area" && b.kind === "area") return a.path === b.path ? a.label : null;
  if (a.kind === "folder" && b.kind === "folder")
    return a.path === b.path || (nested && pathWithin(b.path, a.path)) ? a.label : null;
  const area = a.kind === "area" ? a : b;
  const folder = a.kind === "area" ? b : a;
  return area.path.split("/").length <= AREA_DEPTH && `/${folder.path}/`.includes(`/${area.path}/`) ? area.label : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sessions, as the links they offer
// ---------------------------------------------------------------------------------------------------------------------

export interface SessionFacts {
  sessionId: string;
  repo: string;
  productId: string | null;
  // Its summary's title, else the start of its summary or first finding.
  title: string;
  // Its latest approval; for a session with only drafts, its latest change.
  at: Date;
  // Its tickets and pull requests. A pull request known only by number is keyed within its repository.
  refs: RefLink[];
  // The areas its summary names, then the folders of the files it changed.
  places: Place[];
  // The gaps it came up in.
  gapIds: string[];
  records: TeamRecord[];
}

const linkKey = (ref: RefLink, repo: string): string =>
  ref.kind === "pr" && !ref.url ? `pr:${repo}#${ref.label.toLowerCase()}` : ref.key;

// Each session in some records, with what links it to others.
export function sessionFacts(
  records: TeamRecord[],
  files: Map<string, string[]>,
  gapsBySession: Map<string, string[]>,
): Map<string, SessionFacts> {
  const groups = new Map<string, TeamRecord[]>();
  for (const record of records) groups.set(record.sessionId, [...(groups.get(record.sessionId) ?? []), record]);
  const out = new Map<string, SessionFacts>();
  for (const [sessionId, items] of groups) {
    const newest = [...items].sort((a, b) => b.at.getTime() - a.at.getTime());
    const summary = newest.find((r) => r.kind === "summary" && r.title) ?? newest.find((r) => r.kind === "summary");
    const first = summary ?? newest[0];
    if (!first) continue;
    const repo = first.repo || (newest.find((r) => r.repo)?.repo ?? "");
    const approved = newest.filter((r) => r.status === "approved");

    const places = new Map<string, Place>();
    for (const raw of items.flatMap((r) => r.areas)) {
      const place = placeOf("area", raw);
      if (place && !places.has(`a:${place.path}`)) places.set(`a:${place.path}`, place);
    }
    const folderUse = new Map<string, number>();
    for (const file of files.get(sessionId) ?? []) {
      const folder = folderOf(file);
      if (folder) folderUse.set(folder, (folderUse.get(folder) ?? 0) + 1);
    }
    const folders = [...folderUse.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, FOLDERS_KEPT);
    for (const [folder] of folders) {
      const place = placeOf("folder", folder);
      if (place && !places.has(`f:${place.path}`)) places.set(`f:${place.path}`, place);
    }

    out.set(sessionId, {
      sessionId,
      repo,
      productId: newest.find((r) => r.productId)?.productId ?? null,
      title: summary?.title ?? clip(summary?.text ?? first.text, 120),
      at: (approved[0] ?? first).at,
      refs: refLinks(newest.flatMap((r) => r.refs)).map((ref) => ({ ...ref, key: linkKey(ref, repo) })),
      places: [...places.values()],
      gapIds: [...new Set(gapsBySession.get(sessionId) ?? [])],
      records: newest,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Matching: an index of what each session offers, probed with what another has
// ---------------------------------------------------------------------------------------------------------------------

export type LinkKind = "ticket" | "pr" | "area" | "gap" | "session" | "found_in" | "replaces" | "replaced_by" | "words";

export interface Reason {
  link: LinkKind;
  // "same ticket PAY-412", "same area billing/ledger".
  text: string;
}

type Index = Map<string, { sessionId: string; label: string }[]>;

const placeKey = (repo: string, key: string): string => `${repo}\u001f${key}`;

function indexOf(sessions: Iterable<SessionFacts>, { placesOnly = false } = {}): Index {
  const index: Index = new Map();
  const add = (key: string, sessionId: string, label: string) => {
    const list = index.get(key);
    if (list) list.push({ sessionId, label });
    else index.set(key, [{ sessionId, label }]);
  };
  for (const s of sessions) {
    if (!placesOnly) {
      for (const ref of s.refs) add(ref.key, s.sessionId, ref.label);
      for (const id of s.gapIds) add(`gap:${id}`, s.sessionId, id);
    }
    if (!s.repo) continue;
    for (const p of s.places) {
      if (p.kind === "area") {
        add(placeKey(s.repo, `a:${p.path}`), s.sessionId, p.label);
        continue;
      }
      add(placeKey(s.repo, `f:${p.path}`), s.sessionId, p.label);
      for (const run of runsOf(p.path)) add(placeKey(s.repo, `r:${run}`), s.sessionId, p.label);
      for (const above of ancestorsOf(p.path)) add(placeKey(s.repo, `u:${above}`), s.sessionId, p.label);
    }
  }
  return index;
}

interface Probe {
  key: string;
  link: LinkKind;
  // What the reason names: the probing side's, or (null) the matched side's.
  label: string | null;
}

// What to look a session's links up by. Mirrors sharedPlace: an area finds the same area and the folders it's part of;
// a folder finds the same folder, the areas that are part of its path and, `nested`, the folders inside it.
function probesOf(s: SessionFacts, { nested = false, placesOnly = false, skipGap = "" } = {}): Probe[] {
  const out: Probe[] = [];
  if (!placesOnly) {
    for (const ref of s.refs) out.push({ key: ref.key, link: ref.kind, label: ref.label });
    for (const id of s.gapIds) if (id !== skipGap) out.push({ key: `gap:${id}`, link: "gap", label: id });
  }
  if (!s.repo) return out;
  for (const p of s.places) {
    if (p.kind === "area") {
      out.push({ key: placeKey(s.repo, `a:${p.path}`), link: "area", label: p.label });
      if (p.path.split("/").length <= AREA_DEPTH)
        out.push({ key: placeKey(s.repo, `r:${p.path}`), link: "area", label: p.label });
      continue;
    }
    out.push({ key: placeKey(s.repo, `f:${p.path}`), link: "area", label: p.label });
    for (const run of runsOf(p.path)) out.push({ key: placeKey(s.repo, `a:${run}`), link: "area", label: null });
    if (nested) out.push({ key: placeKey(s.repo, `u:${p.path}`), link: "area", label: p.label });
  }
  return out;
}

export interface Match {
  reasons: Reason[];
  // Links shared, with code areas counted up to AREA_LINKS_COUNTED.
  score: number;
}

// The sessions in the index that share a link with any of the subjects, each with what they share.
function matchesOf(
  subjects: SessionFacts[],
  index: Index,
  options: {
    nested?: boolean;
    placesOnly?: boolean;
    exclude?: Set<string>;
    skipGap?: string;
    gapText?: (id: string) => string;
  },
): Map<string, Match> {
  const found = new Map<string, Map<string, Reason>>();
  for (const subject of subjects)
    for (const probe of probesOf(subject, options))
      for (const entry of index.get(probe.key) ?? []) {
        if (options.exclude?.has(entry.sessionId)) continue;
        const label = probe.label ?? entry.label;
        const reason: Reason =
          probe.link === "gap"
            ? { link: "gap", text: `same gap “${clip(options.gapText?.(label) ?? "a context gap", 60)}”` }
            : probe.link === "ticket"
              ? { link: "ticket", text: `same ticket ${label}` }
              : probe.link === "pr"
                ? { link: "pr", text: `same ${label}` }
                : { link: "area", text: `same area ${label}` };
        const key = `${reason.link}\u001f${probe.link === "gap" ? label : reason.text.toLowerCase()}`;
        const reasons = found.get(entry.sessionId) ?? new Map<string, Reason>();
        if (!reasons.has(key)) reasons.set(key, reason);
        found.set(entry.sessionId, reasons);
      }
  return new Map(
    [...found.entries()].map(([sessionId, reasons]) => {
      const list = orderReasons([...reasons.values()]);
      return [sessionId, { reasons: list, score: scoreOf(list) }];
    }),
  );
}

const REASON_ORDER: LinkKind[] = [
  "found_in",
  "replaces",
  "replaced_by",
  "ticket",
  "pr",
  "gap",
  "session",
  "words",
  "area",
];

const orderReasons = (reasons: Reason[]): Reason[] =>
  [...reasons].sort((a, b) => REASON_ORDER.indexOf(a.link) - REASON_ORDER.indexOf(b.link));

const scoreOf = (reasons: Reason[]): number =>
  reasons.filter((r) => r.link !== "area").length +
  Math.min(AREA_LINKS_COUNTED, reasons.filter((r) => r.link === "area").length);

// ---------------------------------------------------------------------------------------------------------------------
// Replacing and staleness
// ---------------------------------------------------------------------------------------------------------------------

const wordsOf = (text: string): Set<string> =>
  new Set(
    normalizeText(text)
      .split(" ")
      .filter((w) => w.length >= 3),
  );

// Whether a later finding replaces an earlier one: the same kind (an insight, workflow finding or decision), the same
// repository, another session, and most of the same words (at least three shared, and half of all the words).
export function replaces(newer: TeamRecord, older: TeamRecord): boolean {
  if (newer.kind !== older.kind || !REPLACEABLE.includes(newer.kind)) return false;
  if (!newer.repo || newer.repo !== older.repo || newer.sessionId === older.sessionId) return false;
  if (newer.status !== "approved" || older.status !== "approved" || newer.at <= older.at) return false;
  const a = wordsOf(newer.text);
  const b = wordsOf(older.text);
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const all = a.size + b.size - shared;
  return shared >= 3 && shared / all >= 0.5;
}

export interface Staleness {
  // The code area the later work was in.
  place: string;
  // The latest session that worked there since.
  sessionId: string;
  title: string;
  at: Date;
  // How many later sessions worked there.
  sessions: number;
}

// The approved insights and workflow findings in `records` whose code area later approved work in `records` changed,
// by record id. `records` is everything to judge by: the findings and the later work. `only` limits which findings are
// judged.
export function staleFrom(
  records: TeamRecord[],
  files: Map<string, string[]>,
  only?: Set<string>,
): Map<string, Staleness> {
  const approved = records.filter((r) => r.status === "approved");
  const facts = sessionFacts(approved, files, new Map());
  const index = indexOf(facts.values(), { placesOnly: true });
  const hitsOf = new Map<string, Map<string, Match>>();
  const out = new Map<string, Staleness>();
  for (const record of approved) {
    if (!FINDINGS.includes(record.kind) || (only && !only.has(record.id))) continue;
    const own = facts.get(record.sessionId);
    if (!own?.repo || !own.places.length) continue;
    let hits = hitsOf.get(own.sessionId);
    if (!hits) {
      hits = matchesOf([own], index, { nested: true, placesOnly: true, exclude: new Set([own.sessionId]) });
      hitsOf.set(own.sessionId, hits);
    }
    const later = [...hits.entries()]
      .map(([sessionId, match]) => ({ session: facts.get(sessionId), match }))
      .filter((h): h is { session: SessionFacts; match: Match } => Boolean(h.session && h.session.at > record.at))
      .sort(
        (a, b) =>
          b.session.at.getTime() - a.session.at.getTime() || a.session.sessionId.localeCompare(b.session.sessionId),
      );
    const newest = later[0];
    if (!newest) continue;
    out.set(record.id, {
      place: newest.match.reasons[0]?.text.replace(/^same area /, "") ?? "",
      sessionId: newest.session.sessionId,
      title: newest.session.title,
      at: newest.session.at,
      sessions: later.length,
    });
  }
  return out;
}

// The latest approved summary's files of each session.
async function latestFiles(sessionIds: string[]): Promise<Map<string, string[]>> {
  if (!sessionIds.length) return new Map();
  const rows = await summaryRevisions()
    .aggregate<{ sessionId: string; files: string[] | null }>([
      { $match: { sessionId: { $in: sessionIds } } },
      { $sort: { revision: -1, updatedAt: -1 } },
      { $group: { _id: { userId: "$userId", sessionId: "$sessionId" }, files: { $first: "$files" } } },
      { $project: { _id: 0, sessionId: "$_id.sessionId", files: 1 } },
    ])
    .toArray();
  const out = new Map<string, string[]>();
  for (const row of rows)
    out.set(row.sessionId, [...(out.get(row.sessionId) ?? []), ...(Array.isArray(row.files) ? row.files : [])]);
  return out;
}

// An approved insight or workflow finding may be stale when a later approved session worked in its code area. `records`
// is the work to judge, and to judge it by: pass the product's or the team's approved work, not the findings alone.
export async function mayBeStale(records: TeamRecord[], only?: Set<string>): Promise<Map<string, Staleness>> {
  const sessions = [...new Set(records.filter((r) => r.status === "approved").map((r) => r.sessionId))];
  return staleFrom(records, await latestFiles(sessions), only);
}

// ---------------------------------------------------------------------------------------------------------------------
// Gaps, as the sessions they came up in
// ---------------------------------------------------------------------------------------------------------------------

interface GapFact {
  id: string;
  text: string;
  status: "open" | "resolved";
  productId: string | null;
}

async function gapsOfSessions(
  sessionIds: string[],
): Promise<{ bySession: Map<string, string[]>; gaps: Map<string, GapFact> }> {
  const bySession = new Map<string, string[]>();
  const found = new Map<string, GapFact>();
  if (!sessionIds.length) return { bySession, gaps: found };
  const wanted = new Set(sessionIds.map((id) => `session:${id}`));
  const docs = await gapDocs()
    .find({ sourceIds: { $in: [...wanted] } }, { projection: { text: 1, status: 1, productId: 1, sourceIds: 1 } })
    .toArray();
  for (const doc of docs) {
    const id = doc._id.toHexString();
    found.set(id, { id, text: doc.text, status: doc.status, productId: doc.productId });
    for (const source of doc.sourceIds ?? [])
      if (wanted.has(source)) {
        const sessionId = source.slice("session:".length);
        bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), id]);
      }
  }
  return { bySession, gaps: found };
}

// ---------------------------------------------------------------------------------------------------------------------
// Related
// ---------------------------------------------------------------------------------------------------------------------

export type RelatedSubject = { sessionId: string } | { productId: string } | { gapId: string } | { recordId: string };

export interface RelatedItem {
  key: string;
  kind: "session" | "record" | "gap" | "product";
  id: string;
  href: string;
  // "Session", "Insight", "Context gap", "Product".
  label: string;
  title: string;
  product: { id: string; name: string } | null;
  // ISO; null for a product.
  at: string | null;
  reasons: Reason[];
  score: number;
  resolved: boolean;
}

export interface StaleView {
  recordId: string;
  kind: TeamRecordKind;
  kindLabel: string;
  text: string;
  place: string;
  later: { sessionId: string; title: string; at: string; href: string };
  // How many later sessions worked there.
  sessions: number;
}

export interface Related {
  // Ranked by links shared, then newest; up to the limit.
  items: RelatedItem[];
  // Related beyond the limit.
  more: number;
  // The subject's own insights and workflow findings that may be stale (sessions and records).
  stale: StaleView[];
}

const EMPTY: Related = { items: [], more: 0, stale: [] };

function ranked(items: RelatedItem[], limit: number): { items: RelatedItem[]; more: number } {
  const sorted = [...items].sort(
    (a, b) =>
      b.score - a.score ||
      (b.at ?? "").localeCompare(a.at ?? "") ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
  return { items: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) };
}

const staleView = (record: TeamRecord, flag: Staleness): StaleView => ({
  recordId: record.id,
  kind: record.kind,
  kindLabel: KIND_LABELS[record.kind],
  text: record.text,
  place: flag.place,
  later: {
    sessionId: flag.sessionId,
    title: flag.title,
    at: flag.at.toISOString(),
    href: sessionHref(flag.sessionId),
  },
  sessions: flag.sessions,
});

type Names = Map<string, string>;

const productRef = (id: string | null, names: Names): RelatedItem["product"] => {
  const name = id ? names.get(id) : undefined;
  return id && name ? { id, name } : null;
};

function sessionItem(s: SessionFacts, match: Match, names: Names): RelatedItem {
  return {
    key: `session:${s.sessionId}`,
    kind: "session",
    id: s.sessionId,
    href: sessionHref(s.sessionId),
    label: "Session",
    title: s.title,
    product: productRef(s.productId, names),
    at: s.at.toISOString(),
    reasons: match.reasons,
    score: match.score,
    resolved: false,
  };
}

function gapItem(gap: GapFact, reasons: Reason[], score: number, names: Names, at: string | null = null): RelatedItem {
  return {
    key: `gap:${gap.id}`,
    kind: "gap",
    id: gap.id,
    href: `/gaps/${gap.id}`,
    label: gap.status === "resolved" ? "Resolved gap" : "Context gap",
    title: clip(gap.text, 160),
    product: productRef(gap.productId, names),
    at,
    reasons,
    score,
    resolved: gap.status === "resolved",
  };
}

async function poolFor(viewer: ViewerRef, now: Date): Promise<{ pool: TeamRecord[]; names: Names }> {
  const [pool, products] = await Promise.all([
    recordsFor({ since: new Date(now.getTime() - POOL_DAYS * DAY_MS), limit: POOL_LIMIT }, viewer),
    listProducts(viewer),
  ]);
  return { pool, names: new Map(products.map((p) => [p.id, p.name])) };
}

// The session a record belongs to, by its id: a record's ObjectId, or a summary line's s.<revision>.<field>.<index>.
async function sessionOfRecord(recordId: string): Promise<string | null> {
  const line = /^s\.([a-f0-9]{24})\./i.exec(recordId);
  if (line?.[1]) {
    const doc = await summaryRevisions().findOne({ _id: new ObjectId(line[1]) }, { projection: { sessionId: 1 } });
    return doc?.sessionId ?? null;
  }
  if (!/^[a-f0-9]{24}$/i.test(recordId)) return null;
  const doc = await recordDocs().findOne({ _id: new ObjectId(recordId) }, { projection: { sessionID: 1 } });
  return doc?.sessionID ?? null;
}

// Work related to a session, a record, a gap or a product, as the viewer may see it: the approved sessions, findings,
// gaps and products it shares links with, each with the links it shares, ranked by how many and capped. A session's or
// a record's own findings that may be stale come with it.
export async function relatedTo(
  subject: RelatedSubject,
  viewer: ViewerRef,
  options: { limit?: number; now?: Date } = {},
): Promise<Related> {
  if (!(await reader(viewer))) return EMPTY;
  const limit = Math.max(1, options.limit ?? RELATED_SHOWN);
  const now = options.now ?? new Date();
  if ("sessionId" in subject) {
    const detail = subject.sessionId ? await sessionDetail(subject.sessionId, viewer) : null;
    return detail ? relatedToSession(detail.sessionId, detail.records, null, viewer, limit, now) : EMPTY;
  }
  if ("recordId" in subject) {
    const sessionId = subject.recordId ? await sessionOfRecord(subject.recordId) : null;
    const detail = sessionId ? await sessionDetail(sessionId, viewer) : null;
    const record = detail?.records.find((r) => r.id === subject.recordId);
    return detail && record ? relatedToSession(detail.sessionId, detail.records, record, viewer, limit, now) : EMPTY;
  }
  if ("gapId" in subject) return relatedToGap(subject.gapId, viewer, limit, now);
  return relatedToProduct(subject.productId, viewer, limit, now);
}

// A session (or one record in it): other sessions on the same ticket, pull request, code area or gap; findings that
// replace its own or that its own replace; the gaps it came up in (for a record, its own gap).
async function relatedToSession(
  sessionId: string,
  own: TeamRecord[],
  focus: TeamRecord | null,
  viewer: ViewerRef,
  limit: number,
  now: Date,
): Promise<Related> {
  const { pool, names } = await poolFor(viewer, now);
  const others = pool.filter((r) => r.sessionId !== sessionId);
  const sessionIds = [...new Set([sessionId, ...others.map((r) => r.sessionId)])];
  const [files, gapInfo] = await Promise.all([latestFiles(sessionIds), gapsOfSessions(sessionIds)]);
  const subject = sessionFacts(own, files, gapInfo.bySession).get(sessionId);
  if (!subject) return EMPTY;
  // A record's own gap: the one with its words, when it's a context gap; a record links by no other gap.
  if (focus) {
    const words = normalizeText(focus.text);
    subject.gapIds =
      focus.kind === "context_gap"
        ? subject.gapIds.filter((id) => normalizeText(gapInfo.gaps.get(id)?.text ?? "") === words)
        : [];
  }
  const facts = sessionFacts(others, files, gapInfo.bySession);
  const gapText = (id: string) => gapInfo.gaps.get(id)?.text ?? "a context gap";
  const matches = matchesOf([subject], indexOf(facts.values()), { exclude: new Set([sessionId]), gapText });

  const items: RelatedItem[] = [];
  for (const [id, match] of matches) {
    const s = facts.get(id);
    if (s) items.push(sessionItem(s, match, names));
  }

  // Findings that replace this session's (or this record), or that it replaces.
  const mine = (focus ? [focus] : own).filter((r) => r.status === "approved" && REPLACEABLE.includes(r.kind));
  const subjectWord = focus ? `this ${KIND_LABELS[focus.kind].toLowerCase()}` : "one in this session";
  for (const other of others) {
    if (!REPLACEABLE.includes(other.kind)) continue;
    const newer = mine.find((m) => replaces(other, m));
    const older = newer ? undefined : mine.find((m) => replaces(m, other));
    if (!newer && !older) continue;
    const reason: Reason = newer
      ? { link: "replaces", text: `a later version of ${subjectWord}` }
      : { link: "replaced_by", text: `an earlier version of ${subjectWord}` };
    items.push({
      key: `record:${other.id}`,
      kind: "record",
      id: other.id,
      href: sessionHref(other.sessionId, findingAnchor(other.kind)),
      label: KIND_LABELS[other.kind],
      title: clip(other.text, 160),
      product: productRef(other.productId, names),
      at: other.at.toISOString(),
      reasons: [reason],
      score: 2,
      resolved: false,
    });
  }

  // The gaps it came up in.
  for (const id of subject.gapIds) {
    const gap = gapInfo.gaps.get(id);
    if (gap) items.push(gapItem(gap, [{ link: "found_in", text: "came up in this session" }], 1, names));
  }

  // A record's own session.
  if (focus) {
    const s = sessionFacts(own, files, gapInfo.bySession).get(sessionId);
    if (s)
      items.push(
        sessionItem(
          s,
          { reasons: [{ link: "found_in", text: "where it was shared" }], score: Number.MAX_SAFE_INTEGER },
          names,
        ),
      );
  }

  const ownApproved = own.filter((r) => r.status === "approved");
  const judged = new Set((focus ? [focus] : ownApproved).filter((r) => FINDINGS.includes(r.kind)).map((r) => r.id));
  const stale = judged.size ? staleFrom([...others, ...ownApproved], files, judged) : new Map<string, Staleness>();
  return {
    ...ranked(items, limit),
    stale: ownApproved.flatMap((r) => {
      const flag = stale.get(r.id);
      return flag ? [staleView(r, flag)] : [];
    }),
  };
}

// A gap: sessions on the same ticket, pull request or code area as the sessions it came up in; other gaps that came up
// in those sessions; the same words asked about in another product.
async function relatedToGap(gapId: string, viewer: ViewerRef, limit: number, now: Date): Promise<Related> {
  const gap = await getGap(gapId, viewer);
  if (!gap) return EMPTY;
  const [{ pool, names }, allGaps] = await Promise.all([poolFor(viewer, now), listGaps({}, viewer)]);
  const own = new Set(gap.sessionIds);
  const sessionIds = [...new Set([...gap.sessionIds, ...pool.map((r) => r.sessionId)])];
  const [files, gapInfo] = await Promise.all([latestFiles(sessionIds), gapsOfSessions(sessionIds)]);
  const facts = sessionFacts(pool, files, gapInfo.bySession);
  const subjects = gap.sessionIds.flatMap((id) => facts.get(id) ?? []);
  const others = [...facts.values()].filter((s) => !own.has(s.sessionId));
  const gapText = (id: string) => gapInfo.gaps.get(id)?.text ?? "a context gap";
  const matches = matchesOf(subjects, indexOf(others), { exclude: own, skipGap: gap.id, gapText });

  const items: RelatedItem[] = [];
  for (const [id, match] of matches) {
    const s = facts.get(id);
    if (s) items.push(sessionItem(s, match, names));
  }

  const together = new Map<string, number>();
  for (const s of subjects) for (const id of s.gapIds) if (id !== gap.id) together.set(id, (together.get(id) ?? 0) + 1);
  const listed = new Map(allGaps.map((g) => [g.id, g]));
  const at = (id: string) => listed.get(id)?.lastSeen?.toISOString() ?? null;
  for (const [id, sessions] of together) {
    const other = gapInfo.gaps.get(id);
    if (other)
      items.push(
        gapItem(
          other,
          [
            {
              link: "session",
              text: sessions === 1 ? "came up in the same session" : `came up in ${sessions} of the same sessions`,
            },
          ],
          sessions,
          names,
          at(id),
        ),
      );
  }

  const words = normalizeText(gap.text);
  for (const other of allGaps)
    if (other.id !== gap.id && !together.has(other.id) && normalizeText(other.text) === words)
      items.push(
        gapItem(
          { id: other.id, text: other.text, status: other.status, productId: other.productId },
          [
            {
              link: "words",
              text: other.productId === gap.productId ? "the same question" : "the same question, in another product",
            },
          ],
          1,
          names,
          at(other.id),
        ),
      );

  return { ...ranked(items, limit), stale: [] };
}

// A product: the other products that share tickets, pull requests or context gaps with it.
async function relatedToProduct(productId: string, viewer: ViewerRef, limit: number, now: Date): Promise<Related> {
  const product = productId ? await getProduct(productId, viewer) : null;
  if (!product) return EMPTY;
  const { pool, names } = await poolFor(viewer, now);
  const sessionIds = [...new Set(pool.map((r) => r.sessionId))];
  const gapInfo = await gapsOfSessions(sessionIds);
  const facts = sessionFacts(pool, new Map(), gapInfo.bySession);

  // What each product's work links by: its tickets, pull requests and gaps' words, each with how it's shown.
  const links = new Map<string, Map<string, Reason>>();
  const latest = new Map<string, Date>();
  for (const s of facts.values()) {
    if (!s.productId) continue;
    const mine = links.get(s.productId) ?? new Map<string, Reason>();
    for (const ref of s.refs)
      mine.set(ref.key, {
        link: ref.kind,
        text: ref.kind === "ticket" ? `same ticket ${ref.label}` : `same ${ref.label}`,
      });
    for (const id of s.gapIds) {
      const text = gapInfo.gaps.get(id)?.text;
      if (text) mine.set(`gap:${normalizeText(text)}`, { link: "gap", text: `same gap “${clip(text, 60)}”` });
    }
    links.set(s.productId, mine);
    if (s.at > (latest.get(s.productId) ?? new Date(0))) latest.set(s.productId, s.at);
  }

  const ours = links.get(product.id) ?? new Map<string, Reason>();
  const items: RelatedItem[] = [];
  for (const [otherId, theirs] of links) {
    const name = names.get(otherId);
    if (otherId === product.id || !name) continue;
    const reasons = orderReasons([...ours.entries()].filter(([key]) => theirs.has(key)).map(([, reason]) => reason));
    if (!reasons.length) continue;
    items.push({
      key: `product:${otherId}`,
      kind: "product",
      id: otherId,
      href: `/products/${encodeURIComponent(otherId)}`,
      label: "Product",
      title: name,
      product: null,
      at: latest.get(otherId)?.toISOString() ?? null,
      reasons,
      score: reasons.length,
      resolved: false,
    });
  }
  return { ...ranked(items, limit), stale: [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// A product's graph
// ---------------------------------------------------------------------------------------------------------------------

export type GraphNodeKind = "product" | "area" | "insight" | "workflow" | "ticket" | "pr" | "gap" | "answer";
export type GraphEdgeKind = "contains" | "about" | "worked_on" | "changes" | "resolved_by";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  // Short, for the node.
  label: string;
  // In full, for its tooltip and screen readers.
  title: string;
  href: string;
  external: boolean;
  // An insight or workflow finding that may be stale.
  stale: boolean;
  // A gap that's been answered.
  resolved: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

export interface GraphFinding {
  id: string;
  kind: TeamRecordKind;
  kindLabel: string;
  text: string;
  href: string;
  at: string;
  stale: StaleView | null;
}

export interface ProductGraph {
  product: { id: string; name: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  // The product's insights and workflow findings, those that may be stale first, then the newest.
  findings: GraphFinding[];
  // How many of the product's findings may be stale, of how many in the window.
  staleCount: number;
  findingCount: number;
}

const answerLabel = (url: string | null): string => {
  if (!url) return "A note";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return "A link";
  }
};

// A product's graph from its approved work (pure, so the tests can pin it down): the product; its code areas, most
// worked on first (areas its summaries name, then the folders its sessions changed); and around them its newest
// insights and workflow findings (those that may be stale first), tickets and pull requests, the open gaps that come
// back most and the latest one answered. Each joins the areas it's about, else the product.
export function buildProductGraph(input: {
  product: { id: string; name: string };
  records: TeamRecord[];
  files: Map<string, string[]>;
  gapsBySession: Map<string, string[]>;
  gaps: Gap[];
  since: Date;
}): ProductGraph {
  const { product } = input;
  const approved = input.records.filter((r) => r.status === "approved");
  const facts = sessionFacts(approved, input.files, input.gapsBySession);
  const sessions = [...facts.values()].sort(
    (a, b) => b.at.getTime() - a.at.getTime() || a.sessionId.localeCompare(b.sessionId),
  );
  const stale = staleFrom(approved, input.files);

  const nodes: GraphNode[] = [
    {
      id: "product",
      kind: "product",
      label: product.name,
      title: `${product.name}: the product`,
      href: `/products/${encodeURIComponent(product.id)}`,
      external: false,
      stale: false,
      resolved: false,
    },
  ];
  const edges: GraphEdge[] = [];

  // Code areas, by how many sessions worked there, then the latest.
  const tally = new Map<string, { place: Place; sessions: number; latest: SessionFacts }>();
  for (const s of sessions)
    for (const place of s.places) {
      const key = `${place.kind}:${place.path}`;
      const entry = tally.get(key);
      if (entry) entry.sessions++;
      else tally.set(key, { place, sessions: 1, latest: s });
    }
  const byUse = (a: { sessions: number; latest: SessionFacts }, b: { sessions: number; latest: SessionFacts }) =>
    b.sessions - a.sessions || b.latest.at.getTime() - a.latest.at.getTime();
  const named = [...tally.values()].filter((t) => t.place.kind === "area").sort(byUse);
  const folders = [...tally.values()]
    .filter((t) => t.place.kind === "folder" && !named.some((a) => sharedPlace(a.place, t.place)))
    .sort(byUse);
  const areas = [...named, ...folders].slice(0, GRAPH_LIMITS.areas);
  areas.forEach((a, i) => {
    const id = `area:${i}`;
    nodes.push({
      id,
      kind: "area",
      label: a.place.label,
      title: `${a.place.kind === "area" ? "Code area" : "Folder"} ${a.place.label}: worked on in ${
        a.sessions === 1 ? "one session" : `${a.sessions} sessions`
      }, latest “${clip(a.latest.title, 80)}”`,
      href: sessionHref(a.latest.sessionId),
      external: false,
      stale: false,
      resolved: false,
    });
    edges.push({ from: "product", to: id, kind: "contains" });
  });

  // An outer node joins the areas its places are in (two at most), else the product.
  const attach = (id: string, places: Place[], kind: GraphEdgeKind) => {
    const hits = areas
      .map((a, i) => ({ i, hit: places.some((p) => sharedPlace(a.place, p, true)) }))
      .filter((h) => h.hit)
      .slice(0, 2);
    if (!hits.length) edges.push({ from: id, to: "product", kind });
    for (const h of hits) edges.push({ from: id, to: `area:${h.i}`, kind });
  };
  const placesOf = (sessionIds: Iterable<string>): Place[] =>
    [...new Set(sessionIds)].flatMap((id) => facts.get(id)?.places ?? []);

  // Insights and workflow findings: those that may be stale first, then the newest.
  const found = approved
    .filter((r) => FINDINGS.includes(r.kind))
    .sort(
      (a, b) =>
        Number(stale.has(b.id)) - Number(stale.has(a.id)) ||
        b.at.getTime() - a.at.getTime() ||
        a.id.localeCompare(b.id),
    );
  const findings: GraphFinding[] = found.slice(0, FINDINGS_LISTED).map((r) => {
    const flag = stale.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      kindLabel: KIND_LABELS[r.kind],
      text: r.text,
      href: sessionHref(r.sessionId, findingAnchor(r.kind)),
      at: r.at.toISOString(),
      stale: flag ? staleView(r, flag) : null,
    };
  });
  found.slice(0, GRAPH_LIMITS.findings).forEach((r, i) => {
    const id = `finding:${i}`;
    const flagged = stale.has(r.id);
    nodes.push({
      id,
      kind: r.kind === "workflow" ? "workflow" : "insight",
      label: r.text,
      title: `${KIND_LABELS[r.kind]}${flagged ? " that may be stale" : ""}: ${r.text}`,
      href: sessionHref(r.sessionId, findingAnchor(r.kind)),
      external: false,
      stale: flagged,
      resolved: false,
    });
    attach(id, placesOf([r.sessionId]), "about");
  });

  // Tickets and pull requests, the newest work first.
  const refs = new Map<string, { ref: RefLink; sessions: string[] }>();
  for (const s of sessions)
    for (const ref of s.refs) {
      const entry = refs.get(ref.key);
      if (entry) entry.sessions.push(s.sessionId);
      else refs.set(ref.key, { ref, sessions: [s.sessionId] });
    }
  const refNodes = (kind: "ticket" | "pr", max: number) =>
    [...refs.values()]
      .filter((r) => r.ref.kind === kind)
      .slice(0, max)
      .forEach(({ ref, sessions: ids }, i) => {
        const id = `${kind}:${i}`;
        const latest = ids[0] ?? "";
        nodes.push({
          id,
          kind,
          label: ref.label,
          title: `${kind === "ticket" ? "Ticket" : "Pull request"} ${ref.label}: worked on in ${
            ids.length === 1 ? "one session" : `${ids.length} sessions`
          }`,
          href: ref.url ?? sessionHref(latest),
          external: Boolean(ref.url),
          stale: false,
          resolved: false,
        });
        attach(id, placesOf(ids), kind === "ticket" ? "worked_on" : "changes");
      });
  refNodes("ticket", GRAPH_LIMITS.tickets);
  refNodes("pr", GRAPH_LIMITS.prs);

  // Open gaps that come back most (as listGaps ranks them), and the latest answered.
  const sessionsOfGap = new Map<string, string[]>();
  for (const s of sessions)
    for (const id of s.gapIds) sessionsOfGap.set(id, [...(sessionsOfGap.get(id) ?? []), s.sessionId]);
  const open = input.gaps.filter((g) => g.status === "open").slice(0, GRAPH_LIMITS.openGaps);
  const answered = input.gaps
    .filter((g) => g.status === "resolved" && g.resolution && g.resolution.at >= input.since)
    .sort((a, b) => (b.resolution?.at.getTime() ?? 0) - (a.resolution?.at.getTime() ?? 0))
    .slice(0, GRAPH_LIMITS.resolvedGaps);
  [...open, ...answered].forEach((gap, i) => {
    const id = `gap:${i}`;
    const resolved = gap.status === "resolved";
    nodes.push({
      id,
      kind: "gap",
      label: gap.text,
      title: `${resolved ? "Answered context gap" : "Open context gap"}: ${gap.text}`,
      href: `/gaps/${gap.id}`,
      external: false,
      stale: false,
      resolved,
    });
    attach(id, placesOf(sessionsOfGap.get(gap.id) ?? []), "about");
    if (resolved && gap.resolution) {
      const url = webUrl(gap.resolution.url);
      nodes.push({
        id: `answer:${i}`,
        kind: "answer",
        label: answerLabel(url),
        title: `What answered it: ${gap.resolution.note || url || "a note"}`,
        href: url ?? `/gaps/${gap.id}`,
        external: Boolean(url),
        stale: false,
        resolved: false,
      });
      edges.push({ from: id, to: `answer:${i}`, kind: "resolved_by" });
    }
  });

  return {
    product,
    nodes,
    edges,
    findings,
    staleCount: found.filter((r) => stale.has(r.id)).length,
    findingCount: found.length,
  };
}

// A product's graph, as the viewer may see it. Null when there's no such product for them.
export async function productGraph(
  productId: string,
  viewer: ViewerRef,
  options: { now?: Date } = {},
): Promise<ProductGraph | null> {
  const product = productId ? await getProduct(productId, viewer) : null;
  if (!product) return null;
  const since = new Date((options.now ?? new Date()).getTime() - GRAPH_DAYS * DAY_MS);
  const [records, gapList] = await Promise.all([
    recordsFor({ productId: product.id, since, limit: POOL_LIMIT }, viewer),
    listGaps({ productId: product.id }, viewer),
  ]);
  const sessionIds = [...new Set(records.map((r) => r.sessionId))];
  const [files, gapInfo] = await Promise.all([latestFiles(sessionIds), gapsOfSessions(sessionIds)]);
  return buildProductGraph({
    product: { id: product.id, name: product.name },
    records,
    files,
    gapsBySession: gapInfo.bySession,
    gaps: gapList,
    since,
  });
}
