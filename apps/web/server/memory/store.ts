// Making a memory: redacted, embedded, and not twice. Every path that adds one (ingest, save, seed) comes through here.
import { createHash } from "node:crypto";
import { type MemoryKind, type MemoryStatus, redact, type Scope, type TrustLevel } from "@strata/contracts";
import { ObjectId } from "mongodb";
import { embeddingModelId, provider } from "../ai/provider.ts";
import { type MemoryDoc, memories } from "../collections.ts";
import { normalize } from "./extract.ts";

export interface NewMemory {
  scope: Scope;
  kind: MemoryKind;
  text: string;
  status: MemoryStatus;
  trust: TrustLevel;
  confidence: number;
  provenance: MemoryDoc["provenance"];
}

// The memory, or the one already there with the same words in the same scope (promoted, if the new one is active).
export async function addMemory(input: NewMemory): Promise<{ memory: MemoryDoc; created: boolean }> {
  const text = redact(input.text).trim();
  const key = textKey(text);
  const existing = await memories().findOne({
    "scope.org": input.scope.org,
    "scope.user": input.scope.user,
    "scope.project": input.scope.project,
    textKey: key,
    status: { $in: ["candidate", "active"] },
  });
  if (existing) {
    if (existing.status === "candidate" && input.status === "active") {
      await memories().updateOne(
        { _id: existing._id },
        { $set: { status: "active", trust: input.trust, updatedAt: new Date() } },
      );
      return { memory: { ...existing, status: "active", trust: input.trust }, created: false };
    }
    return { memory: existing, created: false };
  }
  const ai = provider();
  const [embedding = []] = await ai.embed([text], { purpose: "document" });
  const now = new Date();
  const memory: MemoryDoc = {
    _id: new ObjectId(),
    scope: input.scope,
    kind: input.kind,
    text,
    textKey: key,
    embedding,
    embeddingModel: embeddingModelId(ai),
    provenance: input.provenance,
    trust: input.trust,
    confidence: input.confidence,
    status: input.status,
    supersedes: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  };
  await memories().insertOne(memory);
  return { memory, created: true };
}

export const textKey = (text: string): string => createHash("sha1").update(normalize(text)).digest("hex");

// Retrieval's view of a scope: active, and not past its expiry. Recall and frozen both start here.
export function liveFilter(now = new Date()): Record<string, unknown> {
  return { status: "active", $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
}

export const hit = (m: Pick<MemoryDoc, "_id" | "kind" | "text">) => ({
  _id: m._id.toHexString(),
  kind: m.kind,
  text: m.text,
});
