// The documents the app keeps, and a typed handle on each collection. Only the API touches these.
import type {
  HandoffStatus,
  MemoryKind,
  MemoryStatus,
  Person,
  RecordedTest,
  RecordKind,
  RecordStatus,
  Ref,
  RepoState,
  Scope,
  SummaryLinks,
  SummarySummary,
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
  // Set once the session has been drafted. The raw text stays until the memory_events TTL.
  draftedAt?: Date | null;
  // Set once a tool event's timing is counted in signal_daily (hub/signals.ts), so it's counted once.
  signaledAt?: Date | null;
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
    | "summary.receive"
    | "summary.retract"
    | "record.draft"
    | "record.edit"
    | "record.approve"
    | "record.discard"
    | "invite.create"
    | "invite.revoke"
    | "invite.accept"
    | "member.role"
    | "member.suspend"
    | "member.restore"
    | "team.create"
    | "team.delete"
    | "team.member"
    | "gap.take"
    | "gap.resolve"
    | "gap.reopen";
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

// What the server drafts from a session's events. A draft belongs to its author until approved or discarded;
// approved insights and workflow findings are copied into memories.
export interface RecordDoc {
  _id: ObjectId;
  scope: Scope;
  sessionID: string;
  kind: RecordKind;
  status: RecordStatus;
  title: string | null;
  text: string;
  // A normalized hash for deduping a re-draft of the same session.
  textKey: string;
  refs: Ref[];
  eventIds: string[];
  edited: boolean;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  memoryId: ObjectId | null;
}

// Who is drafting a session right now (records/draft.ts). Claimed with a conditional write before drafting, so a retried
// or repeated end event never drafts the same session twice at once; `again` asks the holder to look once more for
// events that arrived while it worked. Gone 30 days after the last draft.
export interface DraftClaimDoc {
  // org, user, project and session, joined.
  _id: string;
  drafting: boolean;
  token: string | null;
  again: boolean;
  claimedAt: Date;
  doneAt: Date | null;
}

// One approved revision of one session. The highest revision for (userId, sessionId) is the current summary;
// older ones stay for audit. The plugin never sends prompts or replies, so neither is stored.
export interface SummaryRevisionDoc {
  _id?: ObjectId;
  // The contract version the client wrote it to (1 when absent).
  v: number;
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

// The hub: what the team pages read, derived from approved work and from tool timings (server/hub/*).

// A product: one or more repositories, each whole or one folder of it (a monorepo's part). Made automatically, one per
// repository and named after it, the first time the repository is seen; an admin can rename and merge them later. The
// id is a slug made once and never changed, so links to a product keep working.
export interface ProductRepo {
  // The normalized origin: github.com/acme/billing.
  repo: string;
  // The folder inside it ("" for the whole repository).
  path: string;
}
export interface ProductDoc {
  _id: string;
  org: string;
  name: string;
  repos: ProductRepo[];
  // `${repo}#${path}` for each of repos: unique across products, so a repository belongs to one product.
  repoKeys: string[];
  // Set when an admin merges this product into another: links to it lead there.
  mergedInto: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Tool time, per UTC day, product, repository, command class and command fingerprint. Counted from tool events as they
// arrive (and backfilled from the ones still stored), so it outlives the events' 30 days. It carries no person: time
// is measured on tools, never on people.
export interface SignalDailyDoc {
  _id?: ObjectId;
  day: string;
  productId: string | null;
  repo: string;
  class: string;
  // The command's fingerprint; "" for a command of class other, which has none.
  fp: string;
  // A stable key for (repo, class, fp), so a trend survives a product's rename or merge.
  item: string;
  runs: number;
  // Runs that ended in an error, a non-zero exit, or were interrupted.
  failures: number;
  // Runs of a fingerprint already run earlier in the same session.
  reruns: number;
  // Runs with a duration of their own (not started in the background).
  timedRuns: number;
  totalMs: number;
  failedMs: number;
  // Time in re-runs that succeeded (a failed re-run's time is in failedMs).
  rerunMs: number;
  // Every timed run by duration bucket, and the successful first runs alone (hub/time-math.ts).
  hist: Record<string, number>;
  okHist: Record<string, number>;
  updatedAt: Date;
}

// One time a gap came up: in a coding session (from an approved record or summary), or as a question someone asked
// Ask Strata that it couldn't answer. Who asked is never kept.
export interface GapOccurrence {
  sourceId: string;
  from: "agent" | "person";
  sessionId: string | null;
  at: Date;
}

// A context gap across sessions: what agents and people needed and couldn't find, one document per normalized text per
// product. Counts are of sessions and questions, never of people.
export interface GapDoc {
  _id: ObjectId;
  // A hash of the product and the normalized text.
  key: string;
  text: string;
  productId: string | null;
  occurrences: GapOccurrence[];
  // Worked out from occurrences on every write.
  firstSeen: Date;
  lastSeen: Date;
  sessions: number;
  fromAgents: number;
  fromPeople: number;
  sourceIds: string[];
  status: "open" | "resolved";
  ownerId: string | null;
  resolution: { url: string | null; note: string; at: Date } | null;
  createdAt: Date;
  updatedAt: Date;
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
export const records = (): Collection<RecordDoc> => db().collection<RecordDoc>("records");
export const members = (): Collection<MemberDoc> => db().collection<MemberDoc>("members");
export const teams = (): Collection<TeamDoc> => db().collection<TeamDoc>("teams");
export const invites = (): Collection<InviteDoc> => db().collection<InviteDoc>("invites");
export const draftClaims = (): Collection<DraftClaimDoc> => db().collection<DraftClaimDoc>("draft_claims");
export const products = (): Collection<ProductDoc> => db().collection<ProductDoc>("products");
export const signalDaily = (): Collection<SignalDailyDoc> => db().collection<SignalDailyDoc>("signal_daily");
export const gaps = (): Collection<GapDoc> => db().collection<GapDoc>("gaps");

export const handoffs = (): Collection<HandoffDoc> => db().collection<HandoffDoc>("handoffs");

export const VECTOR_INDEX = "memories_embedding";
