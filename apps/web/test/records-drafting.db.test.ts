// Drafting off the request, once per session: the events answer at once while a slow model drafts, a retried or
// repeated end event never drafts the same session twice, and the raw text (transcripts and compaction summaries too)
// stays until the TTL, drafted once. The provider here is slow and never says the same thing twice, as a real model would.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_drafting");
process.env.MEMORY_AI_PROVIDER = "stub";

// The fake model: it counts its calls, never says the same thing twice, and takes as long as the test says. While
// `held` is set it waits for the test to let it go.
const model = vi.hoisted(() => ({ calls: 0, held: null as Promise<void> | null, delayMs: 300 }));
vi.mock("../server/ai/provider.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/ai/provider.ts")>();
  return {
    ...original,
    provider: () => ({
      ...original.provider(),
      draftRecords: async () => {
        const call = ++model.calls;
        await (model.held ?? new Promise((resolve) => setTimeout(resolve, model.delayMs)));
        return [{ kind: "summary" as const, title: `Take ${call}`, text: `Drafted on call ${call}, worded afresh.` }];
      },
    }),
  };
});

const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { draftPending, ingest } = await import("../server/memory/ingest.ts");
const { draftClaims, events, records } = await import("../server/collections.ts");

const principal = { kind: "key" as const, userId: "drafting-user", keyId: "k1", label: "test", client: null };
const project = "github.com/acme/drafting";
let n = 0;
const event = (sessionID: string, kind: string, payload: Record<string, unknown>) => ({
  v: 1,
  id: `d-${++n}`,
  sessionID,
  scope: { project },
  kind,
  payload,
  ts: Date.now() + n,
});
const session = (sessionID: string) => [
  event(sessionID, "session", { event: "start", git: { remote: project, branch: "main" } }),
  event(sessionID, "prompt", { role: "user", text: "Add retries to the payment client." }),
  event(sessionID, "assistant", { role: "assistant", text: "Added retries with backoff." }),
  event(sessionID, "transcript", {
    trigger: "auto",
    messages: [
      { role: "user", text: "Add retries to the payment client." },
      { role: "assistant", text: "Added retries with backoff." },
    ],
  }),
  event(sessionID, "event", { type: "compact_summary", text: "Retries were added with backoff." }),
  event(sessionID, "session", { event: "end", reason: "prompt_input_exit" }),
];

beforeAll(async () => {
  await ensureIndexes();
});
afterAll(async () => {
  await draftPending();
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("drafting after the answer", () => {
  it("answers before the model has finished, and drafts once the events are in", async () => {
    model.calls = 0;
    const release = hold();
    const answer = await ingest(principal, session("s-fast"));
    expect(answer.accepted).toBe(6);
    // The answer is back while the model is still held: nothing drafted yet.
    expect(await records().countDocuments({ sessionID: "s-fast" })).toBe(0);
    release();
    await draftPending();
    expect(await records().countDocuments({ sessionID: "s-fast" })).toBe(1);
    expect(model.calls).toBe(1);
  });

  it("keeps the transcript's messages, the compaction summary and the rest of the text, marked drafted", async () => {
    const stored = await events().find({ sessionID: "s-fast" }).toArray();
    const transcript = stored.find((e) => e.kind === "transcript");
    expect((transcript?.payload.messages as unknown[] | undefined)?.length).toBeGreaterThan(0);
    expect(String(stored.find((e) => e.kind === "event")?.payload.text ?? "")).not.toBe("");
    for (const kind of ["prompt", "assistant"])
      expect(String(stored.find((e) => e.kind === kind)?.payload.text ?? "")).not.toBe("");
    expect(stored.every((e) => e.draftedAt)).toBe(true);
  });
});

// Holds the model until the returned function is called.
function hold(): () => void {
  let release: () => void = () => undefined;
  model.held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    model.held = null;
    release();
  };
}

describe("a session is drafted once", () => {
  it("drafts once when the client retries the batch while the first drafting is still running", async () => {
    model.calls = 0;
    const release = hold();
    const batch = session("s-retry");
    await ingest(principal, batch);
    // The client gave up waiting and sent the same batch again, twice, while the model was still drafting.
    const [retry, again] = await Promise.all([ingest(principal, batch), ingest(principal, batch)]);
    expect(retry.duplicates).toBe(6);
    expect(again.duplicates).toBe(6);
    release();
    await draftPending();
    expect(model.calls).toBe(1);
    expect(await records().countDocuments({ sessionID: "s-retry" })).toBe(1);
    expect(await draftClaims().findOne({ drafting: true })).toBeNull();
  });

  it("drafts once when several end events for the same session arrive at the same moment", async () => {
    model.calls = 0;
    const [start, prompt, reply] = session("s-twice");
    const end = () => event("s-twice", "session", { event: "end", reason: "other" });
    await ingest(principal, [start!, prompt!, reply!]);
    const release = hold();
    await Promise.all([ingest(principal, [end()]), ingest(principal, [end()]), ingest(principal, [end()])]);
    release();
    await draftPending();
    expect(model.calls).toBe(1);
    expect(await records().countDocuments({ sessionID: "s-twice" })).toBe(1);
  });

  it("drafts what arrived while it was drafting, once more, after it finishes", async () => {
    model.calls = 0;
    const release = hold();
    await ingest(principal, session("s-resumed"));
    // The model is drafting what it read; then the session was resumed and ended again before it finished.
    while (model.calls < 1) await new Promise((resolve) => setTimeout(resolve, 20));
    await ingest(principal, [
      event("s-resumed", "prompt", { role: "user", text: "Now add a circuit breaker." }),
      event("s-resumed", "session", { event: "end", reason: "prompt_input_exit" }),
    ]);
    release();
    await draftPending();
    expect(model.calls).toBe(2);
    expect(await records().countDocuments({ sessionID: "s-resumed" })).toBe(2);
    const left = await events().find({ sessionID: "s-resumed", kind: "prompt" }).toArray();
    expect(left.every((e) => String(e.payload.text).length > 0 && e.draftedAt)).toBe(true);
  });

  it("does nothing for an end event replayed after drafting finished", async () => {
    model.calls = 0;
    await ingest(principal, [event("s-fast", "session", { event: "end", reason: "other" })]);
    await draftPending();
    expect(model.calls).toBe(0);
    expect(await records().countDocuments({ sessionID: "s-fast" })).toBe(1);
  });
});
