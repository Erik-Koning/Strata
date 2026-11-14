// The documents the app keeps, and a typed handle on each collection. Only the API touches these.
import type {
  HandoffStatus,
  MemoryKind,
  MemoryStatus,
  Person,
  RecordedTest,
  RepoState,
  Scope,
  TimelineEntry,
  TrustLevel,
} from "@strata/contracts";
import type { Collection, ObjectId } from "mongodb";
import type { Role } from "./access.ts";
import { db } from "./db.ts";

// Raw capture, as the clients sent it (redacted again on the way in). Deduped on id; expires after 30 days, and once
// records are drafted, the text of prompts, replies and transcripts goes as soon as their session is drafted.
// Documents from before contract version 1 have no v, promptID or known: read them as 1, null and true.
export interface EventDoc {
  _id?: ObjectId;
  // The contract version the client wrote it to.
  v: number;
  id: string;
  sessionID: string;
  scope: Scope;
  // An EventKind, or a newer kind kept as it came until this API learns it.
  kind: string;
  payload: Record<string, unknown>;
  // The user prompt the event belongs to, so a turn's prompt, tool calls and reply group together.
  promptID: string | null;
  // Envelope fields from a newer client that this API doesn't name yet, kept as they came.
  ext?: Record<string, unknown>;
  // Whether this API understood it on arrival: a known kind at a known version, its payload checked.
  known: boolean;
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
  // Which model made `embedding`, as provider:model:dimensions. Recall compares only vectors from the active model;
  // `pnpm db:reembed` brings the rest over. Missing on memories from before it was kept (stub vectors, stamped by
  // `pnpm db:indexes`).
  embeddingModel?: string;
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
    | "memory.correct"
    | "handoff.create"
    | "handoff.edit"
    | "handoff.approve"
    | "handoff.read"
    | "handoff.claim"
    | "handoff.test"
    | "handoff.complete"
    | "handoff.revoke"
    | "handoff.denied"
    | "key.create"
    | "key.revoke"
    | "invite.create"
    | "invite.revoke"
    | "invite.accept"
    | "member.role"
    | "member.suspend"
    | "member.restore"
    | "team.create"
    | "team.delete"
    | "team.member";
  targetIds: string[];
  scope: Partial<Scope> | null;
  detail: Record<string, unknown>;
  ts: Date;
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

// What a person may see beyond their own memory: their role, and whether an admin suspended them. Keyed by the
// account's id. An account with no member document is an engineer (accounts made before roles existed).
export interface MemberDoc {
  _id: string;
  role: Role;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// A group of people, and the managers who see its shared work. A person can be in several teams.
export interface TeamDoc {
  _id: ObjectId;
  name: string;
  memberIds: string[];
  managerIds: string[];
  createdAt: Date;
}

// The only way to get an account: an admin (or the invite script) makes one for an email and a role. The link carries
// the token; only its SHA-256 is kept. It works once, for that email, until it expires.
export interface InviteDoc {
  _id: ObjectId;
  email: string;
  role: Role;
  teamIds: string[];
  hash: string;
  createdBy: AuditDoc["actor"];
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  revokedAt: Date | null;
}

// A Relay handoff: one task's checkpoint, from its sender to one recipient (packages/contracts/src/handoff.ts has the
// lifecycle and the rules). Only the sender reads a draft; the recipient reads it once approved and until revoked.
export interface HandoffDoc {
  _id: ObjectId;
  org: string;
  project: string;
  title: string;
  summary: string;
  completed: string[];
  remaining: string[];
  blockers: string[];
  failedApproaches: string[];
  decisions: string[];
  changedFiles: string[];
  nextAction: string;
  testCommands: string[];
  repo: RepoState | null;
  sourceSessionID: string | null;
  status: HandoffStatus;
  sender: Person;
  recipient: Person | null;
  // Memories the sender shared with it, all theirs; re-checked on every read.
  memoryIds: ObjectId[];
  tests: (Omit<RecordedTest, "at"> & { at: Date })[];
  continuation: {
    sessionID: string | null;
    summary: string;
    completed: string[];
    changedFiles: string[];
    claimRepo: RepoState | null;
    repo: RepoState | null;
    verified: boolean;
  } | null;
  timeline: (Omit<TimelineEntry, "at"> & { at: Date })[];
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  claimedAt: Date | null;
  completedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

export const events = (): Collection<EventDoc> => db().collection<EventDoc>("memory_events");
export const memories = (): Collection<MemoryDoc> => db().collection<MemoryDoc>("memories");
export const summaries = (): Collection<SummaryDoc> => db().collection<SummaryDoc>("memory_summaries");
export const audits = (): Collection<AuditDoc> => db().collection<AuditDoc>("memory_audit");
export const apiKeys = (): Collection<ApiKeyDoc> => db().collection<ApiKeyDoc>("api_keys");
export const members = (): Collection<MemberDoc> => db().collection<MemberDoc>("members");
export const teams = (): Collection<TeamDoc> => db().collection<TeamDoc>("teams");
export const invites = (): Collection<InviteDoc> => db().collection<InviteDoc>("invites");

export const handoffs = (): Collection<HandoffDoc> => db().collection<HandoffDoc>("handoffs");

export const VECTOR_INDEX = "memories_embedding";
