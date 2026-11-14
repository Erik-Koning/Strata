// Context gaps across sessions: what agents and people needed and couldn't find, one document per gap (the same
// normalized text in the same product), with how often it came back, who owns it and what answered it. Fed by approved
// context_gap records and the gap lines of approved summaries (syncGaps, which reconciles against them and is safe to
// run any time), and by questions Ask Strata couldn't answer (recordAskGap). Every write goes through this module.
//
// Each time a gap came up is an occurrence: once per coding session (a record and a summary line saying the same thing
// in one session are one), and once per unanswered question. The counts are worked out from the occurrences on every
// write. They count sessions and questions, never people; who asked a question isn't kept.
import { redact } from "@strata/contracts";
import { type AnyBulkWriteOperation, type Document, MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";
import { DEFAULT_ORG } from "../api-auth.ts";
import { audit } from "../audit.ts";
import {
  type GapDoc,
  type GapOccurrence,
  gaps,
  records,
  type SummaryRevisionDoc,
  summaryRevisions,
} from "../collections.ts";
import { Refusal } from "../people.ts";
import { ensureProductsFor, productIndex } from "./products.ts";
import { reader, type ViewerRef, viewerIdOf, writer } from "./reader.ts";
import { namesOf, type Person } from "./team-records.ts";
import { normalizeRepo, normalizeText, textKey } from "./text.ts";

export const gapKeyOf = (productId: string | null, text: string): string =>
  textKey(productId ?? "", normalizeText(text));

const cleanText = (text: string, max: number): string => redact(text).replace(/\s+/g, " ").trim().slice(0, max);

// The counts, from the occurrences, in the same update that changed them.
const DERIVE: Document = {
  $set: {
    firstSeen: { $min: "$occurrences.at" },
    lastSeen: { $max: "$occurrences.at" },
    sessions: {
      $size: { $setUnion: [{ $filter: { input: "$occurrences.sessionId", cond: { $ne: ["$$this", null] } } }] },
    },
    fromAgents: { $size: { $filter: { input: "$occurrences", cond: { $eq: ["$$this.from", "agent"] } } } },
    fromPeople: { $size: { $filter: { input: "$occurrences", cond: { $eq: ["$$this.from", "person"] } } } },
    sourceIds: "$occurrences.sourceId",
  },
};

const ofKind = (from: GapOccurrence["from"]): Document => ({
  $filter: { input: { $ifNull: ["$occurrences", []] }, cond: { $eq: ["$$this.from", from] } },
});

// An update that sets a gap's occurrences (and, on a new gap, everything else). Values from people go in as literals,
// so a "$" in a gap's text is text.
function upsertGap(fields: { text: string; productId: string | null; now: Date }, occurrences: Document): Document[] {
  return [
    {
      $set: {
        text: { $ifNull: ["$text", { $literal: fields.text }] },
        productId: { $ifNull: ["$productId", { $literal: fields.productId }] },
        status: { $ifNull: ["$status", "open"] },
        ownerId: { $ifNull: ["$ownerId", null] },
        resolution: { $ifNull: ["$resolution", null] },
        createdAt: { $ifNull: ["$createdAt", fields.now] },
        updatedAt: fields.now,
        occurrences,
      },
    },
    DERIVE,
  ];
}

const isDuplicate = (error: unknown): boolean => error instanceof MongoServerError && error.code === 11000;

// The gaps approved work names right now, keyed as gaps are, each with its occurrences: one per session.
async function expectedGaps(): Promise<
  Map<string, { text: string; productId: string | null; occurrences: GapOccurrence[] }>
> {
  const [recordDocs, summaryDocs] = await Promise.all([
    records()
      .find(
        { status: "approved", "scope.org": DEFAULT_ORG, kind: "context_gap" },
        { projection: { text: 1, "scope.project": 1, sessionID: 1, approvedAt: 1, updatedAt: 1 } },
      )
      .toArray(),
    summaryRevisions()
      .aggregate<SummaryRevisionDoc>([
        { $sort: { revision: -1, updatedAt: -1 } },
        { $group: { _id: { userId: "$userId", sessionId: "$sessionId" }, doc: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$doc" } },
        { $match: { "summary.gaps.0": { $exists: true } } },
      ])
      .toArray(),
  ]);
  const found = [
    ...recordDocs.map((doc) => ({
      text: doc.text,
      repo: normalizeRepo(doc.scope.project),
      sessionId: doc.sessionID,
      at: doc.approvedAt ?? doc.updatedAt,
    })),
    ...summaryDocs.flatMap((doc) =>
      doc.summary.gaps.map((text) => ({
        text,
        repo: normalizeRepo(doc.repo?.remote),
        sessionId: doc.sessionId,
        at: doc.review?.approvedAt ?? doc.updatedAt,
      })),
    ),
  ].filter((f) => normalizeText(f.text));
  await ensureProductsFor(found.map((f) => f.repo));
  const index = await productIndex();

  const expected = new Map<string, { text: string; productId: string | null; occurrences: GapOccurrence[] }>();
  for (const f of found.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const productId = f.repo ? index.resolve(f.repo, "") : null;
    const key = gapKeyOf(productId, f.text);
    const gap = expected.get(key) ?? { text: cleanText(f.text, 400), productId, occurrences: [] };
    const sourceId = `session:${f.sessionId}`;
    if (!gap.occurrences.some((o) => o.sourceId === sourceId))
      gap.occurrences.push({ sourceId, from: "agent", sessionId: f.sessionId, at: f.at });
    expected.set(key, gap);
  }
  return expected;
}

const sameOccurrences = (a: GapOccurrence[], b: GapOccurrence[]): boolean => {
  const key = (o: GapOccurrence) => `${o.sourceId}\u001f${o.sessionId ?? ""}\u001f${new Date(o.at).getTime()}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.length === right.length && left.every((k, i) => k === right[i]);
};

// Brings gaps in line with approved work: a new gap for each one first named, occurrences added for each session that
// named one again, and taken away when the work behind them is no longer approved. Questions people asked are kept as
// they are. A gap left with no occurrence, no owner and no resolution goes. Idempotent: a second run changes nothing.
export async function syncGaps(): Promise<{ gaps: number; created: number; updated: number; removed: number }> {
  const expected = await expectedGaps();
  const existing = new Map(
    (
      await gaps()
        .find({}, { projection: { key: 1, occurrences: 1 } })
        .toArray()
    ).map((g) => [g.key, g]),
  );
  const now = new Date();
  const ops: AnyBulkWriteOperation<GapDoc>[] = [];
  let created = 0;
  for (const [key, gap] of expected) {
    const before = existing.get(key);
    const agents = (before?.occurrences ?? []).filter((o) => o.from === "agent");
    if (before && sameOccurrences(agents, gap.occurrences)) continue;
    if (!before) created++;
    ops.push({
      updateOne: {
        filter: { key },
        update: upsertGap(
          { text: gap.text, productId: gap.productId, now },
          { $concatArrays: [{ $literal: gap.occurrences }, ofKind("person")] },
        ),
        upsert: true,
      },
    });
  }
  const stale = [...existing.values()].filter(
    (g) => !expected.has(g.key) && g.occurrences?.some((o) => o.from === "agent"),
  );
  for (const gap of stale)
    ops.push({
      updateOne: {
        filter: { _id: gap._id },
        update: [{ $set: { occurrences: ofKind("person"), updatedAt: now } }, DERIVE],
      },
    });
  if (ops.length) await gaps().bulkWrite(ops, { ordered: false });
  const removed = stale.length
    ? (
        await gaps().deleteMany({
          _id: { $in: stale.map((g) => g._id) },
          occurrences: { $size: 0 },
          ownerId: null,
          resolution: null,
        })
      ).deletedCount
    : 0;
  return { gaps: expected.size, created, updated: ops.length - created, removed };
}

const AskInput = z.object({
  question: z.string().trim().min(1).max(4000),
  productId: z.string().max(120).nullable().optional(),
  gapId: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .optional(),
});

// A question Ask Strata couldn't answer: it opens a gap for that product, or counts toward the one with the same text
// (or the one named, when Ask matched it to an open gap). Who asked isn't kept.
export async function recordAskGap(
  question: string,
  productId?: string | null,
  options: { gapId?: string } = {},
): Promise<{ id: string; created: boolean }> {
  const parsed = AskInput.safeParse({ question, productId, gapId: options.gapId });
  if (!parsed.success) throw new Refusal("That question can't be kept as a gap.");
  const input = parsed.data;
  const text = cleanText(input.question, 400);
  if (!normalizeText(text)) throw new Refusal("There's no question to keep.");
  const index = await productIndex();
  const product = input.productId ? (index.live(input.productId)?._id ?? null) : null;
  const now = new Date();
  const occurrence: GapOccurrence = {
    sourceId: `ask:${new ObjectId().toHexString()}`,
    from: "person",
    sessionId: null,
    at: now,
  };
  const update = upsertGap(
    { text, productId: product, now },
    { $concatArrays: [{ $ifNull: ["$occurrences", []] }, { $literal: [occurrence] }] },
  );
  if (input.gapId) {
    const result = await gaps().findOneAndUpdate({ _id: new ObjectId(input.gapId) }, update, {
      returnDocument: "after",
    });
    if (result) return { id: result._id.toHexString(), created: false };
  }
  const key = gapKeyOf(product, text);
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await gaps().updateOne({ key }, update, { upsert: true });
      const gap = result.upsertedId
        ? { _id: result.upsertedId }
        : await gaps().findOne({ key }, { projection: { _id: 1 } });
      return { id: gap?._id.toHexString() ?? "", created: Boolean(result.upsertedId) };
    } catch (error) {
      if (!isDuplicate(error) || attempt > 0) throw error;
    }
  }
}

export interface Gap {
  id: string;
  text: string;
  productId: string | null;
  firstSeen: Date;
  lastSeen: Date;
  // Coding sessions it came up in.
  sessions: number;
  // Times an agent ran into it (once per session), and times someone asked Ask Strata and got no answer.
  fromAgents: number;
  fromPeople: number;
  status: "open" | "resolved";
  owner: Person | null;
  resolution: { url: string | null; note: string; at: Date } | null;
  // Resolved, then seen again: what answered it didn't.
  seenSinceResolved: boolean;
}

export interface GapDetail extends Gap {
  // The approved sessions it came up in, newest first.
  sessionIds: string[];
  sourceIds: string[];
}

function view(doc: GapDoc, names: Map<string, string>, live: (id: string) => string | null): Gap {
  const ownerName = doc.ownerId ? names.get(doc.ownerId) : undefined;
  return {
    id: doc._id.toHexString(),
    text: doc.text,
    productId: doc.productId ? live(doc.productId) : null,
    firstSeen: doc.firstSeen,
    lastSeen: doc.lastSeen,
    sessions: doc.sessions ?? 0,
    fromAgents: doc.fromAgents ?? 0,
    fromPeople: doc.fromPeople ?? 0,
    status: doc.status,
    owner: doc.ownerId ? { id: doc.ownerId, name: ownerName ?? "A former member" } : null,
    resolution: doc.resolution,
    seenSinceResolved: Boolean(doc.status === "resolved" && doc.resolution && doc.lastSeen > doc.resolution.at),
  };
}

async function views(docs: GapDoc[]): Promise<Gap[]> {
  const [names, index] = await Promise.all([
    namesOf(docs.flatMap((d) => (d.ownerId ? [d.ownerId] : []))),
    productIndex(),
  ]);
  return docs.map((doc) => view(doc, names, (id) => index.live(id)?._id ?? null));
}

const often = (g: Gap) => g.sessions + g.fromPeople;

// Gaps, the ones that come back most first (open before resolved); resolved ones by when they were resolved, newest
// first. `source` keeps those agents ran into, or those people asked about.
export async function listGaps(
  query: { productId?: string; status?: "open" | "resolved"; source?: "agents" | "people" },
  viewer: ViewerRef,
): Promise<Gap[]> {
  if (!(await reader(viewer))) return [];
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.source === "agents") filter.fromAgents = { $gt: 0 };
  if (query.source === "people") filter.fromPeople = { $gt: 0 };
  if (query.productId) {
    const ids = (await productIndex()).aliases(query.productId);
    if (!ids.length) return [];
    filter.productId = { $in: ids };
  }
  const list = await views(await gaps().find(filter).sort({ lastSeen: -1 }).limit(2000).toArray());
  const rank = (a: Gap, b: Gap): number => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "resolved")
      return (
        (b.resolution?.at.getTime() ?? 0) - (a.resolution?.at.getTime() ?? 0) ||
        b.lastSeen.getTime() - a.lastSeen.getTime()
      );
    return often(b) - often(a) || b.lastSeen.getTime() - a.lastSeen.getTime();
  };
  return list.sort(rank);
}

const objectId = (id: string): ObjectId | null => (/^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : null);

export async function getGap(id: string, viewer: ViewerRef): Promise<GapDetail | null> {
  const _id = objectId(id);
  if (!_id || !(await reader(viewer))) return null;
  const doc = await gaps().findOne({ _id });
  if (!doc) return null;
  const [gap] = await views([doc]);
  if (!gap) return null;
  const sessions = [...(doc.occurrences ?? [])]
    .filter((o) => o.sessionId)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((o) => o.sessionId as string);
  return { ...gap, sessionIds: [...new Set(sessions)], sourceIds: doc.sourceIds ?? [] };
}

async function change(
  id: string,
  viewer: ViewerRef,
  action: "gap.take" | "gap.resolve" | "gap.reopen",
  set: Partial<GapDoc>,
): Promise<GapDetail> {
  await writer(viewer);
  const viewerId = viewerIdOf(viewer);
  const _id = objectId(id);
  const doc = _id
    ? await gaps().findOneAndUpdate({ _id }, { $set: { ...set, updatedAt: new Date() } }, { returnDocument: "after" })
    : null;
  if (!doc) throw new Refusal("That gap doesn't exist any more.");
  const name = (await namesOf([viewerId])).get(viewerId);
  await audit({
    actor: { kind: "user", id: viewerId, label: name ?? "a person" },
    action,
    targetIds: [doc._id.toHexString()],
    scope: null,
    detail: { text: doc.text.slice(0, 120), ...(set.resolution ? { url: set.resolution.url } : {}) },
  });
  const detail = await getGap(doc._id.toHexString(), viewer);
  if (!detail) throw new Refusal("That gap doesn't exist any more.");
  return detail;
}

// The viewer takes the gap on. Anyone who can see it can take it, from whoever had it.
export const takeGap = (id: string, viewer: ViewerRef): Promise<GapDetail> =>
  change(id, viewer, "gap.take", { ownerId: viewerIdOf(viewer) });

const Resolution = z
  .object({
    url: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((url) => url || null)
      .refine((url) => url === null || /^https?:\/\/[^\s]+$/i.test(url), { message: "a web address (https://…)" }),
    note: z.string().max(1000).default(""),
  })
  .refine((r) => r.url || r.note.trim(), { message: "a link or a note, at least one" });

// Resolved, with the doc, ADR or comment that answers it.
export async function resolveGap(
  id: string,
  viewer: ViewerRef,
  input: { url?: string | null; note: string },
): Promise<GapDetail> {
  const parsed = Resolution.safeParse({ url: input.url ?? undefined, note: input.note });
  if (!parsed.success) throw new Refusal(`Give ${parsed.error.issues[0]?.message ?? "a link or a note"}.`);
  return change(id, viewer, "gap.resolve", {
    status: "resolved",
    resolution: { url: parsed.data.url, note: cleanText(parsed.data.note, 1000), at: new Date() },
  });
}

// Open again: what answered it didn't.
export const reopenGap = (id: string, viewer: ViewerRef): Promise<GapDetail> =>
  change(id, viewer, "gap.reopen", { status: "open", resolution: null });
