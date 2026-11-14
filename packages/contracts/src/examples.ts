// One event of each kind, as a version-1 client writes it. The contract's tests check that each parses as known, the
// API's tests post them all and expect every one accepted, and the plugin's tests check that what its hooks queue
// parses the same way. Change a shape on one side only and one of the three fails.
import type { MemoryEvent } from "./schemas.ts";

const base = { v: 1, sessionID: "example-session", scope: { project: "github.com/acme/billing" } } as const;
const ts = "2026-11-14T09:30:00.000Z";

export const EXAMPLE_EVENTS: MemoryEvent[] = [
  {
    ...base,
    id: "01JCEXAMPLE0000000000000001",
    ts,
    kind: "session",
    payload: {
      event: "start",
      source: "startup",
      git: {
        remote: "github.com/acme/billing",
        branch: "feat/PAY-412-invoice-retry",
        head: "3f9c2e1a7b4d",
        path: "services/invoices",
      },
      refs: [{ type: "ticket", id: "PAY-412" }],
    },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000002",
    ts,
    promptID: "550e8400-e29b-41d4-a716-446655440000",
    kind: "prompt",
    payload: { role: "user", text: "Add retry with backoff to the invoice sync worker." },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000003",
    ts,
    promptID: "550e8400-e29b-41d4-a716-446655440000",
    kind: "tool",
    payload: {
      tool: "Bash",
      status: "error",
      ms: 4187,
      toolUseID: "toolu_01ABC123",
      command: { class: "test", exit: 1, fp: "9b2c4e6f8a0d1c3e" },
    },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000004",
    ts,
    promptID: "550e8400-e29b-41d4-a716-446655440000",
    kind: "tool",
    payload: { tool: "Edit", status: "ok", ms: 12 },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000005",
    ts,
    kind: "transcript",
    payload: {
      trigger: "auto",
      messages: [
        { role: "user", text: "Add retry with backoff.", id: "u1" },
        { role: "assistant", text: "Added it, with three tests.", id: "a1" },
      ],
    },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000006",
    ts,
    kind: "event",
    payload: { type: "compact_summary", trigger: "auto", text: "Retry with backoff added; tests pass." },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000007",
    ts,
    promptID: "550e8400-e29b-41d4-a716-446655440000",
    kind: "finding",
    payload: {
      type: "context_gap",
      text: "Nothing records why the job queue delivers at least once.",
      refs: [{ type: "ticket", id: "PAY-412" }],
    },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000008",
    ts,
    promptID: "550e8400-e29b-41d4-a716-446655440000",
    kind: "assistant",
    payload: { role: "assistant", text: "Retry with backoff is in, and the timeout comes from config." },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000009",
    ts,
    kind: "session",
    payload: { event: "context", git: { branch: "feat/PAY-412-invoice-retry", head: "8d1e0b9c4a2f" } },
  },
  {
    ...base,
    id: "01JCEXAMPLE0000000000000010",
    ts,
    kind: "session",
    payload: { event: "end", reason: "prompt_input_exit" },
  },
];
