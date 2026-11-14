// A memory someone asked for in so many words: the memory_save tool, or "Add a memory" on the app. Active at once.
import type { MemoryKind, Scope } from "@strata/contracts";
import { audit } from "../audit.ts";
import type { AuditDoc, MemoryDoc } from "../collections.ts";
import { addMemory } from "./store.ts";

export async function saveMemory(input: {
  actor: AuditDoc["actor"];
  scope: Scope;
  text: string;
  kind: MemoryKind;
  sessionID: string | null;
  source: "tool" | "manual" | "seed";
}): Promise<MemoryDoc> {
  const { memory, created } = await addMemory({
    scope: input.scope,
    kind: input.kind,
    text: input.text,
    status: "active",
    trust: "explicit",
    confidence: 0.9,
    provenance: { sessionID: input.sessionID, messageID: null, eventId: null, source: input.source },
  });
  if (created)
    await audit({
      actor: input.actor,
      action: "memory.save",
      targetIds: [memory._id.toHexString()],
      scope: input.scope,
      detail: { kind: input.kind, source: input.source },
    });
  return memory;
}
