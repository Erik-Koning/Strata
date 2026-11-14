// The audit log: who saved, forgot, compressed or promoted what, and who made or revoked a key. Written for every
// change people should be able to trace; shown on /audit.
import type { AuditDoc } from "./collections.ts";
import { audits } from "./collections.ts";

export async function audit(entry: Omit<AuditDoc, "_id" | "ts">): Promise<void> {
  await audits().insertOne({ ...entry, ts: new Date() });
}
