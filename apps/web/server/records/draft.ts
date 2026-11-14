// Drafting: turn one session's redacted events into reviewed records. The server does this when a session ends;
// the records belong to the author alone until they approve or discard them, and the raw text (prompts, replies,
// findings, transcripts' messages, compaction summaries) is cleared once the draft exists.
import { createHash } from "node:crypto";
import { type DraftRecord, type Ref, redact, type Scope } from "@strata/contracts";
import { MongoServerError, ObjectId } from "mongodb";
import { provider } from "../ai/provider.ts";
import { audit } from "../audit.ts";
import { draftClaims, events, records } from "../collections.ts";
import { normalize } from "../memory/extract.ts";

const TEXT_KINDS = new Set(["prompt", "assistant", "transcript", "finding"]);
// The events whose payload.text is what someone wrote: the kinds above, and the summary made at a compaction.
const holdsText = (event: { kind: string; payload: Record<string, unknown> }): boolean =>
  TEXT_KINDS.has(event.kind) || (event.kind === "event" && event.payload.type === "compact_summary");
const MAX_RECORDS = 20;
const FINDING_KINDS = {
  insight: "insight",
  workflow: "workflow",
  pain_point: "pain_point",
  context_gap: "context_gap",
} as const;

const clean = (value: unknown, max: number): string =>
  redact(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const asRefs = (value: unknown): Ref[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: Ref[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const ref = item as Ref;
    if (typeof ref.id !== "string" || typeof ref.type !== "string") continue;
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length >= 20) break;
  }
  return refs;
};

const isDuplicate = (error: unknown): boolean => error instanceof MongoServerError && error.code === 11000;

// How long a claim holds before another attempt may take it over: the holder must have died.
const CLAIM_STALE_MS = 10 * 60_000;
const MAX_ROUNDS = 5;

const claimId = (scope: Scope, sessionID: string): string =>
  [scope.org, scope.user, scope.project, sessionID].join("\u001f");

// Takes the session's claim if nobody holds it (or its holder went quiet). The claim's id is unique, so of two attempts
// at once exactly one gets it: the other's upsert collides.
async function claim(id: string, token: string): Promise<boolean> {
  const now = new Date();
  try {
    await draftClaims().updateOne(
      { _id: id, $or: [{ drafting: false }, { claimedAt: { $lt: new Date(now.getTime() - CLAIM_STALE_MS) } }] },
      { $set: { drafting: true, token, again: false, claimedAt: now }, $setOnInsert: { doneAt: null } },
      { upsert: true },
    );
    return true;
  } catch (error) {
    if (isDuplicate(error)) return false;
    throw error;
  }
}

/**
 * Draft a session's records, once at a time: a retried or repeated end event while it's being drafted doesn't draft it
 * again, it asks the drafter to look once more for events that arrived meanwhile. Safe to call again for the same
 * session: a session with nothing new is a no-op.
 */
export async function draftSession(scope: Scope, sessionID: string): Promise<{ created: number; skipped: boolean }> {
  const id = claimId(scope, sessionID);
  const token = new ObjectId().toHexString();
  if (!(await claim(id, token))) {
    const asked = await draftClaims().updateOne({ _id: id, drafting: true }, { $set: { again: true } });
    // Asked the drafter, or the drafter finished in between and someone else claimed it since: theirs to do.
    if (asked.matchedCount || !(await claim(id, token))) return { created: 0, skipped: true };
  }
  let created = 0;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      created += (await draftUnclaimed(scope, sessionID)).created;
      const done = await draftClaims().updateOne(
        { _id: id, token, again: false },
        { $set: { drafting: false, token: null, doneAt: new Date() } },
      );
      if (done.modifiedCount) break;
      // Asked to look again, unless the claim went stale and someone else holds it now.
      const still = await draftClaims().updateOne({ _id: id, token }, { $set: { again: false } });
      if (!still.matchedCount) break;
    }
  } finally {
    // After an error, or too many rounds: the next end event, or the claim going stale, picks it up.
    await draftClaims()
      .updateOne({ _id: id, token }, { $set: { drafting: false, token: null, doneAt: new Date() } })
      .catch(() => undefined);
  }
  return { created, skipped: false };
}

// One pass over the session's events. Idempotent by the records' text; only draftSession calls it, under the claim.
async function draftUnclaimed(scope: Scope, sessionID: string): Promise<{ created: number }> {
  const sessionEvents = await events()
    .find({ "scope.org": scope.org, "scope.user": scope.user, "scope.project": scope.project, sessionID })
    .sort({ ts: 1 })
    .limit(5000)
    .toArray();
  if (!sessionEvents.length) return { created: 0 };

  // Replaying a session end is a no-op, and so is an end with nothing new written since the last draft (the events are
  // only marked): the model drafts from text, never from nothing.
  const hasNewText = sessionEvents.some(
    (event) =>
      (holdsText(event) && typeof event.payload.text === "string" && event.payload.text.trim().length > 0) ||
      (event.kind === "transcript" && Array.isArray(event.payload.messages) && event.payload.messages.length > 0),
  );
  const undrafted = sessionEvents.filter((event) => !event.draftedAt).map((event) => event._id!);
  if (!hasNewText) {
    if (undrafted.length) await events().updateMany({ _id: { $in: undrafted } }, { $set: { draftedAt: new Date() } });
    return { created: 0 };
  }

  const textOf = (event: (typeof sessionEvents)[number]): string =>
    typeof event.payload.text === "string" ? event.payload.text : "";
  const prompts = sessionEvents
    .filter((event) => event.known && event.kind === "prompt")
    .map(textOf)
    .filter(Boolean);
  const replies = sessionEvents
    .filter((event) => event.known && event.kind === "assistant")
    .map(textOf)
    .filter(Boolean);
  const compact = sessionEvents.find(
    (event) => event.known && event.kind === "event" && event.payload.type === "compact_summary",
  );
  const tools = sessionEvents
    .filter((event) => event.known && event.kind === "tool")
    .map((event) => ({
      tool: typeof event.payload.tool === "string" ? event.payload.tool : "unknown",
      status: typeof event.payload.status === "string" ? event.payload.status : "ok",
      command:
        event.payload.command && typeof event.payload.command === "object"
          ? (event.payload.command as { class?: string; exit?: number })
          : undefined,
    }));
  const refs = asRefs(
    sessionEvents.flatMap((event) => {
      const payload = event.payload as { refs?: unknown };
      return Array.isArray(payload.refs) ? payload.refs : [];
    }),
  );

  // A finding the agent or engineer logged live is already a record: carry it through with the drafted ones.
  const findings: DraftRecord[] = sessionEvents
    .filter((event) => event.known && event.kind === "finding")
    .flatMap((event) => {
      const type = typeof event.payload.type === "string" ? event.payload.type : "";
      const kind = FINDING_KINDS[type as keyof typeof FINDING_KINDS];
      const text = textOf(event);
      if (!kind || !text.trim()) return [];
      return [{ kind, text, refs: asRefs(event.payload.refs) }];
    });

  const drafts = [
    ...findings,
    ...(await provider().draftRecords({
      sessionID,
      project: scope.project,
      prompts,
      replies,
      compactSummary: compact ? textOf(compact) : null,
      tools,
      refs,
    })),
  ].slice(0, MAX_RECORDS);

  const now = new Date();
  let created = 0;
  for (const draft of drafts) {
    const text = clean(draft.text, 4000);
    if (!text) continue;
    const title = draft.title ? clean(draft.title, 200) : null;
    const textKey = createHash("sha1").update(normalize(text)).digest("hex");
    try {
      await records().insertOne({
        _id: new ObjectId(),
        scope,
        sessionID,
        kind: draft.kind,
        status: "draft",
        title,
        text,
        textKey,
        refs: draft.refs?.length ? asRefs(draft.refs) : refs,
        eventIds: sessionEvents.map((event) => event.id),
        edited: false,
        createdAt: now,
        updatedAt: now,
        approvedAt: null,
        memoryId: null,
      });
      created++;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
    }
  }

  if (created) {
    await audit({
      actor: { kind: "service", id: "server", label: "server" },
      action: "record.draft",
      targetIds: [sessionID],
      scope,
      detail: { records: created },
    });
  }

  // The draft is the durable thing. The text that produced it goes, on the same events, now.
  const ids = sessionEvents.map((event) => event._id!);
  await events().updateMany({ _id: { $in: ids } }, { $set: { draftedAt: now } });
  const textIds = sessionEvents.filter(holdsText).map((event) => event._id!);
  if (textIds.length) await events().updateMany({ _id: { $in: textIds } }, { $set: { "payload.text": "" } });
  const transcriptIds = sessionEvents.filter((event) => event.kind === "transcript").map((event) => event._id!);
  if (transcriptIds.length)
    await events().updateMany({ _id: { $in: transcriptIds } }, { $set: { "payload.messages": [] } });

  return { created };
}
