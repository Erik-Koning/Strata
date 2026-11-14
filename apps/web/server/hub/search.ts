// Search over approved work (docs/hub-build-plan.md, D5 and F1 item 9): what Ask Strata looks things up with.
//
// team_search holds one document per approved TeamRecord, its id the read model's, never a draft. indexSessions
// rewrites a session's documents from the two stores whenever its approved work changes (a record approved, edited or
// discarded, a summary stored or retracted, and hub:backfill): what's approved is written, what no longer is goes.
// Two Atlas Search indexes sit on it, made by `pnpm db:indexes` only (indexes.ts): team_search_semantic, whose
// embeddings Atlas makes itself with voyage-4, and team_search_text, full text. searchTeam runs both and merges them
// with $rankFusion. Until both are there it ranks with a plain text index, and until anything has been copied in at all
// (before the first sync or backfill) it reads the read model and matches words.
//
// What a viewer finds is what the read model would show them: a suspended viewer finds nothing, and every hit is
// checked against the stores before it's returned, so work taken back since the last sync is never a source.
import type { Ref } from "@strata/contracts";
import { type AnyBulkWriteOperation, ObjectId } from "mongodb";
import { DEFAULT_ORG } from "../api-auth.ts";
import { events, records, type SummaryRevisionDoc, summaryRevisions } from "../collections.ts";
import { db } from "../db.ts";
import { TEAM_SEARCH, TEAM_SEARCH_SEMANTIC, TEAM_SEARCH_TEXT } from "../indexes.ts";
import { type ProductIndex, productIndex } from "./products.ts";
import { reader, type ViewerRef } from "./reader.ts";
import {
  fromRecord,
  fromSummary,
  namesOf,
  type RawTeamRecord,
  recordsFor,
  type SessionDetail,
  sessionDetail,
  type TeamRecord,
  type TeamRecordKind,
} from "./team-records.ts";
import { dedupeWithinSession } from "./text.ts";

export interface TeamSearchDoc {
  // The TeamRecord's id: a record's ObjectId as hex, a summary line's s.<revision>.<field>.<index>.
  _id: string;
  org: string;
  kind: TeamRecordKind;
  productId: string | null;
  repo: string;
  sessionId: string;
  title: string | null;
  // What the semantic index embeds.
  text: string;
  at: Date;
  source: "record" | "summary";
  refs: Ref[];
  areas: string[];
  // The author's account, and the name a summary was sent with; the name shown is looked up when it's read.
  authorId: string;
  authorName: string | null;
}

export const teamSearch = () => db().collection<TeamSearchDoc>(TEAM_SEARCH);

// A TeamRecord's id, as the read model writes it.
export const TEAM_RECORD_ID = /^(?:[a-f0-9]{24}|s\.[a-f0-9]{24}\.[A-Za-z]{1,20}\.\d{1,4})$/;
const HEX = /^[a-f0-9]{24}$/;

// ---------- Words ----------

const STOP = new Set(
  (
    "a an and are as at be been but by do does did for from has have i im in is it its me my of on or our so that the " +
    "this to was we were will with you your they them their there here not no can could should would how what why " +
    "where when which who whom whose about any some get got way ive weve dont isnt"
  ).split(" "),
);

// Rough, and the same for the question and the records: retry, retries, retried and retrying are one word.
export function stem(word: string): string {
  if (word.length <= 4) return word;
  if (/ie[sd]$/.test(word)) return `${word.slice(0, -3)}y`;
  return word.replace(/(?:ments?|ings?|ions?|ers?|ed|es|s)$/, "");
}

// The words of a text, as they're compared: lower case, without small words.
export function wordsOf(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/'/g, "")
      .match(/[\p{L}\p{N}][\p{L}\p{N}_]*/gu) ?? []
  ).filter((w) => w.length > 1 && !STOP.has(w));
}

export const termsOf = (text: string): Set<string> => new Set(wordsOf(text).map(stem));

// ---------- Keeping team_search in line with approved work ----------

// The latest approved revision of each (author, session) among these sessions: every stored revision is approved.
function latestSummaries(sessionIds: string[]): Promise<SummaryRevisionDoc[]> {
  return summaryRevisions()
    .aggregate<SummaryRevisionDoc>([
      { $match: { sessionId: { $in: sessionIds } } },
      { $sort: { revision: -1, updatedAt: -1 } },
      { $group: { _id: { userId: "$userId", sessionId: "$sessionId" }, doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ])
    .toArray();
}

// The folder each session worked in, for repositories split into products by folder (as the read model works it out:
// from the session's own events, while they're kept).
async function foldersOf(raw: RawTeamRecord[], index: ProductIndex): Promise<Map<string, string>> {
  const split = raw.filter((r) => r.repo && index.hasFolders(r.repo));
  if (!split.length) return new Map();
  const found = await events()
    .find(
      {
        "scope.user": { $in: [...new Set(split.map((r) => r.authorId))] },
        sessionID: { $in: [...new Set(split.map((r) => r.sessionId))] },
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

function searchDoc(r: RawTeamRecord, index: ProductIndex, folders: Map<string, string>): TeamSearchDoc {
  const folder = folders.get(`${r.authorId}\u001f${r.sessionId}`) ?? "";
  return {
    _id: r.id,
    org: DEFAULT_ORG,
    kind: r.kind,
    productId: r.repo ? index.resolve(r.repo, folder) : null,
    repo: r.repo,
    sessionId: r.sessionId,
    title: r.title,
    text: r.text,
    at: r.at,
    source: r.source,
    refs: r.refs,
    areas: r.areas,
    authorId: r.authorId,
    authorName: r.authorName,
  };
}

// What a document says, to tell whether it changed: an unchanged one isn't written again (each write is embedded again).
const fingerprint = (d: TeamSearchDoc): string =>
  JSON.stringify([
    d.org,
    d.kind,
    d.productId,
    d.repo,
    d.sessionId,
    d.title,
    d.text,
    new Date(d.at).getTime(),
    d.source,
    d.refs ?? [],
    d.areas ?? [],
    d.authorId,
    d.authorName,
  ]);

const BATCH = 200;

// Rewrites these sessions' documents from the stores: what's approved now is written (unless it's there already, the
// same), what isn't any more is deleted. Idempotent.
export async function indexSessions(
  sessionIds: Iterable<string>,
): Promise<{ sessions: number; written: number; removed: number }> {
  const ids = [...new Set([...sessionIds].filter((id) => typeof id === "string" && id))];
  let written = 0;
  let removed = 0;
  if (!ids.length) return { sessions: 0, written, removed };
  const index = await productIndex();
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const [recordDocs, summaryDocs, existing] = await Promise.all([
      records()
        .find({ status: "approved", "scope.org": DEFAULT_ORG, sessionID: { $in: batch } })
        .sort({ approvedAt: -1 })
        .toArray(),
      latestSummaries(batch),
      teamSearch()
        .find({ sessionId: { $in: batch } })
        .toArray(),
    ]);
    // The read model's own rule: a line said in both stores is the record's.
    const raw = dedupeWithinSession([...recordDocs.map(fromRecord), ...summaryDocs.flatMap(fromSummary)]);
    const folders = await foldersOf(raw, index);
    const docs = raw.map((r) => searchDoc(r, index, folders));
    const before = new Map(existing.map((d) => [d._id, fingerprint(d)]));
    const keep = new Set(docs.map((d) => d._id));
    const ops: AnyBulkWriteOperation<TeamSearchDoc>[] = docs
      .filter((d) => before.get(d._id) !== fingerprint(d))
      .map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }));
    const gone = existing.filter((d) => !keep.has(d._id)).map((d) => d._id);
    if (gone.length) ops.push({ deleteMany: { filter: { _id: { $in: gone } } } });
    if (ops.length) await teamSearch().bulkWrite(ops, { ordered: false });
    written += ops.length - (gone.length ? 1 : 0);
    removed += gone.length;
  }
  return { sessions: ids.length, written, removed };
}

// Every session with approved work, and every session copied before (whose work may have gone since): hub:backfill.
export async function indexAllSessions(): Promise<{ sessions: number; written: number; removed: number }> {
  const [fromRecords, fromSummaries, copied] = await Promise.all([
    records().distinct("sessionID", { status: "approved", "scope.org": DEFAULT_ORG }),
    summaryRevisions().distinct("sessionId"),
    teamSearch().distinct("sessionId"),
  ]);
  return indexSessions([...fromRecords, ...fromSummaries, ...copied].filter((s): s is string => typeof s === "string"));
}

// The sync after a change, in the background: one run at a time, and the sessions changed meanwhile go into the next.
// A failure is only logged; the change stands, and the next sync or the backfill catches up.
let running: Promise<void> | null = null;
const waiting = new Set<string>();

export function indexSessionsLater(sessionIds: Iterable<string>): void {
  for (const id of sessionIds) if (typeof id === "string" && id) waiting.add(id);
  if (running || !waiting.size) return;
  running = (async () => {
    while (waiting.size) {
      const batch = [...waiting];
      waiting.clear();
      try {
        await indexSessions(batch);
      } catch (error) {
        console.error("hub: copying approved work for search failed", error);
      }
    }
  })().finally(() => {
    running = null;
    // Sessions that came in as the last run was finishing.
    if (waiting.size) indexSessionsLater([]);
  });
}

// Resolves once the background syncs, including any asked for meanwhile, have finished: for tests, and a clean shutdown.
export async function searchSyncPending(): Promise<void> {
  while (running) await running;
}

// ---------- Searching ----------

export interface TeamSearchQuery {
  query: string;
  kind?: TeamRecordKind | TeamRecordKind[] | null;
  productId?: string | null;
  since?: Date | null;
  limit?: number;
}

// hybrid: $rankFusion over the semantic and full-text indexes; text: the plain text index; words: the read model,
// matched word by word (nothing copied yet).
export type SearchHow = "hybrid" | "text" | "words";

export interface TeamSearchResult {
  records: TeamRecord[];
  how: SearchHow;
}

// How many results may come from one session, so one long session doesn't fill the answer.
const PER_SESSION = 3;
const MAX_LIMIT = 25;

function spread(sorted: TeamRecord[], limit: number): TeamRecord[] {
  const perSession = new Map<string, number>();
  const out: TeamRecord[] = [];
  for (const record of sorted) {
    if (out.length >= limit) break;
    const seen = perSession.get(record.sessionId) ?? 0;
    if (seen >= PER_SESSION) continue;
    perSession.set(record.sessionId, seen + 1);
    out.push(record);
  }
  return out;
}

// Whether both Atlas Search indexes are there and answering. Asked at most once a minute: a missing index doesn't fail
// a query, it finds nothing, so this is how the fallback knows.
let indexesSeen: { at: number; ready: boolean } | null = null;
const INDEXES_CHECK_MS = 60_000;

async function searchIndexesReady(): Promise<boolean> {
  if (indexesSeen && Date.now() - indexesSeen.at < INDEXES_CHECK_MS) return indexesSeen.ready;
  let ready = false;
  try {
    const found = (await teamSearch().listSearchIndexes().toArray()) as { name?: string; queryable?: boolean }[];
    ready = [TEAM_SEARCH_SEMANTIC, TEAM_SEARCH_TEXT].every((name) =>
      found.some((f) => f.name === name && f.queryable === true),
    );
  } catch {
    ready = false;
  }
  indexesSeen = { at: Date.now(), ready };
  return ready;
}

interface Narrowing {
  kinds: TeamRecordKind[] | null;
  productIds: string[] | null;
  since: Date | null;
}

function hybrid(query: string, narrow: Narrowing, want: number): Promise<TeamSearchDoc[]> {
  const filter: Record<string, unknown> = { org: DEFAULT_ORG };
  if (narrow.kinds) filter.kind = { $in: narrow.kinds };
  if (narrow.productIds) filter.productId = { $in: narrow.productIds };
  if (narrow.since) filter.at = { $gte: narrow.since };
  const within: Record<string, unknown>[] = [{ equals: { path: "org", value: DEFAULT_ORG } }];
  if (narrow.kinds) within.push({ in: { path: "kind", value: narrow.kinds } });
  if (narrow.productIds) within.push({ in: { path: "productId", value: narrow.productIds } });
  if (narrow.since) within.push({ range: { path: "at", gte: narrow.since } });
  return teamSearch()
    .aggregate<TeamSearchDoc>([
      {
        $rankFusion: {
          input: {
            pipelines: {
              meaning: [
                {
                  $vectorSearch: {
                    index: TEAM_SEARCH_SEMANTIC,
                    path: "text",
                    query: { text: query },
                    numCandidates: Math.min(want * 20, 1000),
                    limit: want,
                    filter,
                  },
                },
              ],
              words: [
                {
                  $search: {
                    index: TEAM_SEARCH_TEXT,
                    compound: { must: [{ text: { query, path: ["title", "text"] } }], filter: within },
                  },
                },
                { $limit: want },
              ],
            },
          },
        },
      },
      { $limit: want },
    ])
    .toArray();
}

async function textOnly(query: string, narrow: Narrowing, want: number): Promise<TeamSearchDoc[]> {
  const words = [...new Set(wordsOf(query))].slice(0, 30).join(" ");
  if (!words) return [];
  const filter: Record<string, unknown> = { $text: { $search: words }, org: DEFAULT_ORG };
  if (narrow.kinds) filter.kind = { $in: narrow.kinds };
  if (narrow.productIds) filter.productId = { $in: narrow.productIds };
  if (narrow.since) filter.at = { $gte: narrow.since };
  const score = { score: { $meta: "textScore" } } as const;
  return teamSearch().find(filter).project<TeamSearchDoc>(score).sort(score).limit(want).toArray();
}

// Nothing copied yet: the newest approved work, ranked by the share of the question's words it has.
async function byWords(query: string, narrow: Narrowing, viewer: ViewerRef, limit: number): Promise<TeamRecord[]> {
  const asked = termsOf(query);
  if (!asked.size) return [];
  const universe = await recordsFor(
    {
      productId: narrow.productIds?.[0],
      kind: narrow.kinds ?? undefined,
      since: narrow.since ?? undefined,
      limit: 1000,
    },
    viewer,
  );
  const scored = universe
    .filter((r) => r.status === "approved")
    .map((record) => {
      const said = termsOf([record.title ?? "", record.text, record.areas.join(" ")].join(" "));
      return { record, score: [...asked].filter((w) => said.has(w)).length / asked.size };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.record.at.getTime() - a.record.at.getTime());
  return spread(
    scored.map((s) => s.record),
    limit,
  );
}

const revisionOf = (id: string): string | null => (id.startsWith("s.") ? (id.split(".")[1] ?? null) : null);

// The documents whose work is still approved as it was copied: a record still approved with the same words, a summary
// line from its session's latest revision.
async function stillApproved(docs: TeamSearchDoc[]): Promise<Set<string>> {
  const recordIds = docs.filter((d) => d.source === "record" && HEX.test(d._id)).map((d) => new ObjectId(d._id));
  const revisionIds = [
    ...new Set(docs.map((d) => revisionOf(d._id)).filter((id): id is string => Boolean(id && HEX.test(id)))),
  ].map((id) => new ObjectId(id));
  const [approved, revisions] = await Promise.all([
    recordIds.length
      ? records()
          .find(
            { _id: { $in: recordIds }, status: "approved", "scope.org": DEFAULT_ORG },
            { projection: { text: 1, title: 1 } },
          )
          .toArray()
      : [],
    revisionIds.length
      ? summaryRevisions()
          .find({ _id: { $in: revisionIds } }, { projection: { userId: 1, sessionId: 1, revision: 1 } })
          .toArray()
      : [],
  ]);
  const latest = revisions.length
    ? await summaryRevisions()
        .aggregate<{ _id: { userId: string; sessionId: string }; top: number }>([
          { $match: { $or: revisions.map((r) => ({ userId: r.userId, sessionId: r.sessionId })) } },
          { $group: { _id: { userId: "$userId", sessionId: "$sessionId" }, top: { $max: "$revision" } } },
        ])
        .toArray()
    : [];
  const top = new Map(latest.map((l) => [`${l._id.userId}\u001f${l._id.sessionId}`, l.top]));
  const liveRevisions = new Set(
    revisions
      .filter((r) => top.get(`${r.userId}\u001f${r.sessionId}`) === r.revision)
      .map((r) => r._id?.toHexString() ?? ""),
  );
  const words = new Map(approved.map((r) => [r._id.toHexString(), r.text]));
  return new Set(
    docs
      .filter((d) =>
        d.source === "record" ? words.get(d._id) === d.text : liveRevisions.has(revisionOf(d._id) ?? ""),
      )
      .map((d) => d._id),
  );
}

// Search documents as TeamRecords, dropping any whose work isn't approved as it was any more. Names and products are
// read now, so a rename or a merge shows at once.
async function hydrate(docs: TeamSearchDoc[]): Promise<TeamRecord[]> {
  if (!docs.length) return [];
  const live = await stillApproved(docs);
  const kept = docs.filter((d) => live.has(d._id));
  const [names, index] = await Promise.all([namesOf(kept.map((d) => d.authorId)), productIndex()]);
  return kept.map((d) => {
    const name = names.get(d.authorId) ?? d.authorName;
    return {
      id: d._id,
      kind: d.kind,
      status: "approved",
      title: d.title ?? null,
      text: d.text,
      productId: d.productId ? (index.live(d.productId)?._id ?? null) : null,
      repo: d.repo,
      sessionId: d.sessionId,
      refs: d.refs ?? [],
      areas: d.areas ?? [],
      author: name ? { id: d.authorId, name } : null,
      at: new Date(d.at),
      source: d.source,
    };
  });
}

// Approved work that answers a question, best first, no more than three from one session. A suspended viewer, an empty
// question or a product that isn't listed finds nothing.
export async function searchTeam(viewer: ViewerRef, q: TeamSearchQuery): Promise<TeamSearchResult> {
  const limit = Math.min(Math.max(Math.round(q.limit ?? 8), 1), MAX_LIMIT);
  const query = q.query.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!query || !(await reader(viewer))) return { records: [], how: "hybrid" };
  const narrow: Narrowing = {
    kinds: q.kind ? (Array.isArray(q.kind) ? q.kind : [q.kind]) : null,
    productIds: null,
    since: q.since ?? null,
  };
  if (q.productId) {
    const ids = (await productIndex()).aliases(q.productId);
    if (!ids.length) return { records: [], how: "hybrid" };
    narrow.productIds = ids;
  }
  if (!(await teamSearch().findOne({ org: DEFAULT_ORG }, { projection: { _id: 1 } })))
    return { records: await byWords(query, narrow, viewer, limit), how: "words" };
  // More than asked for: some may be dropped as no longer approved, or as a fourth from one session.
  const want = Math.min(limit * 3, 75);
  let how: SearchHow = "text";
  let docs: TeamSearchDoc[];
  try {
    if (await searchIndexesReady()) {
      docs = await hybrid(query, narrow, want);
      how = "hybrid";
    } else docs = await textOnly(query, narrow, want);
  } catch {
    try {
      docs = await textOnly(query, narrow, want);
      how = "text";
    } catch {
      return { records: await byWords(query, narrow, viewer, limit), how: "words" };
    }
  }
  return { records: spread(await hydrate(docs), limit), how };
}

// ---------- One record, one session ----------

// The session a record belongs to: from its copy, or from the store it came from when it isn't copied yet.
async function sessionOf(id: string): Promise<string | null> {
  const copied = await teamSearch().findOne({ _id: id }, { projection: { sessionId: 1 } });
  if (copied) return copied.sessionId;
  if (HEX.test(id)) {
    const doc = await records().findOne(
      { _id: new ObjectId(id), status: "approved", "scope.org": DEFAULT_ORG },
      { projection: { sessionID: 1 } },
    );
    return doc?.sessionID ?? null;
  }
  const revision = revisionOf(id);
  if (!revision || !HEX.test(revision)) return null;
  const doc = await summaryRevisions().findOne({ _id: new ObjectId(revision) }, { projection: { sessionId: 1 } });
  return doc?.sessionId ?? null;
}

// A session as anyone in the organisation sees it: its approved work only. Even its author's drafts and tool time stay
// out, so nothing read through here can make a draft a source.
export function approvedSession(session: SessionDetail): SessionDetail {
  return { ...session, mine: false, records: session.records.filter((r) => r.status === "approved"), tools: null };
}

// One session's approved work, as the read model gives it to this viewer. Null when there's none they may see.
export async function teamSession(sessionId: string, viewer: ViewerRef): Promise<SessionDetail | null> {
  if (!sessionId || sessionId.length > 200) return null;
  const session = await sessionDetail(sessionId, viewer);
  if (!session) return null;
  const shared = approvedSession(session);
  return shared.records.length ? shared : null;
}

// One approved record, and the session it came from. Null when it isn't there, isn't approved, or the viewer may not
// read the team's work.
export async function teamRecord(
  id: string,
  viewer: ViewerRef,
): Promise<{ record: TeamRecord; session: SessionDetail } | null> {
  if (!TEAM_RECORD_ID.test(id) || !(await reader(viewer))) return null;
  const sessionId = await sessionOf(id);
  const session = sessionId ? await teamSession(sessionId, viewer) : null;
  const record = session?.records.find((r) => r.id === id);
  return session && record ? { record, session } : null;
}
