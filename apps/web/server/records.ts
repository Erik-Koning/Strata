// Records: what a person's sessions drafted for them to share. A session's summary, drafted when the session ends, and
// each finding the agent logged along the way (an insight, a workflow finding, a pain point, a context gap).
//
// Drafted on the server from the redacted events (docs/architecture.md, "Drafting, and what's kept"). A draft is its
// author's alone. Approving it shares it with everyone in the organisation (access.ts); discarding it deletes it. My Day
// is where the author does both.
import { type Ref, redact, type Scope } from "@strata/contracts";
import { MongoServerError, ObjectId } from "mongodb";
import { provider } from "./ai/provider.ts";
import { audit } from "./audit.ts";
import { type EventDoc, events, type RecordDoc, records } from "./collections.ts";
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
const MAX_REFS = 20;

const refsOf = (value: unknown): Ref[] =>
  Array.isArray(value)
    ? value
        .filter((r): r is Ref => typeof r === "object" && r !== null && typeof (r as Ref).id === "string")
        .slice(0, MAX_REFS)
    : [];

function uniqueRefs(refs: Ref[]): Ref[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Two copies of the same event, or two session ends, arriving at once: the unique key lets one insert win.
async function once<T>(write: () => Promise<T>): Promise<T | null> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return null;
    throw error;
  }
}

// One draft per finding the agent logged, made once however often the event is sent.
export async function draftFindings(found: EventDoc[]): Promise<number> {
  let made = 0;
  for (const event of found) {
    const text = typeof event.payload.text === "string" ? redact(event.payload.text).trim().slice(0, MAX_TEXT) : "";
    const kind = typeof event.payload.type === "string" ? event.payload.type : "";
    if (!text || !kind) continue;
    const now = new Date();
    const result = await once(() =>
      records().updateOne(
        { key: `finding:${event.id}` },
        {
          $setOnInsert: {
            _id: new ObjectId(),
            key: `finding:${event.id}`,
            scope: event.scope,
            kind,
            text,
            refs: uniqueRefs(refsOf(event.payload.refs)),
            sessionID: event.sessionID,
            sourceIds: [event.id],
            status: "draft",
            edited: false,
            createdAt: now,
            updatedAt: now,
            approvedAt: null,
          },
        },
        { upsert: true },
      ),
    );
    if (result?.upsertedCount) made++;
  }
  return made;
}

// The session's summary, drafted from what was said in it, with the tickets and branch the session was linked to. A
// session that ends again (resumed, then ended) redrafts it, unless its author has edited or approved it.
export async function draftSessionSummary(scope: Scope, sessionID: string): Promise<RecordDoc | null> {
  const key = `summary:${scope.user}:${sessionID}`;
  const existing = await records().findOne({ key });
  if (existing && (existing.status !== "draft" || existing.edited)) return existing;

  const said = await events()
    .find({ "scope.user": scope.user, sessionID, known: true, kind: { $in: ["prompt", "assistant", "session"] } })
    .sort({ ts: 1, id: 1 })
    .limit(2000)
    .toArray();
  const messages = said
    .filter((e) => e.kind !== "session" && typeof e.payload.text === "string")
    .map((e) => ({ role: e.kind === "assistant" ? "assistant" : "user", text: String(e.payload.text) }));
  if (!messages.length) return existing;
  const summary = await provider().summarize(messages);
  if (!summary) return existing;

  const refs: Ref[] = [];
  for (const e of said.filter((s) => s.kind === "session")) {
    refs.push(...refsOf(e.payload.refs));
    const git = e.payload.git as { branch?: unknown } | undefined;
    if (git && typeof git.branch === "string" && git.branch) refs.push({ type: "branch", id: git.branch });
  }
  const now = new Date();
  const fields = {
    text: redact(summary).trim().slice(0, MAX_TEXT),
    refs: uniqueRefs(refs).slice(0, MAX_REFS),
    sourceIds: said.map((e) => e.id).slice(0, 2000),
    updatedAt: now,
  };
  await once(() =>
    records().updateOne(
      { key, status: "draft", edited: false },
      {
        $set: fields,
        $setOnInsert: {
          _id: new ObjectId(),
          key,
          scope,
          kind: "summary",
          sessionID,
          status: "draft",
          edited: false,
          createdAt: now,
          approvedAt: null,
        },
      },
      { upsert: !existing },
    ),
  );
  return records().findOne({ key });
}

// From the events just stored: a draft for each finding, and a summary for each session that ended.
export async function draftFrom(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const fresh = await events()
    .find({ id: { $in: ids }, known: true, kind: { $in: ["finding", "session"] } })
    .toArray();
  await draftFindings(fresh.filter((e) => e.kind === "finding"));
  const ended = new Map<string, EventDoc>();
  for (const e of fresh)
    if (e.kind === "session" && e.payload.event === "end") ended.set(`${e.scope.user}\u0000${e.sessionID}`, e);
  for (const e of ended.values()) await draftSessionSummary(e.scope, e.sessionID);
}

// Reading and deciding: always the author's own, never anyone else's.

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
  if (record.status !== "draft") throw new Refusal("That's already approved and shared.");
  return record;
}

function cleanText(text: string): string {
  const clean = redact(text).trim();
  if (!clean) throw new Refusal("Write something first: an empty record can't be shared.");
  if (clean.length > MAX_TEXT) throw new Refusal("Keep it under 4,000 characters.");
  return clean;
}

export async function saveDraft(userId: string, id: string, text: string): Promise<void> {
  const record = await ownDraft(userId, id);
  await records().updateOne(
    { _id: record._id, status: "draft" },
    { $set: { text: cleanText(text), edited: true, updatedAt: new Date() } },
  );
}

// Shares it: from here everyone in the organisation can see it. Text, when given, is the author's last edit.
export async function approveRecord(actor: { id: string; label: string }, id: string, text?: string): Promise<void> {
  const record = await ownDraft(actor.id, id);
  const now = new Date();
  const edit = text !== undefined && text.trim() !== record.text ? { text: cleanText(text), edited: true } : {};
  await records().updateOne(
    { _id: record._id, status: "draft" },
    { $set: { ...edit, status: "approved", approvedAt: now, updatedAt: now } },
  );
  await audit({
    actor: { kind: "user", ...actor },
    action: "record.approve",
    targetIds: [id],
    scope: record.scope,
    detail: { kind: record.kind, edited: Boolean(edit.edited) || record.edited },
  });
}

// Deletes it: a discarded draft isn't kept anywhere.
export async function discardRecord(actor: { id: string; label: string }, id: string): Promise<void> {
  const record = await ownDraft(actor.id, id);
  await records().deleteOne({ _id: record._id, status: "draft" });
  await audit({
    actor: { kind: "user", ...actor },
    action: "record.discard",
    targetIds: [id],
    scope: record.scope,
    detail: { kind: record.kind },
  });
}
