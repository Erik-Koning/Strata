// Every shape that crosses the wire between a client (the Claude Code plugin, the OpenCode plugin) and the API. Both
// sides import these; nothing is typed twice. The API validates each body at its edge with them.
import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_:.-]+$/, "letters, digits and _ : . - only");
const sessionID = z.string().min(1).max(200);

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

export const EVENT_KINDS = ["prompt", "assistant", "tool", "transcript", "session", "event"] as const;
export const MEMORY_KINDS = ["preference", "fact", "decision", "convention", "summary"] as const;
export const MEMORY_STATUSES = ["candidate", "active", "superseded", "archived"] as const;
// How far a memory is trusted, by where it came from: the user said it, a tool saved it, or a job inferred it.
export const TRUST_LEVELS = ["explicit", "observed", "inferred"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type TrustLevel = (typeof TRUST_LEVELS)[number];

// POST /api/memory/events
export const MemoryEvent = z.object({
  id,
  sessionID,
  scope: WireScope,
  kind: z.enum(EVENT_KINDS),
  payload: z.record(z.string(), z.unknown()),
  ts: z.union([z.string().datetime({ offset: true }), z.number().int().positive()]),
});
export type MemoryEvent = z.infer<typeof MemoryEvent>;
export const EventsRequest = z.object({ batch: z.array(MemoryEvent).min(1).max(500) });
export type EventsRequest = z.infer<typeof EventsRequest>;
export const EventsResponse = z.object({ accepted: z.number().int(), duplicates: z.number().int() });
export type EventsResponse = z.infer<typeof EventsResponse>;

export const MemoryHit = z.object({ _id: z.string(), kind: z.enum(MEMORY_KINDS), text: z.string() });
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
export const TranscriptMessage = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  text: z.string().max(200_000),
  id: z.string().max(200).optional(),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessage>;
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

// Every error, from every route.
export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), issues: z.array(z.unknown()).optional() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// What a client says it is, on every request (x-memory-client), so the app can show which clients are connected.
export const CLIENT_HEADER = "x-memory-client";
