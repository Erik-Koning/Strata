// API keys: what a person's clients (the Claude Code plugin, the OpenCode plugin) send as their bearer token. A key is
// shown once, when it's made; only its SHA-256 is kept.
import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { hashKey } from "./api-auth.ts";
import { audit } from "./audit.ts";
import { type ApiKeyDoc, apiKeys } from "./collections.ts";

export async function createKey(userId: string, name: string): Promise<{ key: string; doc: ApiKeyDoc }> {
  const key = `am_${randomBytes(24).toString("base64url")}`;
  const doc: ApiKeyDoc = {
    _id: new ObjectId(),
    userId,
    name: name.trim().slice(0, 60) || "Claude Code",
    prefix: key.slice(0, 10),
    hash: hashKey(key),
    createdAt: new Date(),
    lastUsedAt: null,
    lastClient: null,
    revokedAt: null,
  };
  await apiKeys().insertOne(doc);
  await audit({
    actor: { kind: "user", id: userId, label: "you" },
    action: "key.create",
    targetIds: [doc._id.toHexString()],
    scope: null,
    detail: { name: doc.name, prefix: doc.prefix },
  });
  return { key, doc };
}

export const listKeys = (userId: string): Promise<ApiKeyDoc[]> =>
  apiKeys().find({ userId }).sort({ revokedAt: 1, createdAt: -1 }).limit(50).toArray();

export async function revokeKey(userId: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const result = await apiKeys().updateOne(
    { _id: new ObjectId(id), userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  if (result.modifiedCount)
    await audit({
      actor: { kind: "user", id: userId, label: "you" },
      action: "key.revoke",
      targetIds: [id],
      scope: null,
      detail: {},
    });
  return result.modifiedCount === 1;
}
