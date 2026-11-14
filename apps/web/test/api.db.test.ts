// The memory API end to end, through its route handlers, on a database of its own on MONGODB_URI's server,
// emptied afterwards (test-database.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_test");
process.env.MEMORY_API_TOKEN = "test-service-token-0123456789abcdef";
process.env.MEMORY_AI_PROVIDER = "stub";

const { EXAMPLE_EVENTS } = await import("@strata/contracts/examples");
const { postEvents, postRecall, getFrozen, postCompress, postForget, postSave } = await import(
  "../server/memory/routes.ts"
);
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { createKey } = await import("../server/keys.ts");
const { memories, events, summaries, audits } = await import("../server/collections.ts");

const SERVICE = process.env.MEMORY_API_TOKEN;
const call = (
  handler: (r: Request) => Promise<Response>,
  init: { token?: string | null; body?: unknown; query?: string; method?: string },
) =>
  handler(
    new Request(`http://test/api/memory/x${init.query ?? ""}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        "x-memory-client": "test/1",
        ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? SERVICE}` }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );

const scope = { project: "acme/web", user: "ada" };
let n = 0;
const event = (kind: string, payload: Record<string, unknown>, session = "s1") => ({
  id: `e-${++n}-${Date.now()}`,
  sessionID: session,
  scope,
  kind,
  payload,
  ts: Date.now(),
});

beforeAll(async () => {
  await ensureIndexes({ wait: true, timeoutMs: 120_000 });
});
afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("auth", () => {
  it("answers 401 with no token or a wrong one, before reading the body", async () => {
    expect((await call(postRecall, { token: null, body: "not json" })).status).toBe(401);
    expect((await call(postRecall, { token: "am_nope_nope_nope_nope_nope_nope_nope", body: {} })).status).toBe(401);
  });

  it("lets a person's key act in their own scope, and no one else's", async () => {
    const { key, doc } = await createKey("grace", "laptop");
    const own = await call(postSave, {
      token: key,
      body: { scope: { project: "p" }, text: "Grace prefers tabs.", kind: "preference" },
    });
    expect(own.status).toBe(201);
    const stored = await memories().findOne({ "scope.user": "grace" });
    expect(stored?.scope).toEqual({ org: "default", user: "grace", project: "p" });
    const other = await call(postSave, {
      token: key,
      body: { scope: { project: "p", user: "ada" }, text: "x".repeat(10) },
    });
    expect(other.status).toBe(403);
    expect(doc.hash).not.toContain(key);
  });

  it("answers a malformed body with 400 and the contract's complaint", async () => {
    const res = await call(postRecall, { body: { scope: {} } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid");
  });
});

describe("events", () => {
  it("stores each event once, however often it's sent", async () => {
    const batch = [event("tool", { tool: "Bash", status: "ok" }), event("tool", { tool: "Read", status: "ok" })];
    expect(await (await call(postEvents, { body: { batch } })).json()).toEqual({
      accepted: 2,
      duplicates: 0,
      rejected: [],
    });
    const again = await call(postEvents, { body: { batch } });
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({ accepted: 0, duplicates: 2, rejected: [] });
    expect(await events().countDocuments({ id: { $in: batch.map((b) => b.id) } })).toBe(2);
  });

  it("redacts again on the way in, whatever the client did", async () => {
    const e = event("prompt", {
      role: "user",
      text: "deploy with GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    await call(postEvents, { body: { batch: [e] } });
    const stored = await events().findOne({ id: e.id });
    expect(JSON.stringify(stored?.payload)).not.toContain("ghp_");
    expect(String(stored?.payload.text)).toContain("[REDACTED:");
  });

  it("accepts one event of every kind, as the contract's examples write them", async () => {
    const res = await call(postEvents, { body: { batch: EXAMPLE_EVENTS } });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: EXAMPLE_EVENTS.length, duplicates: 0, rejected: [] });
    const stored = await events().findOne({ id: EXAMPLE_EVENTS[1]?.id });
    expect(stored).toMatchObject({ v: 1, known: true, promptID: "550e8400-e29b-41d4-a716-446655440000" });
  });

  it("refuses a bad event on its own, says why, and stores the rest", async () => {
    const good = event("tool", { tool: "Read", status: "ok" });
    const bad = event("prompt", { role: "user" });
    const res = await call(postEvents, { body: { batch: [good, bad, { nonsense: true }] } });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(body.rejected).toEqual([
      { index: 1, id: bad.id, code: "invalid", message: expect.stringContaining("payload.text") },
      { index: 2, code: "invalid", message: expect.any(String) },
    ]);
    expect(await events().countDocuments({ id: { $in: [good.id, bad.id] } })).toBe(1);
  });

  it("keeps a kind it doesn't know yet as it came, unread, with any envelope fields it doesn't name", async () => {
    const newer = { ...event("screenshot", { width: 1280 }), agent: "explorer" };
    expect(await (await call(postEvents, { body: { batch: [newer] } })).json()).toMatchObject({ accepted: 1 });
    expect(await events().findOne({ id: newer.id })).toMatchObject({
      kind: "screenshot",
      known: false,
      payload: { width: 1280 },
      ext: { agent: "explorer" },
    });
  });

  it("links a memory to the turn it came from", async () => {
    const turn = {
      ...event("prompt", { role: "user", text: "Remember that invoices round per line." }),
      promptID: "p-42",
    };
    await call(postEvents, { body: { batch: [turn] } });
    const memory = await memories().findOne({ text: "Invoices round per line." });
    expect(memory?.provenance).toMatchObject({ messageID: "p-42", eventId: turn.id });
  });

  it("promotes only what the user said in their own turn", async () => {
    await call(postEvents, {
      body: {
        batch: [
          event("prompt", { role: "user", text: "Remember that staging deploys from the release branch." }),
          event("assistant", { role: "assistant", text: "In this project we always squash merges." }),
        ],
      },
    });
    const user = await memories().findOne({ text: "Staging deploys from the release branch." });
    const assistant = await memories().findOne({ text: "In this project we always squash merges." });
    expect(user?.status).toBe("active");
    expect(user?.trust).toBe("explicit");
    expect(assistant?.status).toBe("candidate");
    expect(assistant?.provenance.source).toBe("assistant");
  });
});

describe("frozen and recall", () => {
  it("gives the same memories in the same order on every request", async () => {
    const q = `?sessionID=s1&project=acme/web&user=ada`;
    const first = await (await call(getFrozen, { query: q })).text();
    const second = await (await call(getFrozen, { query: q })).text();
    expect(second).toBe(first);
    const ids = (JSON.parse(first).memories as { _id: string }[]).map((m) => m._id);
    expect(ids).toEqual([...ids].sort());
    expect(ids.length).toBeGreaterThan(0);
  });

  it("finds what a message is about, and leaves candidates out", async () => {
    const res = await call(postRecall, {
      body: { sessionID: "s1", scope, query: "which branch does staging deploy from?", k: 3 },
    });
    const { memories: hits } = (await res.json()) as { memories: { text: string }[] };
    expect(hits.map((h) => h.text)).toContain("Staging deploys from the release branch.");
    expect(hits.map((h) => h.text)).not.toContain("In this project we always squash merges.");
  });
});

describe("compress and forget", () => {
  it("summarizes at a compaction, and forgetting a memory takes its event and the summaries made from it", async () => {
    const e = event("prompt", { role: "user", text: "Remember that the cache key includes the tenant." }, "s2");
    await call(postEvents, { body: { batch: [e] } });
    const compressed = await call(postCompress, {
      body: {
        sessionID: "s2",
        scope,
        messages: [
          { role: "user", text: "Fix the cache" },
          { role: "assistant", text: "Fixed." },
        ],
      },
    });
    expect((await compressed.json()).summary).toContain("Fix the cache");
    const memory = await memories().findOne({ text: "The cache key includes the tenant." });
    expect(memory).toBeTruthy();
    const id = memory!._id.toHexString();

    const preview = await (await call(postForget, { body: { scope, ids: [id], dryRun: true } })).json();
    expect(preview).toMatchObject({ dryRun: true, memories: 1, summaries: 1, events: 1 });
    expect(await memories().countDocuments({ _id: memory!._id })).toBe(1);

    const done = await (await call(postForget, { body: { scope, ids: [id] } })).json();
    expect(done).toMatchObject({ dryRun: false, memories: 1, summaries: 1, events: 1 });
    expect(await memories().countDocuments({ _id: memory!._id })).toBe(0);
    expect(await events().countDocuments({ id: e.id })).toBe(0);
    expect(await summaries().countDocuments({ sessionID: "s2" })).toBe(0);
    expect(await audits().countDocuments({ action: "memory.forget", targetIds: id })).toBe(1);
  });

  it("can't forget another person's memory", async () => {
    const grace = await memories().findOne({ "scope.user": "grace" });
    const res = await call(postForget, { body: { scope, ids: [grace!._id.toHexString()] } });
    expect((await res.json()).memories).toBe(0);
    expect(await memories().countDocuments({ _id: grace!._id })).toBe(1);
  });
});
