// POST /api/memory/compress: at a compaction, a summary of the session so far, kept as a rollup of the events it came
// from. The client gives this 5 s and falls back to its own compaction.
import { redact, type Scope, type TranscriptMessage } from "@strata/contracts";
import { ObjectId } from "mongodb";
import { provider } from "../ai/provider.ts";
import { audit } from "../audit.ts";
import { type AuditDoc, events, summaries } from "../collections.ts";

export async function compress(
  actor: AuditDoc["actor"],
  scope: Scope,
  sessionID: string,
  messages: TranscriptMessage[],
): Promise<string | null> {
  const clean = messages.map((m) => ({ role: m.role, text: redact(m.text) }));
  const summary = await provider().summarize(clean);
  if (!summary) return null;
  const sourceIds = (
    await events()
      .find({ sessionID, "scope.user": scope.user }, { projection: { id: 1 } })
      .limit(5000)
      .toArray()
  ).map((e) => e.id);
  const _id = new ObjectId();
  await summaries().insertOne({ _id, sessionID, scope, summary, sourceIds, createdAt: new Date() });
  await audit({
    actor,
    action: "memory.compress",
    targetIds: [_id.toHexString()],
    scope,
    detail: { sessionID, messages: messages.length },
  });
  return summary;
}
