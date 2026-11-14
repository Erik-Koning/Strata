// POST /api/memory/events: what the clients captured, stored once each (the event's id is the idempotency key, so a
// retried batch is harmless), redacted again here whatever the client did, then read by the extract job.
//
// Each event is checked on its own (parseEvent): one the API can't take is listed in the answer with why, and the rest
// are stored. An event of a kind or a version this API doesn't know yet is stored as it came, marked unknown, so a newer
// client loses nothing to an older API; the jobs read it once the API learns it.
import {
  CONTRACT_VERSION,
  type EventsResponse,
  MIN_CONTRACT_VERSION,
  parseEvent,
  type Rejection,
  redactDeep,
  type WireEvent,
} from "@strata/contracts";
import { MongoBulkWriteError } from "mongodb";
import { type Principal, scopeFor } from "../api-auth.ts";
import { type EventDoc, events } from "../collections.ts";
import { ApiError } from "../http.ts";
import { draftFinding, draftSession } from "../records/draft.ts";
import { extract, statusFor } from "./extract.ts";
import { addMemory } from "./store.ts";

export async function ingest(principal: Principal, batch: unknown[]): Promise<Required<EventsResponse>> {
  const now = new Date();
  const rejected: Rejection[] = [];
  const parsed: { event: WireEvent; known: boolean }[] = [];
  batch.forEach((raw, index) => {
    const result = parseEvent(raw);
    if (result.ok) parsed.push({ event: result.event, known: result.known });
    else rejected.push({ index, ...(result.id ? { id: result.id } : {}), code: result.code, message: result.message });
  });
  // A client too old for this API keeps its events and waits for an update; it never throws them away.
  if (rejected.some((r) => r.code === "upgrade_required"))
    throw new ApiError(
      426,
      "upgrade_required",
      `This client writes an older contract than the API accepts (versions ${MIN_CONTRACT_VERSION} to ${CONTRACT_VERSION}). Update the plugin.`,
    );

  const unique = [...new Map(parsed.map((p) => [p.event.id, p])).values()];
  const docs: EventDoc[] = unique.map(({ event, known }) => {
    const { v, id, sessionID, scope, kind, payload, ts, promptID, ...ext } = event;
    return {
      v,
      id,
      sessionID,
      scope: scopeFor(principal, scope),
      kind,
      payload: redactDeep(payload),
      promptID: promptID ?? null,
      ...(Object.keys(ext).length ? { ext: redactDeep(ext) } : {}),
      known,
      ts: new Date(ts),
      receivedAt: now,
      client: principal.client,
      processedAt: null,
    };
  });
  let insertedIds: string[] = [];
  if (docs.length) {
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
  }
  await processEvents(insertedIds);
  // A finding is drafted as soon as its event is stored; a session's end drafts the summary and any remaining findings.
  const inserted = new Set(insertedIds);
  for (const event of docs) {
    if (!inserted.has(event.id) || !event.known || event.kind !== "finding") continue;
    try {
      await draftFinding(event);
    } catch (error) {
      console.error("records: drafting a finding failed", { sessionID: event.sessionID, error });
    }
  }
  // Drafting is idempotent, and a failure must never lose events.
  const ended = docs.filter((doc) => doc.known && doc.kind === "session" && doc.payload.event === "end");
  for (const event of ended) {
    try {
      await draftSession(event.scope, event.sessionID);
    } catch (error) {
      console.error("records: drafting failed", { sessionID: event.sessionID, error });
    }
  }
  return { accepted: insertedIds.length, duplicates: parsed.length - insertedIds.length, rejected };
}

// The extract job, on events not read yet. Runs inline after ingest for now; the jobs route will run it on a schedule.
export async function processEvents(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const pending = await events()
    .find({ id: { $in: ids }, processedAt: null, known: true, kind: { $in: ["prompt", "assistant"] } })
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
          // The client's message id where it has one, else the turn the event belongs to.
          messageID: typeof event.payload.messageID === "string" ? event.payload.messageID : (event.promptID ?? null),
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
