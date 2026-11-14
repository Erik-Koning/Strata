// The record pipeline end to end: versioned events in, drafts out, review, approval into memories, raw text gone.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase } from "./test-database.ts";

const name = `records_test_${process.env.A6G_NAMESPACE?.replace(/[^a-z0-9]/gi, "_") ?? randomBytes(4).toString("hex")}`;
const base = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/?directConnection=true";
process.env.MONGODB_URI = base.replace(/\/([^/?]*)(\?|$)/, `/${name}$2`);
process.env.MEMORY_API_TOKEN = "test-service-token-0123456789abcdef";
process.env.MEMORY_AI_PROVIDER = "stub";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://localhost:9316";

const { postEvents } = await import("../server/memory/routes.ts");
const { listRecords, getRecord, patchRecord, approveRecord, discardRecord } = await import(
  "../server/records/routes.ts"
);
const { closeMongo, db } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { createKey } = await import("../server/keys.ts");
const { events, memories, records } = await import("../server/collections.ts");

const SERVICE = process.env.MEMORY_API_TOKEN;
const call = <A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Promise<Response>,
  init: { token?: string | null; body?: unknown; query?: string; method?: string } = {},
  ...rest: A
) =>
  handler(
    new Request(`http://test/api/records/x${init.query ?? ""}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? SERVICE}` }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    ...rest,
  );

let key = "";
const project = "acme/billing";
let n = 0;
const event = (kind: string, payload: Record<string, unknown>, sessionID = "s1", promptID?: string) => ({
  v: 1,
  id: `re-${++n}-${Date.now()}`,
  sessionID,
  scope: { project },
  kind,
  payload,
  ts: Date.now(),
  ...(promptID ? { promptID } : {}),
});

const batch = () => {
  const promptID = "turn-1";
  return [
    event("session", { event: "start", source: "startup", git: { branch: "PAY-1-retry" } }),
    event("prompt", { role: "user", text: "Note that the ledger rounds per line." }, "s1", promptID),
    event("tool", { tool: "Bash", status: "error", ms: 40, command: { class: "test", exit: 1 } }, "s1", promptID),
    event(
      "assistant",
      { role: "assistant", text: "Round per line, then sum. Run the integration tests first." },
      "s1",
      promptID,
    ),
    event("event", { type: "compact_summary", text: "Retry with backoff added." }),
    event("finding", { type: "context_gap", text: "No docs for the retry budget." }),
    event("session", { event: "end", reason: "prompt_input_exit" }),
  ];
};

// One fixed set of ids, so posting it again is a replay rather than a new session.
const sessionBatch = batch();

beforeAll(async () => {
  await ensureIndexes({ wait: false });
  key = (await createKey("records-user", "test")).key;
});
afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("drafting", () => {
  it("drafts a summary and findings when the session ends, then clears the raw text", async () => {
    const res = await call(postEvents, { token: key, body: { batch: sessionBatch } });
    expect(res.status).toBe(202);
    expect((await res.json()).accepted).toBe(7);

    const drafts = await records().find({ sessionID: "s1" }).toArray();
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    expect(drafts.every((record) => record.status === "draft")).toBe(true);
    expect(drafts.map((record) => record.kind)).toEqual(
      expect.arrayContaining(["summary", "insight", "workflow", "pain_point", "context_gap"]),
    );

    const prompts = await events()
      .find({ sessionID: "s1", kind: { $in: ["prompt", "assistant"] } })
      .toArray();
    expect(prompts.every((stored) => stored.payload.text === "")).toBe(true);
    expect(prompts.every((stored) => stored.draftedAt)).toBe(true);
  });

  it("redrafting the same session does not duplicate records", async () => {
    const before = await records().countDocuments({ sessionID: "s1" });
    await call(postEvents, { token: key, body: { batch: sessionBatch } });
    expect(await records().countDocuments({ sessionID: "s1" })).toBe(before);
  });
});

describe("review", () => {
  it("shows only the author's records", async () => {
    const mine = await (await call(listRecords, { token: key, query: "?status=draft" })).json();
    expect(mine.records.length).toBeGreaterThan(0);

    const other = (await createKey("records-other", "test")).key;
    const theirs = await (await call(listRecords, { token: other })).json();
    expect(theirs.records).toEqual([]);
    expect((await call(getRecord, { token: other }, mine.records[0]._id)).status).toBe(404);
  });

  it("lets the author edit a draft, then re-request review", async () => {
    const insight = await records().findOne({ sessionID: "s1", kind: "insight" });
    const res = await call(
      patchRecord,
      { token: key, method: "PATCH", body: { title: "Ledger rule", text: "The ledger rounds per line." } },
      insight!._id.toHexString(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.title).toBe("Ledger rule");
    expect(body.record.edited).toBe(true);
    expect(body.record.status).toBe("draft");
  });

  it("approves an insight into a memory and discards another record", async () => {
    const insight = await records().findOne({ sessionID: "s1", kind: "insight" });
    const approved = await call(approveRecord, { token: key, body: {} }, insight!._id.toHexString());
    expect(approved.status).toBe(200);
    const body = await approved.json();
    expect(body.record.status).toBe("approved");
    expect(body.record.approvedAt).toBeTruthy();
    const memory = await memories().findOne({ "scope.user": "records-user", text: "The ledger rounds per line." });
    expect(memory?.kind).toBe("fact");
    expect(memory?.status).toBe("active");

    const workflow = await records().findOne({ sessionID: "s1", kind: "workflow" });
    expect(workflow).toBeTruthy();
    const discarded = await call(discardRecord, { token: key, body: {} }, workflow!._id.toHexString());
    expect((await discarded.json()).record.status).toBe("discarded");
    expect(
      (await call(patchRecord, { token: key, method: "PATCH", body: { text: "x" } }, workflow!._id.toHexString()))
        .status,
    ).toBe(409);
  });
});
