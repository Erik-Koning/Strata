// The documents the app keeps, and a typed handle on each collection. Only the API touches these.
import type {
  EventKind,
  MemoryKind,
  MemoryStatus,
  Scope,
  SummaryLinks,
  SummarySummary,
  TrustLevel,
} from "@strata/contracts";
import type { Collection, ObjectId } from "mongodb";
import { db } from "./db.ts";

// Raw capture, as the clients sent it (redacted again on the way in). Deduped on id; expires after 30 days.
export interface EventDoc {
  _id?: ObjectId;
  id: string;
  sessionID: string;
  scope: Scope;
  kind: EventKind;
  payload: Record<string, unknown>;
  ts: Date;
  receivedAt: Date;
  client: string | null;
  // Set once a job has read it (extract), so it's read once.
  processedAt?: Date | null;
}

export interface MemoryDoc {
  _id: ObjectId;
  scope: Scope;
  kind: MemoryKind;
  text: string;
  // The text, lower-cased with its spacing and end stops dropped, hashed: the same memory said twice is kept once.
  textKey: string;
  embedding: number[];
  provenance: {
    sessionID: string | null;
    messageID: string | null;
    eventId: string | null;
    source: "prompt" | "assistant" | "tool" | "compaction" | "manual" | "seed";
  };
  trust: TrustLevel;
  confidence: number;
  status: MemoryStatus;
  supersedes: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export interface SummaryDoc {
  _id: ObjectId;
  sessionID: string;
  scope: Scope;
  summary: string;
  // The events, and the memories, a summary was made from: forgetting any of them removes the summary too.
  sourceIds: string[];
  createdAt: Date;
}

export interface AuditDoc {
  _id?: ObjectId;
  actor: { kind: "user" | "service" | "key"; id: string; label: string };
  action:
    | "memory.save"
    | "memory.forget"
    | "memory.compress"
    | "memory.promote"
    | "key.create"
    | "key.revoke"
    | "summary.receive"
    | "summary.retract";
  targetIds: string[];
  scope: Partial<Scope> | null;
  detail: Record<string, unknown>;
  ts: Date;
}

export interface ProjectDoc {
  _id: ObjectId;
  name: string;
  teamName: string;
  description: string;
  createdAt: Date;
}

export interface ProjectMemberDoc {
  _id: ObjectId;
  projectId: ObjectId;
  userId: string;
  role: "owner" | "member";
  // The one project the app creates for a person; the index makes it one per user.
  isDefault?: boolean;
  createdAt: Date;
}

// One approved revision of one session. The highest revision for (userId, sessionId) is the current summary;
// older ones stay for audit. The plugin never sends prompts or replies, so neither is stored.
export interface SummaryRevisionDoc {
  _id?: ObjectId;
  userId: string;
  authorName: string | null;
  sessionId: string;
  projectId: string;
  revision: number;
  idempotencyKey: string;
  updatedAt: Date;
  receivedAt: Date;
  client: { plugin: string; platform: string } | null;
  repo: { remote: string; branch: string; head: string };
  links: SummaryLinks;
  summary: SummarySummary;
  files: string[];
  review: { approved: true; approvedAt: Date; edited: boolean };
}

export interface ApiKeyDoc {
  _id: ObjectId;
  userId: string;
  name: string;
  // The first characters, to tell keys apart on the page; the key itself is never kept, only its SHA-256.
  prefix: string;
  hash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  lastClient: string | null;
  revokedAt: Date | null;
}

export const events = (): Collection<EventDoc> => db().collection<EventDoc>("memory_events");
export const memories = (): Collection<MemoryDoc> => db().collection<MemoryDoc>("memories");
export const summaries = (): Collection<SummaryDoc> => db().collection<SummaryDoc>("memory_summaries");
export const audits = (): Collection<AuditDoc> => db().collection<AuditDoc>("memory_audit");
export const apiKeys = (): Collection<ApiKeyDoc> => db().collection<ApiKeyDoc>("api_keys");
export const projects = (): Collection<ProjectDoc> => db().collection<ProjectDoc>("projects");
export const projectMembers = (): Collection<ProjectMemberDoc> => db().collection<ProjectMemberDoc>("project_members");
export const summaryRevisions = (): Collection<SummaryRevisionDoc> =>
  db().collection<SummaryRevisionDoc>("summary_revisions");

export const VECTOR_INDEX = "memories_embedding";
