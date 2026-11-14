// The server-facing view of records for My Day. Drafting and the HTTP API live in records/ and /api/records;
// this module reads the same records collection and performs the author's decisions from server actions.
import { createHash } from "node:crypto";
import { redact } from "@strata/contracts";
import { ObjectId } from "mongodb";
import { audit } from "./audit.ts";
import { type RecordDoc, records } from "./collections.ts";
import { normalize } from "./memory/extract.ts";
import { addMemory } from "./memory/store.ts";
import { Refusal } from "./refusal.ts";

export const RECORD_LABELS: Record<string, string> = {
  summary: "Session summary",
  insight: "Insight",
  workflow: "Workflow finding",
  pain_point: "Pain point",
  context_gap: "Context gap",
};
export const recordLabel = (kind: string): string => RECORD_LABELS[kind] ?? kind.replace(/_/g, " ");

const MAX_TEXT = 4000;

export const listDrafts = (userId: string): Promise<RecordDoc[]> =>
  records().find({ "scope.user": userId, status: "draft" }).sort({ createdAt: -1 }).limit(200).toArray();

export const countDrafts = (userId: string): Promise<number> =>
  records().countDocuments({ "scope.user": userId, status: "draft" });

export const listApprovedSince = (userId: string, since: Date): Promise<RecordDoc[]> =>
  records()
    .find({ "scope.user": userId, status: "approved", approvedAt: { $gte: since } })
    .sort({ approvedAt: -1 })
    .limit(50)
    .toArray();

async function ownDraft(userId: string, id: string): Promise<RecordDoc> {
  const record = ObjectId.isValid(id) ? await records().findOne({ _id: new ObjectId(id), "scope.user": userId }) : null;
  if (!record) throw new Refusal("That draft isn't there any more.");
  if (record.status !== "draft") throw new Refusal("That's already been reviewed.");
  return record;
}

function cleanText(text: string): string {
  const clean = redact(text).trim();
  if (!clean) throw new Refusal("Write something first: an empty record can't be shared.");
  if (clean.length > MAX_TEXT) throw new Refusal("Keep it under 4,000 characters.");
  return clean;
}

const textKeyOf = (text: string): string => createHash("sha1").update(normalize(text)).digest("hex");

export async function saveDraft(userId: string, id: string, text: string): Promise<void> {
  const record = await ownDraft(userId, id);
  const clean = cleanText(text);
  await records().updateOne(
    { _id: record._id, status: "draft" },
    { $set: { text: clean, textKey: textKeyOf(clean), edited: true, updatedAt: new Date() } },
  );
}

// Shares it: from here everyone in the organisation can see it. Approved insights and workflow findings also join
// the author's memories. Text, when given, is the author's last edit.
export async function approveRecord(actor: { id: string; label: string }, id: string, text?: string): Promise<void> {
  const record = await ownDraft(actor.id, id);
  const now = new Date();
  const edit = text !== undefined && text.trim() !== record.text ? { text: cleanText(text), edited: true } : {};
  const memoryKind = record.kind === "insight" ? "fact" : record.kind === "workflow" ? "convention" : null;
  let memoryId: ObjectId | null = record.memoryId;
  if (memoryKind) {
    const { memory } = await addMemory({
      scope: record.scope,
      kind: memoryKind,
      text: edit.text ?? record.text,
      status: "active",
      trust: "explicit",
      confidence: 0.9,
      provenance: {
        sessionID: record.sessionID,
        messageID: null,
        eventId: record.eventIds[0] ?? null,
        source: "manual",
      },
    });
    memoryId = memory._id;
  }
  await records().updateOne(
    { _id: record._id, status: "draft" },
    {
      $set: {
        ...edit,
        ...(edit.text ? { textKey: textKeyOf(edit.text) } : {}),
        status: "approved",
        approvedAt: now,
        updatedAt: now,
        memoryId,
      },
    },
  );
  await audit({
    actor: { kind: "user", id: actor.id, label: actor.label },
    action: "record.approve",
    targetIds: [id],
    scope: record.scope,
    detail: {
      kind: record.kind,
      edited: Boolean(edit.edited) || record.edited,
      memoryId: memoryId?.toHexString() ?? null,
    },
  });
}

// Sets it aside; it is kept for the audit log, not deleted.
export async function discardRecord(actor: { id: string; label: string }, id: string): Promise<void> {
  const record = await ownDraft(actor.id, id);
  await records().updateOne(
    { _id: record._id, status: "draft" },
    { $set: { status: "discarded", updatedAt: new Date() } },
  );
  await audit({
    actor: { kind: "user", id: actor.id, label: actor.label },
    action: "record.discard",
    targetIds: [id],
    scope: record.scope,
    detail: { kind: record.kind },
  });
}
