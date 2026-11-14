// /api/records: the drafts the server wrote, and the author's decision about each. A draft is its author's alone;
// an approved record is shared with everyone who has access, as access.ts says. Approved insights and workflow
// findings are copied into memories so the next session can recall them; editing or discarding an approved one
// retires that memory, and approving it again brings the same memory back. Each decision also brings the hub's
// products, gaps and Ask Strata's search copy up to date.
import { createHash } from "node:crypto";
import { type MemoryKind, RecordQuery, RecordUpdate, type RecordView, redact } from "@strata/contracts";
import { type Filter, MongoServerError, ObjectId } from "mongodb";
import { can } from "../access.ts";
import { provider } from "../ai/provider.ts";
import { actorOf, authenticate, type Principal } from "../api-auth.ts";
import { audit } from "../audit.ts";
import { memories, type RecordDoc, records } from "../collections.ts";
import { ApiError, check, json, parseBody, route } from "../http.ts";
import { syncGaps } from "../hub/gaps.ts";
import { ensureProductsFor } from "../hub/products.ts";
import { indexSessionsLater, searchSyncPending } from "../hub/search.ts";
import { indexesReady } from "../indexes.ts";
import { normalize } from "../memory/extract.ts";
import { addMemory, textKey as memoryTextKey } from "../memory/store.ts";
import { accessFor } from "../people.ts";

const clean = (value: string, max: number): string => redact(value).replace(/\s+/g, " ").trim().slice(0, max);

const view = (doc: RecordDoc): RecordView => ({
  _id: doc._id.toHexString(),
  kind: doc.kind,
  status: doc.status,
  title: doc.title,
  text: doc.text,
  refs: doc.refs,
  sessionID: doc.sessionID,
  project: doc.scope.project,
  edited: doc.edited,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
  approvedAt: doc.approvedAt?.toISOString() ?? null,
});

// The service token may read everything. A person sees their own drafts, and every approved record: approval is what
// shares a record, and a suspended person sees nothing. Every read of a record goes through this one filter, the list
// and a single record alike, whether the caller has a key or is signed in, so the rule can't drift between them.
async function visibleTo(caller: Caller): Promise<Filter<RecordDoc>> {
  if (caller.kind === "service") return {};
  const access = await accessFor(caller.userId);
  if (!can.seeApproved(access)) throw new ApiError(403, "forbidden", "This account cannot read records.");
  return { $or: [{ "scope.user": caller.userId }, { status: "approved" }] };
}

// Who's deciding: a client with a key (or the service token), through /api/records, or a signed-in person on My Day.
// Both go through the same rules below.
export type Caller = Principal | { kind: "user"; userId: string; label: string };

const auditActor = (caller: Caller) =>
  caller.kind === "user" ? { kind: "user" as const, id: caller.userId, label: caller.label } : actorOf(caller);

async function requireRecord(caller: Caller, id: string): Promise<RecordDoc> {
  if (!ObjectId.isValid(id)) throw new ApiError(404, "not_found", "No such record.");
  const doc = await records().findOne({ _id: new ObjectId(id), ...(await visibleTo(caller)) });
  if (!doc) throw new ApiError(404, "not_found", "No such record.");
  return doc;
}

async function requireOwnRecord(caller: Caller, id: string): Promise<RecordDoc> {
  const doc = await requireRecord(caller, id);
  if (caller.kind !== "service" && doc.scope.user !== caller.userId)
    throw new ApiError(404, "not_found", "No such record.");
  return doc;
}

export const listRecords = route(async (request) => {
  const principal = await authenticate(request);
  await indexesReady();
  const query = check(RecordQuery, Object.fromEntries(new URL(request.url).searchParams));
  const filter: Filter<RecordDoc> = await visibleTo(principal);
  if (query.status) filter.status = query.status;
  if (query.kind) filter.kind = query.kind;
  if (query.sessionID) filter.sessionID = query.sessionID;
  if (query.project) filter["scope.project"] = query.project;
  const docs = await records().find(filter).sort({ updatedAt: -1 }).limit(200).toArray();
  return json({ records: docs.map(view) });
});

export const getRecord = route(async (request, id: string) => {
  const principal = await authenticate(request);
  return json({ record: view(await requireRecord(principal, id)) });
});

// The hub's derived views of approved work, brought up to date after a decision. Gaps are reconciled in the
// background, one run at a time (a decision made meanwhile asks for one more run), and a failure is only logged: the
// decision stands, and the next sync or the backfill catches up.
let gapSync: Promise<void> | null = null;
let gapSyncAgain = false;

function syncGapsLater(doc: RecordDoc): void {
  // Only approved context gaps feed the gaps (hub/gaps.ts); no other kind changes them.
  if (doc.kind !== "context_gap") return;
  if (gapSync) {
    gapSyncAgain = true;
    return;
  }
  gapSync = (async () => {
    do {
      gapSyncAgain = false;
      try {
        await syncGaps();
      } catch (error) {
        console.error("hub: syncing gaps failed", error);
      }
    } while (gapSyncAgain);
  })().finally(() => {
    gapSync = null;
  });
}

// Resolves once the hub syncs started by decisions have finished (the gaps, and the search copy of approved work): for
// tests, and for a clean shutdown.
export async function hubPending(): Promise<void> {
  while (gapSync) await gapSync;
  await searchSyncPending();
}

// Whether another approved record holds this memory: one with the same words in the same scope shares it, since
// addMemory keeps one.
const heldElsewhere = async (memoryId: ObjectId, doc: RecordDoc): Promise<boolean> =>
  Boolean(await records().findOne({ memoryId, status: "approved", _id: { $ne: doc._id } }, { projection: { _id: 1 } }));

// A record's memory, once nothing approved holds it: archived, so agents stop recalling words nobody stands behind any
// more.
async function retireMemory(doc: RecordDoc): Promise<void> {
  if (!doc.memoryId || (await heldElsewhere(doc.memoryId, doc))) return;
  await memories().updateOne(
    {
      _id: doc.memoryId,
      "scope.org": doc.scope.org,
      "scope.user": doc.scope.user,
      status: { $in: ["candidate", "active"] },
    },
    { $set: { status: "archived", updatedAt: new Date() } },
  );
}

// The memory an approved insight or workflow finding is kept as. Approving again after an edit brings back the record's
// first memory with the words approved now, rather than adding a second; when those words are already a memory in the
// same scope, that one is used and the first stays retired.
async function rememberApproved(doc: RecordDoc, kind: MemoryKind): Promise<ObjectId> {
  const text = redact(doc.text).trim();
  const key = memoryTextKey(text);
  const scope = { "scope.org": doc.scope.org, "scope.user": doc.scope.user, "scope.project": doc.scope.project };
  const [previous, same] = await Promise.all([
    doc.memoryId ? memories().findOne({ _id: doc.memoryId, ...scope }) : null,
    memories().findOne({ ...scope, textKey: key, status: { $in: ["candidate", "active"] } }),
  ]);
  if (previous && !same && !(await heldElsewhere(previous._id, doc))) {
    const [embedding = []] = previous.textKey === key ? [previous.embedding] : await provider().embed([text]);
    await memories().updateOne(
      { _id: previous._id },
      {
        $set: { kind, text, textKey: key, embedding, status: "active", trust: "explicit", updatedAt: new Date() },
      },
    );
    return previous._id;
  }
  const { memory } = await addMemory({
    scope: doc.scope,
    kind,
    text: doc.text,
    status: "active",
    trust: "explicit",
    confidence: 0.9,
    provenance: {
      sessionID: doc.sessionID,
      messageID: null,
      eventId: doc.eventIds[0] ?? null,
      source: "manual",
    },
  });
  if (previous && !previous._id.equals(memory._id)) await retireMemory(doc);
  return memory._id;
}

const isDuplicate = (error: unknown): boolean => error instanceof MongoServerError && error.code === 11000;

// The fields records are unique by, with the text's key (indexes.ts, record_unique).
const uniqueScope = (doc: RecordDoc) => ({
  "scope.org": doc.scope.org,
  "scope.user": doc.scope.user,
  "scope.project": doc.scope.project,
  sessionID: doc.sessionID,
  kind: doc.kind,
});

// Changes a record's title or text. An approved record goes back to draft: what was approved is no longer what's there.
export async function editRecord(
  caller: Caller,
  id: string,
  body: { title?: string; text?: string },
): Promise<RecordDoc> {
  const doc = await requireOwnRecord(caller, id);
  if (doc.status === "discarded") throw new ApiError(409, "discarded", "A discarded record cannot be edited.");
  const now = new Date();
  const patch: Partial<RecordDoc> = { updatedAt: now, edited: true };
  if (body.title !== undefined) patch.title = clean(body.title, 200) || null;
  if (body.text !== undefined) {
    const text = clean(body.text, 4000);
    if (!text) throw new ApiError(400, "invalid", "The text cannot be empty.");
    patch.text = text;
    patch.textKey = createHash("sha1").update(normalize(text)).digest("hex");
  }
  // An edited record goes back for review: what was approved is no longer what is on the table.
  if (doc.status === "approved") {
    patch.status = "draft";
    patch.approvedAt = null;
  }
  let updated: RecordDoc | null;
  try {
    updated = await records().findOneAndUpdate({ _id: doc._id }, { $set: patch }, { returnDocument: "after" });
  } catch (error) {
    // The session already has a record of this kind that says the same thing (record_unique), maybe a discarded one.
    if (!isDuplicate(error)) throw error;
    const other = await records().findOne(
      { ...uniqueScope(doc), textKey: patch.textKey, _id: { $ne: doc._id } },
      { projection: { status: 1 } },
    );
    const label = recordLabel(doc.kind).toLowerCase();
    throw new ApiError(
      409,
      "duplicate",
      other?.status === "discarded"
        ? `You discarded the same ${label} from this session before. Word this one differently, or discard it too.`
        : `This session already has the same ${label}. Keep that one and discard this, or word this one differently.`,
    );
  }
  if (!updated) throw new ApiError(404, "not_found", "No such record.");
  if (doc.status === "approved") {
    await retireMemory(doc);
    syncGapsLater(doc);
    indexSessionsLater([doc.sessionID]);
  }
  await audit({
    actor: auditActor(caller),
    action: "record.edit",
    targetIds: [id],
    scope: doc.scope,
    detail: { fields: Object.keys(body) },
  });
  return updated;
}

export const patchRecord = route(async (request, id: string) => {
  const principal = await authenticate(request);
  const body = await parseBody(request, RecordUpdate);
  return json({ record: view(await editRecord(principal, id, body)) });
});

// Shares a draft with everyone who has access. An approved insight or workflow finding is also kept as a memory, so the
// next session can recall it.
export async function approve(caller: Caller, id: string): Promise<RecordDoc> {
  const doc = await requireOwnRecord(caller, id);
  if (doc.status === "discarded") throw new ApiError(409, "discarded", "A discarded record cannot be approved.");
  if (doc.status === "approved") return doc;

  const memoryKind = doc.kind === "insight" ? "fact" : doc.kind === "workflow" ? "convention" : null;
  const memoryId: ObjectId | null = memoryKind ? await rememberApproved(doc, memoryKind) : doc.memoryId;
  const now = new Date();
  const updated = await records().findOneAndUpdate(
    { _id: doc._id },
    { $set: { status: "approved", approvedAt: now, updatedAt: now, memoryId } },
    { returnDocument: "after" },
  );
  if (!updated) throw new ApiError(404, "not_found", "No such record.");
  // Approved work names its repository: the product it belongs to exists from now on. Never fails the approval; the
  // hub's backfill makes any product missed here.
  try {
    await ensureProductsFor([doc.scope.project]);
  } catch (error) {
    console.error("hub: making the record's product failed", error);
  }
  syncGapsLater(doc);
  indexSessionsLater([doc.sessionID]);
  await audit({
    actor: auditActor(caller),
    action: "record.approve",
    targetIds: [id],
    scope: doc.scope,
    detail: { kind: doc.kind, memoryId: memoryId?.toHexString() ?? null },
  });
  return updated;
}

export const approveRecord = route(async (request, id: string) => {
  const principal = await authenticate(request);
  return json({ record: view(await approve(principal, id)) });
});

// Keeps a draft out of anything shared, or takes back an approved record. It stays, marked discarded, and nobody else
// ever sees it.
export async function discard(caller: Caller, id: string): Promise<RecordDoc> {
  const doc = await requireOwnRecord(caller, id);
  if (doc.status === "discarded") return doc;
  const now = new Date();
  const updated = await records().findOneAndUpdate(
    { _id: doc._id },
    { $set: { status: "discarded", approvedAt: null, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) throw new ApiError(404, "not_found", "No such record.");
  // Discarding an approved record takes it back from everyone, and from the agents' memory.
  if (doc.status === "approved") {
    await retireMemory(doc);
    syncGapsLater(doc);
    indexSessionsLater([doc.sessionID]);
  }
  await audit({
    actor: auditActor(caller),
    action: "record.discard",
    targetIds: [id],
    scope: doc.scope,
    detail: { kind: doc.kind },
  });
  return updated;
}

export const discardRecord = route(async (request, id: string) => {
  const principal = await authenticate(request);
  return json({ record: view(await discard(principal, id)) });
});

// My Day: a person's own drafts, and what they shared lately. Never anyone else's.
export const RECORD_LABELS: Record<string, string> = {
  summary: "Session summary",
  insight: "Insight",
  workflow: "Workflow finding",
  pain_point: "Pain point",
  context_gap: "Context gap",
};
export const recordLabel = (kind: string): string => RECORD_LABELS[kind] ?? kind.replace(/_/g, " ");

export const ownDrafts = (userId: string): Promise<RecordDoc[]> =>
  records().find({ "scope.user": userId, status: "draft" }).sort({ createdAt: -1 }).limit(200).toArray();

export const ownApprovedSince = (userId: string, since: Date): Promise<RecordDoc[]> =>
  records()
    .find({ "scope.user": userId, status: "approved", approvedAt: { $gte: since } })
    .sort({ approvedAt: -1 })
    .limit(50)
    .toArray();
