// Every shape that crosses the wire between a client (the Claude Code plugin, the OpenCode plugin) and the API. Both
// sides import these; nothing is typed twice. The API validates each body at its edge with them.
//
// How it changes without breaking anyone (docs/architecture.md has the reasons):
//
//   1. Every event carries the contract version it was written to, `v`. This is version 1 (version.ts).
//   2. Within a version the contract only grows: a new optional field, a new event kind, a new value in an open list.
//      Nothing is renamed, removed, retyped or made required; that's a new version.
//   3. Readers tolerate what they don't know. Payloads and the envelope keep fields they don't name. The API stores an
//      event of a kind, or a version, it doesn't know yet, and acts on it once it does. Lists that grow (openName) take
//      any short name, so a newer client's value never fails an older API.
//   4. One bad event never sinks a batch: the API answers 202 and lists each event it refused, and why.
//   5. Lists that tell the API what to do (a memory's kind on save) stay closed: an API that doesn't know a value
//      answers 400 rather than guess.
import { z } from "zod";
import { CONTRACT_VERSION, MIN_CONTRACT_VERSION } from "./version.ts";

export { CONTRACT_VERSION, MIN_CONTRACT_VERSION };

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_:.-]+$/, "letters, digits and _ : . - only");
const sessionID = z.string().min(1).max(200);

// A name from a list that grows. Whoever writes uses the known values (the type says which); whoever reads takes any
// short lower-case name and treats one it doesn't know as just that: unknown, not wrong.
const NAME = /^[a-z][a-z0-9_.-]{0,39}$/;
export const openName = <const T extends readonly [string, ...string[]]>(_known: T) =>
  z.string().regex(NAME, "a short lower-case name") as unknown as z.ZodType<T[number] | (string & {}), string>;

// Whose memory: an organisation, a project in it, and a person. A client names the project; the API fills the org and
// the user from the token, and refuses a request that names others the token doesn't cover.
export const Scope = z.object({
  org: z.string().min(1).max(120),
  project: z.string().min(1).max(200),
  user: z.string().min(1).max(120),
});
export type Scope = z.infer<typeof Scope>;
export const WireScope = Scope.partial({ org: true, user: true });
export type WireScope = z.infer<typeof WireScope>;

export const MEMORY_KINDS = ["preference", "fact", "decision", "convention", "summary"] as const;
export const MEMORY_STATUSES = ["candidate", "active", "superseded", "archived"] as const;
// How far a memory is trusted, by where it came from: the user said it, a tool saved it, or a job inferred it.
export const TRUST_LEVELS = ["explicit", "observed", "inferred"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type TrustLevel = (typeof TRUST_LEVELS)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Events: POST /api/memory/events
// ---------------------------------------------------------------------------------------------------------------------

const longText = z.string().max(200_000);

// One message of a transcript, as the compress route and the transcript event take it.
export const TranscriptMessage = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  text: longText,
  id: z.string().max(200).optional(),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessage>;

// A link to something outside Strata: a ticket, a pull request, a commit, a doc. Generic on purpose, so a new tracker
// is data and not a contract change. `system` is left out when the client can't tell: PAY-412 could be Jira or Linear.
export const REF_TYPES = ["ticket", "pr", "issue", "commit", "doc"] as const;
export const REF_SYSTEMS = ["github", "gitlab", "jira", "linear"] as const;
export const Ref = z.looseObject({
  type: openName(REF_TYPES),
  id: z.string().min(1).max(300),
  system: openName(REF_SYSTEMS).optional(),
  url: z.url().max(2000).optional(),
});
export type Ref = z.input<typeof Ref>;

// Where the work is happening. Sent when a session starts, and again when its branch or commit changes.
export const GitContext = z.looseObject({
  // The origin, normalized: github.com/acme/app.
  remote: z.string().max(500).optional(),
  branch: z.string().max(300).optional(),
  head: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .optional(),
  // The working folder inside the repository ("" at its root), which tells a monorepo's products apart.
  path: z.string().max(500).optional(),
});
export type GitContext = z.input<typeof GitContext>;

// prompt: what the user typed, in their own turn. Only this kind becomes an active memory by itself.
export const PromptPayload = z.looseObject({
  role: z.literal("user"),
  text: longText,
  // The client's own id for the message, where it has one (OpenCode). Claude Code's turn id travels as promptID.
  messageID: z.string().max(200).optional(),
});

// assistant: what the agent answered.
export const AssistantPayload = z.looseObject({
  role: z.literal("assistant"),
  text: longText,
  messageID: z.string().max(200).optional(),
});

// tool: a tool call's name and outcome, never what went in or came out. A shell command adds what kind of command it
// was (CommandSignal), which is what "where engineering time goes" is measured from.
export const TOOL_STATUSES = ["ok", "error", "interrupted"] as const;
export const COMMAND_CLASSES = ["test", "build", "typecheck", "lint", "format", "install", "git", "other"] as const;
export type CommandClass = (typeof COMMAND_CLASSES)[number];
export const CommandSignal = z.looseObject({
  class: openName(COMMAND_CLASSES),
  // The exit code, when the client knows it (a failed command's).
  exit: z.number().int().min(0).max(255).optional(),
  // A hash of the command, redacted and normalized (signals.ts), so the same command run again can be counted without
  // the command ever leaving the machine. Left out for "other".
  fp: z
    .string()
    .regex(/^[0-9a-f]{16,64}$/)
    .optional(),
  // Started in the background: its time is the time to start it, not to run it.
  background: z.boolean().optional(),
});
export const ToolPayload = z.looseObject({
  tool: z.string().min(1).max(200),
  status: openName(TOOL_STATUSES),
  // How long the call ran, without permission prompts.
  ms: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 3_600_000)
    .optional(),
  toolUseID: z.string().max(200).optional(),
  command: CommandSignal.optional(),
});

// transcript: the conversation before a compaction, what the user typed and what the agent wrote, no tool output.
export const TranscriptPayload = z.looseObject({
  trigger: z.string().max(40).nullable().optional(),
  messages: z.array(TranscriptMessage).max(5000),
});

// session: its start, its end, and a change of branch or commit in between ("context").
export const SESSION_EVENTS = ["start", "context", "end"] as const;
export const SessionPayload = z.looseObject({
  event: openName(SESSION_EVENTS),
  // start: how it began (startup, resume, clear, compact, fork).
  source: z.string().max(40).optional(),
  // end: why it ended.
  reason: z.string().max(200).nullable().optional(),
  // start and context: where the work is, and the tickets the branch names.
  git: GitContext.optional(),
  refs: z.array(Ref).max(20).optional(),
});

// event: a small signal with a type of its own; today the summary Claude Code made at a compaction.
export const SIGNAL_TYPES = ["compact_summary"] as const;
export const EventPayload = z.looseObject({
  type: openName(SIGNAL_TYPES),
  text: longText.optional(),
  trigger: z.string().max(40).nullable().optional(),
});

// finding: what the agent logs the moment it runs into it (the record_finding tool). It becomes a draft record that
// only its author sees until they approve it.
export const FINDING_TYPES = ["insight", "workflow", "pain_point", "context_gap"] as const;
export const FindingPayload = z.looseObject({
  type: openName(FINDING_TYPES),
  text: z.string().min(1).max(4000),
  refs: z.array(Ref).max(20).optional(),
});

// Each kind this version knows, and the payload it carries.
export const PAYLOADS = {
  prompt: PromptPayload,
  assistant: AssistantPayload,
  tool: ToolPayload,
  transcript: TranscriptPayload,
  session: SessionPayload,
  event: EventPayload,
  finding: FindingPayload,
} as const;
export type EventKind = keyof typeof PAYLOADS;
export const EVENT_KINDS = Object.keys(PAYLOADS) as EventKind[];
export type PayloadOf<K extends EventKind> = z.input<(typeof PAYLOADS)[K]>;

// The envelope every event travels in. `kind` says which payload it carries.
export const EventEnvelope = z.looseObject({
  v: z.number().int().min(1).max(10_000).default(1),
  id,
  sessionID,
  scope: WireScope,
  kind: z.string().regex(NAME, "a short lower-case name"),
  payload: z.looseObject({}),
  ts: z.union([z.string().datetime({ offset: true }), z.number().int().positive()]),
  // The user prompt this event belongs to (Claude Code's prompt_id), so a turn's prompt, tool calls and reply group.
  promptID: z.string().min(1).max(200).optional(),
});
// An event as the API has it after the envelope is checked.
export type WireEvent = z.output<typeof EventEnvelope>;

// An event as a client writes it: the envelope around one payload of a known kind.
export interface EventFields {
  v?: number;
  id: string;
  sessionID: string;
  scope: WireScope;
  ts: string | number;
  promptID?: string;
}
export type EventOf<K extends EventKind> = EventFields & { kind: K; payload: PayloadOf<K> };
export type MemoryEvent = { [K in EventKind]: EventOf<K> }[EventKind];

// The longest one event may be, as JSON. A transcript is the largest thing a client sends.
export const MAX_EVENT_CHARS = 4_000_000;
export const MAX_BATCH = 500;

// Each event in a batch is checked on its own (parseEvent), so the batch itself is only a list.
export const EventsRequest = z.object({ batch: z.array(z.unknown()).min(1).max(MAX_BATCH) });
export type EventsRequest = z.infer<typeof EventsRequest>;

export const REJECTION_CODES = ["invalid", "too_large", "upgrade_required"] as const;
export const Rejection = z.object({
  // Where it was in the batch, and its id when it had a readable one.
  index: z.number().int().min(0),
  id: z.string().optional(),
  code: openName(REJECTION_CODES),
  message: z.string(),
});
export type Rejection = z.infer<typeof Rejection>;
export const EventsResponse = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  // The events refused, each on its own. An API from before version 1 leaves this out and refuses a bad batch whole.
  rejected: z.array(Rejection).optional(),
});
export type EventsResponse = z.infer<typeof EventsResponse>;

export type ParsedEvent =
  // known: a kind and a version this side understands, its payload checked. Otherwise it's kept as it came.
  | { ok: true; event: WireEvent; known: boolean }
  | { ok: false; code: (typeof REJECTION_CODES)[number]; message: string; id?: string };

const describe = (issues: z.core.$ZodIssue[]): string =>
  issues.map((i) => `${i.path.map(String).join(".") || "event"}: ${i.message}`).join("; ");

// One event, as the API checks it: the envelope always; the payload when it knows the kind at that version.
export function parseEvent(raw: unknown): ParsedEvent {
  const rawId = (raw as { id?: unknown } | null)?.id;
  const given = typeof rawId === "string" ? rawId.slice(0, 80) : undefined;
  let size = 0;
  try {
    size = JSON.stringify(raw)?.length ?? 0;
  } catch {
    return { ok: false, code: "invalid", message: "event: not plain JSON", id: given };
  }
  if (size > MAX_EVENT_CHARS)
    return { ok: false, code: "too_large", message: `event: over ${MAX_EVENT_CHARS} characters as JSON`, id: given };
  const envelope = EventEnvelope.safeParse(raw);
  if (!envelope.success) return { ok: false, code: "invalid", message: describe(envelope.error.issues), id: given };
  const event = envelope.data;
  if (event.v < MIN_CONTRACT_VERSION)
    return {
      ok: false,
      code: "upgrade_required",
      message: `version ${event.v} is older than ${MIN_CONTRACT_VERSION}, the oldest this API accepts`,
      id: event.id,
    };
  if (event.v > CONTRACT_VERSION || !Object.hasOwn(PAYLOADS, event.kind)) return { ok: true, event, known: false };
  const payload = PAYLOADS[event.kind as EventKind].safeParse(event.payload);
  if (!payload.success)
    return {
      ok: false,
      code: "invalid",
      message: describe(payload.error.issues.map((i) => ({ ...i, path: ["payload", ...i.path] }))),
      id: event.id,
    };
  return { ok: true, event: { ...event, payload: payload.data }, known: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------------------------------

// What the API answers about a memory. `kind` is read as an open name, so a client never breaks on a kind added later.
export const MemoryHit = z.object({ _id: z.string(), kind: openName(MEMORY_KINDS), text: z.string() });
export type MemoryHit = z.infer<typeof MemoryHit>;

// POST /api/memory/recall
export const RecallRequest = z.object({
  sessionID,
  scope: WireScope,
  query: z.string().min(1).max(8000),
  k: z.number().int().min(1).max(20).default(6),
});
export type RecallRequest = z.infer<typeof RecallRequest>;
export const RecallResponse = z.object({ memories: z.array(MemoryHit) });
export type RecallResponse = z.infer<typeof RecallResponse>;

// GET /api/memory/frozen?sessionID=…&project=…[&org=…&user=…]
export const FrozenQuery = z.object({
  sessionID,
  project: z.string().min(1).max(200),
  org: z.string().min(1).max(120).optional(),
  user: z.string().min(1).max(120).optional(),
});
export type FrozenQuery = z.infer<typeof FrozenQuery>;
export const FrozenResponse = RecallResponse;
export type FrozenResponse = RecallResponse;

// POST /api/memory/compress
export const CompressRequest = z.object({
  sessionID,
  scope: WireScope,
  messages: z.array(TranscriptMessage).max(5000),
});
export type CompressRequest = z.infer<typeof CompressRequest>;
export const CompressResponse = z.object({ summary: z.string().nullable() });
export type CompressResponse = z.infer<typeof CompressResponse>;

// POST /api/memory/forget: by ids, or everything a query matches. dryRun says what would go, and removes nothing.
export const ForgetRequest = z
  .object({
    scope: WireScope,
    ids: z
      .array(z.string().regex(/^[a-f0-9]{24}$/))
      .max(500)
      .optional(),
    query: z.string().min(1).max(500).optional(),
    dryRun: z.boolean().default(false),
  })
  .refine((body) => Boolean(body.ids?.length) !== Boolean(body.query), { message: "ids or query, one of them" });
export type ForgetRequest = z.infer<typeof ForgetRequest>;
export const ForgetResponse = z.object({
  dryRun: z.boolean(),
  ids: z.array(z.string()),
  memories: z.number().int(),
  summaries: z.number().int(),
  events: z.number().int(),
});
export type ForgetResponse = z.infer<typeof ForgetResponse>;

// POST /api/memory/save: a memory the user asked for in so many words (the memory_save tool).
export const SaveRequest = z.object({
  sessionID: sessionID.optional(),
  scope: WireScope,
  text: z.string().min(1).max(4000),
  kind: z.enum(MEMORY_KINDS).default("fact"),
});
export type SaveRequest = z.infer<typeof SaveRequest>;
export const SaveResponse = z.object({ memory: MemoryHit });
export type SaveResponse = z.infer<typeof SaveResponse>;

// Every error, from every route. `code` is an open name: a client acts on the codes it knows (upgrade_required,
// invalid, unauthorized) and treats any other as a failure to retry later.
export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), issues: z.array(z.unknown()).optional() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// What a client says it is, on every request (x-memory-client), so the app can show which clients are connected.
export const CLIENT_HEADER = "x-memory-client";
