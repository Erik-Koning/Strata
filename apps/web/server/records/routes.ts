// /api/records: the drafts the server wrote, and the author's decision about each. A draft is its author's alone;
// an approved record is shared with everyone who has access, as access.ts says. Approved insights and workflow
// findings are copied into memories so the next session can recall them.
import { createHash } from "node:crypto";
import { RecordQuery, RecordUpdate, type RecordView, redact } from "@strata/contracts";
import { type Filter, ObjectId } from "mongodb";
import { can } from "../access.ts";
import { actorOf, authenticate, type Principal } from "../api-auth.ts";
import { audit } from "../audit.ts";
import { type RecordDoc, records } from "../collections.ts";
import { ApiError, check, json, parseBody, route } from "../http.ts";
import { indexesReady } from "../indexes.ts";
import { normalize } from "../memory/extract.ts";
import { addMemory } from "../memory/store.ts";
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
// shares a record, and a suspended person sees nothing.
async function visibleTo(principal: Principal): Promise<Filter<RecordDoc>> {
  if (principal.kind === "service") return {};
  const access = await accessFor(principal.userId);
  if (!can.seeApproved(access)) throw new ApiError(403, "forbidden", "This account cannot read records.");
  return { $or: [{ "scope.user": principal.userId }, { status: "approved" }] };
}

async function requireRecord(principal: Principal, id: string): Promise<RecordDoc> {
  if (!ObjectId.isValid(id)) throw new ApiError(404, "not_found", "No such record.");
  const access: Filter<RecordDoc> =
    principal.kind === "service" ? {} : { $or: [{ "scope.user": principal.userId }, { status: "approved" }] };
  const doc = await records().findOne({ _id: new ObjectId(id), ...access });
  if (!doc) throw new ApiError(404, "not_found", "No such record.");
  return doc;
}

async function requireOwnRecord(principal: Principal, id: string): Promise<RecordDoc> {
  const doc = await requireRecord(principal, id);
  if (principal.kind !== "service" && doc.scope.user !== principal.userId)
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

export const patchRecord = route(async (request, id: string) => {
  const principal = await authenticate(request);
  const doc = await requireOwnRecord(principal, id);
  if (doc.status === "discarded") throw new ApiError(409, "discarded", "A discarded record cannot be edited.");
  const body = await parseBody(request, RecordUpdate);
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
  const updated = await records().findOneAndUpdate({ _id: doc._id }, { $set: patch }, { returnDocument: "after" });
  if (!updated) throw new ApiError(404, "not_found", "No such record.");
  await audit({
    actor: actorOf(principal),
    action: "record.edit",
    targetIds: [id],
    scope: doc.scope,
    detail: { fields: Object.keys(body) },
  });
  return json({ record: view(updated) });
});

export const approveRecord = route(async (request, id: string) => {
  const principal = await authenticate(request);
  const doc = await requireOwnRecord(principal, id);
  if (doc.status === "discarded") throw new ApiError(409, "discarded", "A discarded record cannot be approved.");
  if (doc.status === "approved") return json({ record: view(doc) });

  let memoryId: ObjectId | null = doc.memoryId;
  const memoryKind = doc.kind === "insight" ? "fact" : doc.kind === "workflow" ? "convention" : null;
  if (memoryKind) {
    const { memory } = await addMemory({
      scope: doc.scope,
      kind: memoryKind,
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
    memoryId = memory._id;
  }
  const now = new Date();
  const updated = await records().findOneAndUpdate(
    { _id: doc._id },
    { $set: { status: "approved", approvedAt: now, updatedAt: now, memoryId } },
    { returnDocument: "after" },
  );
  if (!updated) throw new ApiError(404, "not_found", "No such record.");
  await audit({
    actor: actorOf(principal),
    action: "record.approve",
    targetIds: [id],
    scope: doc.scope,
    detail: { kind: doc.kind, memoryId: memoryId?.toHexString() ?? null },
  });
  return json({ record: view(updated) });
});

export const discardRecord = route(async (request, id: string) => {
  const principal = await authenticate(request);
  const doc = await requireOwnRecord(principal, id);
  if (doc.status === "discarded") return json({ record: view(doc) });
  const now = new Date();
  const updated = await records().findOneAndUpdate(
    { _id: doc._id },
    { $set: { status: "discarded", approvedAt: null, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) throw new ApiError(404, "not_found", "No such record.");
  await audit({
    actor: actorOf(principal),
    action: "record.discard",
    targetIds: [id],
    scope: doc.scope,
    detail: { kind: doc.kind },
  });
  return json({ record: view(updated) });
});
