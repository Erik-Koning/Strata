// POST /api/memory/events: what the clients captured, stored once each (the event's id is the idempotency key, so a
// retried batch is harmless), redacted again here whatever the client did, then read by the extract job.
import { type MemoryEvent, redactDeep } from "@strata/contracts";
import { MongoBulkWriteError } from "mongodb";
import { type Principal, scopeFor } from "../api-auth.ts";
import { type EventDoc, events } from "../collections.ts";
import { extract, statusFor } from "./extract.ts";
import { addMemory } from "./store.ts";

export async function ingest(
  principal: Principal,
  batch: MemoryEvent[],
): Promise<{ accepted: number; duplicates: number }> {
  const now = new Date();
  const unique = [...new Map(batch.map((e) => [e.id, e])).values()];
  const docs: EventDoc[] = unique.map((e) => ({
    id: e.id,
    sessionID: e.sessionID,
    scope: scopeFor(principal, e.scope),
    kind: e.kind,
    payload: redactDeep(e.payload),
    ts: new Date(e.ts),
    receivedAt: now,
    client: principal.client,
    processedAt: null,
  }));
  let insertedIds: string[] = [];
  try {
    await events().insertMany(docs, { ordered: false });
    insertedIds = docs.map((d) => d.id);
  } catch (error) {
    if (!(error instanceof MongoBulkWriteError)) throw error;
    const errors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
    if (errors.some((w) => w.code !== 11000)) throw error;
    const failed = new Set(errors.map((w) => w.index));
    insertedIds = docs.filter((_, i) => !failed.has(i)).map((d) => d.id);
  }
  await processEvents(insertedIds);
  return { accepted: insertedIds.length, duplicates: batch.length - insertedIds.length };
}

// The extract job, on events not read yet. Runs inline after ingest for now; the jobs route will run it on a schedule.
export async function processEvents(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const pending = await events()
    .find({ id: { $in: ids }, processedAt: null, kind: { $in: ["prompt", "assistant"] } })
    .toArray();
  let made = 0;
  for (const event of pending) {
    const role =
      typeof event.payload.role === "string"
        ? event.payload.role
        : event.kind === "assistant"
          ? "assistant"
          : undefined;
    const text = typeof event.payload.text === "string" ? event.payload.text : "";
    for (const found of extract(text)) {
      const status = statusFor(role, event.kind);
      const { created } = await addMemory({
        scope: event.scope,
        kind: found.kind,
        text: found.text,
        status,
        trust: status === "active" ? "explicit" : "inferred",
        confidence: status === "active" ? found.confidence : Math.min(found.confidence, 0.5),
        provenance: {
          sessionID: event.sessionID,
          messageID: typeof event.payload.messageID === "string" ? event.payload.messageID : null,
          eventId: event.id,
          source: event.kind === "assistant" || role === "assistant" ? "assistant" : "prompt",
        },
      });
      if (created) made++;
    }
  }
  await events().updateMany({ id: { $in: ids } }, { $set: { processedAt: new Date() } });
  return made;
}
