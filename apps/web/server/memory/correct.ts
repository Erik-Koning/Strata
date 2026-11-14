// Correcting a memory: its owner replaces it with what's true now. The correction is a new memory (same scope and kind,
// trusted as explicit, embedded) that names the old one in `supersedes`; the old one is marked superseded, so recall
// stops returning it and a handoff that shared it returns the correction in its place. Only the owner can correct; for
// anyone else the memory isn't there (404). In the audit log as "memory.correct".
import { redact, type Scope } from "@strata/contracts";
import { ObjectId } from "mongodb";
import { embeddingModelId, provider } from "../ai/provider.ts";
import { audit } from "../audit.ts";
import { type AuditDoc, type MemoryDoc, memories } from "../collections.ts";
import { ApiError } from "../http.ts";
import { textKey } from "./store.ts";

export async function correctMemory(input: {
  actor: AuditDoc["actor"];
  // Whose memory: the person. The project in a request's scope doesn't narrow it: a memory may be for every project.
  owner: Pick<Scope, "org" | "user">;
  id: string;
  text: string;
  sessionID: string | null;
  source: "tool" | "manual";
}): Promise<{ memory: MemoryDoc; supersedes: string }> {
  const own = { "scope.org": input.owner.org, "scope.user": input.owner.user };
  const old = /^[a-f0-9]{24}$/.test(input.id)
    ? await memories().findOne({ ...own, _id: new ObjectId(input.id) })
    : null;
  if (!old) throw new ApiError(404, "not_found", "There's no memory of yours with that id.");
  const text = redact(input.text).trim();
  if (!text) throw new ApiError(400, "invalid", "text: the correction is empty.");
  if (old.status !== "active" && old.status !== "candidate")
    throw new ApiError(409, "conflict", `That memory is ${old.status}: only an active one can be corrected.`);

  const ai = provider();
  const [embedding = []] = await ai.embed([text], { purpose: "document" });
  const now = new Date();
  // The old one first, and only if it's still correctable: two corrections racing can't both replace it.
  const marked = await memories().updateOne(
    { _id: old._id, status: { $in: ["active", "candidate"] } },
    { $set: { status: "superseded", updatedAt: now } },
  );
  if (!marked.modifiedCount) throw new ApiError(409, "conflict", "That memory changed meanwhile. Load it again.");
  const memory: MemoryDoc = {
    _id: new ObjectId(),
    scope: old.scope,
    kind: old.kind,
    text,
    textKey: textKey(text),
    embedding,
    embeddingModel: embeddingModelId(ai),
    provenance: { sessionID: input.sessionID, messageID: null, eventId: null, source: input.source },
    trust: "explicit",
    confidence: Math.max(old.confidence ?? 0, 0.9),
    status: "active",
    supersedes: old._id,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  };
  try {
    await memories().insertOne(memory);
  } catch (error) {
    await memories().updateOne({ _id: old._id }, { $set: { status: old.status, updatedAt: new Date() } });
    throw error;
  }
  await audit({
    actor: input.actor,
    action: "memory.correct",
    targetIds: [memory._id.toHexString(), old._id.toHexString()],
    scope: old.scope,
    detail: { kind: old.kind, supersedes: old._id.toHexString(), source: input.source },
  });
  return { memory, supersedes: old._id.toHexString() };
}
