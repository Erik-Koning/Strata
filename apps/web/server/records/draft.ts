// Drafting: turn one session's redacted events into reviewed records. The server does this when a session ends;
// the records belong to the author alone until they approve or discard them. The raw prompt, reply and transcript
// events stay in memory_events until the 30-day TTL, as my-day keeps them.
import { createHash } from "node:crypto";
import { type DraftRecord, type Ref, redact, type Scope } from "@strata/contracts";
import { MongoServerError, ObjectId } from "mongodb";
import { provider } from "../ai/provider.ts";
import { audit } from "../audit.ts";
import { events, records } from "../collections.ts";
import { normalize } from "../memory/extract.ts";

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

/** Draft a session's records. Idempotent by the records' text; safe to call again for the same session. */
export async function draftSession(scope: Scope, sessionID: string): Promise<{ created: number }> {
  const sessionEvents = await events()
    .find({ "scope.org": scope.org, "scope.user": scope.user, "scope.project": scope.project, sessionID })
    .sort({ ts: 1 })
    .limit(5000)
    .toArray();
  if (!sessionEvents.length) return { created: 0 };

  // Replaying a session end is a no-op: every event already carries a draft. New events (a resumed session) redraft.
  const hasUndrafted = sessionEvents.some((event) => !event.draftedAt);
  if (!hasUndrafted) return { created: 0 };

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

  // The draft is the durable thing. The raw events stay until the memory_events TTL.
  const ids = sessionEvents.map((event) => event._id!);
  await events().updateMany({ _id: { $in: ids } }, { $set: { draftedAt: now } });

  return { created };
}
