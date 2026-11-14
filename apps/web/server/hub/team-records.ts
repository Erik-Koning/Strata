// The team read model: approved work from both write paths, read as one list (decision D3). The server-drafted
// `records` that their authors approved, and the latest approved revision of each plugin summary in
// `summary_revisions`, whose built line, decisions, open questions, insights, workflow notes, pain points and gaps each
// become one TeamRecord. The same line said twice in one session (once in each store) is shown once, the record's; and a
// session has one summary, the plugin's reviewed one when it has both (oneSummaryPerSession).
//
// Who sees what (access.ts): approved work is for everyone in the organisation who isn't suspended; a draft is its
// author's alone, and only a session's own page shows it to them. A suspended viewer reads nothing. Every function
// takes the viewer and checks it here. Names say who worked on something, never how much: nothing here counts, ranks
// or compares people.
import type { Ref } from "@strata/contracts";
import { type Filter, ObjectId } from "mongodb";
import { DEFAULT_ORG } from "../api-auth.ts";
import { events, type RecordDoc, records, type SummaryRevisionDoc, summaryRevisions } from "../collections.ts";
import { db } from "../db.ts";
import { type ProductIndex, productIndex } from "./products.ts";
import { reader, type ViewerRef, viewerIdOf } from "./reader.ts";
import { DAY_MS, dedupeWithinSession, normalizeRepo, weekStart } from "./text.ts";

export const TEAM_RECORD_KINDS = [
  "summary",
  "decision",
  "insight",
  "workflow",
  "pain_point",
  "context_gap",
  "open",
] as const;
export type TeamRecordKind = (typeof TEAM_RECORD_KINDS)[number];

export interface Person {
  id: string;
  name: string;
}

export interface TeamRecord {
  // A record's ObjectId as hex; a summary line's `s.<revision id>.<field>.<index>`.
  id: string;
  kind: TeamRecordKind;
  // Always "approved", except a viewer's own drafts on their own session's page.
  status: "approved" | "draft";
  // A summary's title; most findings have none.
  title: string | null;
  text: string;
  productId: string | null;
  // The normalized repository (github.com/acme/billing), the project as sent when it isn't one, or "".
  repo: string;
  sessionId: string;
  // Tickets and pull requests: a record's own, or a summary's Jira keys and PR.
  refs: Ref[];
  // The code areas the session's summary names; [] for a server record.
  areas: string[];
  // The files the session's summary lists (repository paths); missing for a server record.
  files?: string[];
  author: Person | null;
  // When it was shared: the record's approval, or the summary revision's.
  at: Date;
  source: "record" | "summary";
}

// A TeamRecord before its product and author's name are filled in.
export type RawTeamRecord = Omit<TeamRecord, "author" | "productId"> & {
  authorId: string;
  authorName: string | null;
};

// A summary's lists, and the kind each line becomes.
const SUMMARY_FIELDS = [
  ["decisions", "decision"],
  ["open", "open"],
  ["insights", "insight"],
  ["workflow", "workflow"],
  ["painPoints", "pain_point"],
  ["gaps", "context_gap"],
] as const;

export function summaryRefs(doc: Pick<SummaryRevisionDoc, "links">): Ref[] {
  const refs: Ref[] = (doc.links?.jira ?? []).map((id) => ({ type: "ticket", id, system: "jira" }));
  const pr = doc.links?.pr;
  if (pr?.url)
    refs.push({
      type: "pr",
      id: pr.number ? String(pr.number) : pr.url,
      url: pr.url,
      ...(/^https:\/\/github\.com\//.test(pr.url) ? { system: "github" } : {}),
      ...(pr.title ? { title: pr.title } : {}),
    });
  return refs;
}

export function fromRecord(doc: RecordDoc): RawTeamRecord {
  return {
    id: doc._id.toHexString(),
    kind: doc.kind,
    status: doc.status === "approved" ? "approved" : "draft",
    title: doc.title,
    text: doc.text,
    repo: normalizeRepo(doc.scope.project) ?? doc.scope.project,
    sessionId: doc.sessionID,
    refs: doc.refs ?? [],
    areas: [],
    authorId: doc.scope.user,
    authorName: null,
    at: doc.approvedAt ?? doc.updatedAt,
    source: "record",
  };
}

// One summary revision, as the lines it holds.
export function fromSummary(doc: SummaryRevisionDoc): RawTeamRecord[] {
  const base = {
    status: "approved" as const,
    repo: normalizeRepo(doc.repo?.remote) ?? "",
    sessionId: doc.sessionId,
    refs: summaryRefs(doc),
    areas: doc.summary?.areas ?? [],
    files: doc.files ?? [],
    authorId: doc.userId,
    authorName: doc.authorName,
    at: doc.review?.approvedAt ?? doc.updatedAt,
    source: "summary" as const,
  };
  const rev = doc._id?.toHexString() ?? `${doc.userId}.${doc.sessionId}.${doc.revision}`;
  const out: RawTeamRecord[] = [];
  const built = doc.summary?.built?.trim();
  if (built || doc.summary?.title?.trim())
    out.push({
      ...base,
      id: `s.${rev}.built.0`,
      kind: "summary",
      title: doc.summary.title?.trim() || null,
      text: built || doc.summary.title.trim(),
    });
  for (const [field, kind] of SUMMARY_FIELDS)
    (doc.summary?.[field] ?? []).forEach((line, i) => {
      if (line.trim()) out.push({ ...base, id: `s.${rev}.${field}.${i}`, kind, title: null, text: line.trim() });
    });
  return out;
}

const refKey = (ref: Ref): string => `${ref.type}\u001f${ref.id}`;

// One summary per session. A session can have a summary in both stores, worded differently: the server drafted one
// from its events and the engineer reviewed another in the plugin. The plugin's is kept, since its author wrote or
// checked it line by line; the drafted summary record goes, its tickets and pull requests carried over to the one
// kept, and its title when that has none. Every other finding of the session, from either store, is left for
// dedupeWithinSession, which drops only lines that say the same thing. A draft stays as it is: it's for its author to
// review, not shown to anyone else.
export function oneSummaryPerSession<T extends RawTeamRecord>(items: T[]): T[] {
  const reviewed = new Set(
    items
      .filter((r) => r.kind === "summary" && r.source === "summary" && r.status === "approved")
      .map((r) => r.sessionId),
  );
  if (!reviewed.size) return items;
  const isDropped = (r: T) =>
    r.kind === "summary" && r.source === "record" && r.status === "approved" && reviewed.has(r.sessionId);
  const dropped = new Map<string, T[]>();
  for (const r of items) if (isDropped(r)) dropped.set(r.sessionId, [...(dropped.get(r.sessionId) ?? []), r]);
  const merged = new Set<string>();
  return items.flatMap((r) => {
    if (isDropped(r)) return [];
    const others = dropped.get(r.sessionId);
    if (!others || r.kind !== "summary" || r.source !== "summary" || merged.has(r.sessionId)) return [r];
    merged.add(r.sessionId);
    const refs = [...r.refs];
    const seen = new Set(refs.map(refKey));
    for (const ref of others.flatMap((o) => o.refs))
      if (!seen.has(refKey(ref))) {
        seen.add(refKey(ref));
        refs.push(ref);
      }
    return [{ ...r, refs, title: r.title ?? others.find((o) => o.title)?.title ?? null }];
  });
}

// Names for the people these ids belong to, from their accounts.
export async function namesOf(ids: Iterable<string>): Promise<Map<string, string>> {
  const hex = [...new Set(ids)].filter((id) => /^[a-f0-9]{24}$/i.test(id));
  if (!hex.length) return new Map();
  const users = await db()
    .collection<{ _id: ObjectId; name?: unknown }>("user")
    .find({ _id: { $in: hex.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } })
    .toArray();
  return new Map(
    users
      .filter((u) => typeof u.name === "string" && u.name.trim())
      .map((u) => [u._id.toHexString(), String(u.name).trim()]),
  );
}

// The folder each session worked in, for repositories split into products by folder. Only the session's own
// events know it, and only for their 30 days; after that the session counts for the whole repository's product.
async function sessionFolders(pairs: { authorId: string; sessionId: string }[]): Promise<Map<string, string>> {
  if (!pairs.length) return new Map();
  const found = await events()
    .find(
      {
        "scope.user": { $in: [...new Set(pairs.map((p) => p.authorId))] },
        sessionID: { $in: [...new Set(pairs.map((p) => p.sessionId))] },
        kind: "session",
        "payload.git.path": { $type: "string" },
      },
      { projection: { "scope.user": 1, sessionID: 1, "payload.git.path": 1, ts: 1 } },
    )
    .sort({ ts: 1 })
    .toArray();
  const folders = new Map<string, string>();
  for (const event of found) {
    const git = event.payload.git as { path?: unknown } | undefined;
    if (typeof git?.path === "string") folders.set(`${event.scope.user}\u001f${event.sessionID}`, git.path);
  }
  return folders;
}

async function finish(raw: RawTeamRecord[], index: ProductIndex): Promise<TeamRecord[]> {
  const split = raw.filter((r) => r.repo && index.hasFolders(r.repo));
  const folders = await sessionFolders(split);
  const names = await namesOf(raw.map((r) => r.authorId));
  return raw.map(({ authorId, authorName, ...rest }) => {
    const name = names.get(authorId) ?? authorName;
    const folder = folders.get(`${authorId}\u001f${rest.sessionId}`) ?? "";
    return {
      ...rest,
      productId: rest.repo ? index.resolve(rest.repo, folder) : null,
      author: name ? { id: authorId, name } : null,
    };
  });
}

interface Query {
  productId?: string;
  since?: Date;
  until?: Date;
  sessionId?: string;
}

const LOAD_LIMIT = 5000;

// The latest approved summary of each session, newest first.
async function latestSummaries(query: Query): Promise<SummaryRevisionDoc[]> {
  const match: Filter<SummaryRevisionDoc> = {};
  if (query.since) match["review.approvedAt"] = { $gte: query.since };
  if (query.sessionId) match.sessionId = query.sessionId;
  return summaryRevisions()
    .aggregate<SummaryRevisionDoc>([
      { $match: match },
      { $sort: { revision: -1, updatedAt: -1 } },
      { $group: { _id: { userId: "$userId", sessionId: "$sessionId" }, doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
      { $sort: { "review.approvedAt": -1 } },
      { $limit: LOAD_LIMIT },
    ])
    .toArray();
}

// Approved work, as TeamRecords, newest first. Empty for a product that doesn't exist (after merges).
async function loadApproved(query: Query): Promise<TeamRecord[]> {
  const index = await productIndex();
  let productIds: Set<string> | null = null;
  let repos: string[] | null = null;
  if (query.productId) {
    const product = index.live(query.productId);
    if (!product) return [];
    productIds = new Set(index.aliases(product._id));
    repos = [...new Set(product.repos.map((r) => r.repo))];
  }
  const filter: Filter<RecordDoc> = { status: "approved", "scope.org": DEFAULT_ORG };
  if (query.since) filter.approvedAt = { $gte: query.since };
  if (query.sessionId) filter.sessionID = query.sessionId;
  if (repos) filter["scope.project"] = { $in: repos };
  const [recordDocs, summaryDocs] = await Promise.all([
    records().find(filter).sort({ approvedAt: -1 }).limit(LOAD_LIMIT).toArray(),
    latestSummaries(query),
  ]);
  const raw = [...recordDocs.map(fromRecord), ...summaryDocs.flatMap(fromSummary)].filter(
    (r) => (!repos || repos.includes(r.repo)) && (!query.until || r.at < query.until),
  );
  const all = await finish(dedupeWithinSession(oneSummaryPerSession(raw)), index);
  const wanted = productIds ? all.filter((r) => r.productId !== null && productIds.has(r.productId)) : all;
  return wanted.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export interface RecordsQuery {
  productId?: string;
  kind?: TeamRecordKind | TeamRecordKind[];
  since?: Date;
  until?: Date;
  limit?: number;
}

// Approved work, newest first: everything, or one product's, of some kinds, in a range.
export async function recordsFor(query: RecordsQuery, viewer: ViewerRef): Promise<TeamRecord[]> {
  if (!(await reader(viewer))) return [];
  const kinds = query.kind === undefined ? null : new Set(Array.isArray(query.kind) ? query.kind : [query.kind]);
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
  const all = await loadApproved(query);
  return all.filter((r) => !kinds || kinds.has(r.kind)).slice(0, limit);
}

export interface WeekOfWork {
  // Monday, 00:00 UTC.
  weekStart: Date;
  // The sessions' summaries shared that week, newest first.
  summaries: TeamRecord[];
  // Decisions, insights, workflow notes, pain points and gaps shared that week, newest first.
  findings: TeamRecord[];
}

// What's new: approved work since a date, by the week it was shared, newest week first. Open questions are in
// inProgress.
export async function whatsNew(
  query: { productId?: string; since: Date; until?: Date },
  viewer: ViewerRef,
): Promise<WeekOfWork[]> {
  if (!(await reader(viewer))) return [];
  const weeks = new Map<number, WeekOfWork>();
  for (const record of await loadApproved(query)) {
    if (record.kind === "open") continue;
    const start = weekStart(record.at);
    const week = weeks.get(start.getTime()) ?? { weekStart: start, summaries: [], findings: [] };
    (record.kind === "summary" ? week.summaries : week.findings).push(record);
    weeks.set(start.getTime(), week);
  }
  return [...weeks.values()].sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
}

export interface WorkInProgress {
  // The ticket's key, the pull request's URL, or the session's id: what the work is grouped by.
  key: string;
  kind: "ticket" | "pr" | "session";
  // The latest summary's title, else the ticket's key or the first line of the work.
  title: string;
  productId: string | null;
  repo: string;
  tickets: string[];
  pr: { id: string; url: string | null } | null;
  sessionIds: string[];
  // Who worked on it, by name, in alphabetical order.
  people: Person[];
  lastAt: Date;
  // The open questions its sessions left.
  open: TeamRecord[];
}

const DEFAULT_IN_PROGRESS_DAYS = 14;

// In progress: work shared recently, grouped by ticket (else pull request, else session), newest first, with the open
// questions it left; and every open question in the window. Whether a pull request has merged isn't known until PR
// lookups exist, so everything with recent activity counts as in progress.
export async function inProgress(
  query: { productId?: string; since?: Date },
  viewer: ViewerRef,
): Promise<{ work: WorkInProgress[]; open: TeamRecord[] }> {
  if (!(await reader(viewer))) return { work: [], open: [] };
  const since = query.since ?? new Date(Date.now() - DEFAULT_IN_PROGRESS_DAYS * DAY_MS);
  const all = await loadApproved({ productId: query.productId, since });

  const sessions = new Map<string, TeamRecord[]>();
  for (const record of all) sessions.set(record.sessionId, [...(sessions.get(record.sessionId) ?? []), record]);

  const groups = new Map<string, { kind: WorkInProgress["kind"]; items: TeamRecord[]; sessionIds: Set<string> }>();
  for (const [sessionId, items] of sessions) {
    const refs = items.flatMap((r) => r.refs);
    const ticket = refs.find((r) => r.type === "ticket");
    const pr = refs.find((r) => r.type === "pr");
    const [kind, key]: [WorkInProgress["kind"], string] = ticket
      ? ["ticket", ticket.id]
      : pr
        ? ["pr", typeof pr.url === "string" ? pr.url : pr.id]
        : ["session", sessionId];
    const group = groups.get(`${kind}\u001f${key}`) ?? { kind, items: [], sessionIds: new Set<string>() };
    group.items.push(...items);
    group.sessionIds.add(sessionId);
    groups.set(`${kind}\u001f${key}`, group);
  }

  const work: WorkInProgress[] = [...groups.entries()].map(([id, group]) => {
    const key = id.slice(id.indexOf("\u001f") + 1);
    const newest = [...group.items].sort((a, b) => b.at.getTime() - a.at.getTime());
    const summary = newest.find((r) => r.kind === "summary" && r.title);
    const refs = group.items.flatMap((r) => r.refs);
    const pr = refs.find((r) => r.type === "pr");
    const people = new Map(group.items.flatMap((r) => (r.author ? [[r.author.id, r.author] as const] : [])));
    const first = newest[0];
    return {
      key,
      kind: group.kind,
      title: summary?.title ?? (group.kind === "ticket" ? key : (first?.title ?? first?.text.slice(0, 100) ?? key)),
      productId: first?.productId ?? null,
      repo: first?.repo ?? "",
      tickets: [...new Set(refs.filter((r) => r.type === "ticket").map((r) => r.id))],
      pr: pr ? { id: pr.id, url: typeof pr.url === "string" ? pr.url : null } : null,
      sessionIds: [...group.sessionIds],
      people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
      lastAt: first?.at ?? since,
      open: newest.filter((r) => r.kind === "open"),
    };
  });
  work.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  return { work, open: all.filter((r) => r.kind === "open") };
}

export interface Contributors {
  // Who worked on the product recently, in alphabetical order.
  people: Person[];
  // The code areas its summaries name, most recently worked on first, each with who worked there.
  areas: { area: string; people: Person[]; lastAt: Date }[];
}

const DEFAULT_CONTRIBUTOR_DAYS = 90;

// Who has worked on a product recently, by name: never how much.
export async function contributorsFor(
  productId: string,
  viewer: ViewerRef,
  query: { since?: Date } = {},
): Promise<Contributors> {
  if (!(await reader(viewer))) return { people: [], areas: [] };
  const since = query.since ?? new Date(Date.now() - DEFAULT_CONTRIBUTOR_DAYS * DAY_MS);
  const all = await loadApproved({ productId, since });
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  const people = new Map<string, Person>();
  const areas = new Map<string, { area: string; people: Map<string, Person>; lastAt: Date }>();
  for (const record of all) {
    if (!record.author) continue;
    people.set(record.author.id, record.author);
    if (record.kind !== "summary") continue;
    for (const raw of record.areas) {
      const area = raw.trim();
      if (!area) continue;
      const entry = areas.get(area.toLowerCase()) ?? { area, people: new Map(), lastAt: record.at };
      entry.people.set(record.author.id, record.author);
      if (record.at > entry.lastAt) entry.lastAt = record.at;
      areas.set(area.toLowerCase(), entry);
    }
  }
  return {
    people: [...people.values()].sort(byName),
    areas: [...areas.values()]
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime() || a.area.localeCompare(b.area))
      .map((a) => ({ area: a.area, people: [...a.people.values()].sort(byName), lastAt: a.lastAt })),
  };
}

export interface SessionToolTime {
  class: string;
  runs: number;
  failures: number;
  totalMs: number;
}

export interface SessionDetail {
  sessionId: string;
  title: string | null;
  author: Person | null;
  // Whether the viewer is the session's author: then its drafts and its tool time are in here too.
  mine: boolean;
  productId: string | null;
  repo: string;
  branch: string | null;
  // The latest approval in it.
  at: Date;
  // The latest approved summary's own fields; its lines are also in records.
  summary: { built: string; why: string; decisions: string[]; areas: string[]; open: string[] } | null;
  tickets: string[];
  pr: { id: string; url: string | null; title: string | null } | null;
  refs: Ref[];
  files: string[];
  // Approved work from both stores, deduped, newest first; and the viewer's own drafts when it's theirs.
  records: TeamRecord[];
  // The author's own view only: the session's shell commands by class, from its events (30 days). Null for anyone else.
  tools: SessionToolTime[] | null;
}

// One session: its summary, its findings, its links. Null when the viewer may see nothing of it.
export async function sessionDetail(sessionId: string, viewer: ViewerRef): Promise<SessionDetail | null> {
  if (!sessionId || !(await reader(viewer))) return null;
  const viewerId = viewerIdOf(viewer);
  const [approvedDocs, draftDocs, summaryDocs, index] = await Promise.all([
    records()
      .find({ status: "approved", "scope.org": DEFAULT_ORG, sessionID: sessionId })
      .sort({ approvedAt: -1 })
      .limit(500)
      .toArray(),
    records()
      .find({ status: "draft", "scope.user": viewerId, sessionID: sessionId })
      .sort({ createdAt: 1 })
      .limit(500)
      .toArray(),
    latestSummaries({ sessionId }),
    productIndex(),
  ]);
  if (!approvedDocs.length && !draftDocs.length && !summaryDocs.length) return null;

  const summaryDoc = summaryDocs[0] ?? null;
  const raw = dedupeWithinSession(
    oneSummaryPerSession([
      ...approvedDocs.map(fromRecord),
      ...summaryDocs.flatMap(fromSummary),
      ...draftDocs.map(fromRecord),
    ]),
  );
  const items = (await finish(raw, index)).sort(
    (a, b) => Number(a.status === "draft") - Number(b.status === "draft") || b.at.getTime() - a.at.getTime(),
  );
  const authorId = summaryDoc?.userId ?? approvedDocs[0]?.scope.user ?? draftDocs[0]?.scope.user ?? "";
  const mine = authorId === viewerId;
  const author = items.find((r) => r.author?.id === authorId)?.author ?? null;
  const first = items.find((r) => r.source === "summary") ?? items[0];

  const refs: Ref[] = [];
  const seenRefs = new Set<string>();
  for (const ref of items.flatMap((r) => r.refs)) {
    const key = refKey(ref);
    if (seenRefs.has(key)) continue;
    seenRefs.add(key);
    refs.push(ref);
  }
  const pr = summaryDoc?.links?.pr ?? null;
  const prRef = refs.find((r) => r.type === "pr");

  return {
    sessionId,
    title: summaryDoc?.summary.title || items.find((r) => r.kind === "summary")?.title || null,
    author,
    mine,
    productId: first?.productId ?? null,
    repo: first?.repo ?? "",
    branch: summaryDoc?.repo?.branch || null,
    at: new Date(Math.max(0, ...items.map((r) => r.at.getTime()))),
    summary: summaryDoc
      ? {
          built: summaryDoc.summary.built,
          why: summaryDoc.summary.why,
          decisions: summaryDoc.summary.decisions,
          areas: summaryDoc.summary.areas,
          open: summaryDoc.summary.open,
        }
      : null,
    tickets: [...new Set(refs.filter((r) => r.type === "ticket").map((r) => r.id))],
    pr: pr
      ? { id: pr.number ? String(pr.number) : pr.url, url: pr.url, title: pr.title ?? null }
      : prRef
        ? { id: prRef.id, url: typeof prRef.url === "string" ? prRef.url : null, title: null }
        : null,
    refs,
    files: summaryDoc?.files ?? [],
    records: items,
    tools: mine ? await sessionTools(viewerId, sessionId) : null,
  };
}

// The author's own session's shell commands, by class.
async function sessionTools(userId: string, sessionId: string): Promise<SessionToolTime[]> {
  const rows = await events()
    .aggregate<SessionToolTime>([
      {
        $match: {
          "scope.user": userId,
          sessionID: sessionId,
          kind: "tool",
          "payload.command.class": { $exists: true },
        },
      },
      {
        $group: {
          _id: "$payload.command.class",
          runs: { $sum: 1 },
          failures: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $in: ["$payload.status", ["error", "interrupted"]] },
                    { $gt: [{ $ifNull: ["$payload.command.exit", 0] }, 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalMs: {
            $sum: { $cond: [{ $eq: ["$payload.command.background", true] }, 0, { $ifNull: ["$payload.ms", 0] }] },
          },
        },
      },
      { $project: { _id: 0, class: "$_id", runs: 1, failures: 1, totalMs: 1 } },
      { $sort: { totalMs: -1 } },
    ])
    .toArray();
  return rows;
}
