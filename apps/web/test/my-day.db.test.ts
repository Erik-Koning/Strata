// My Day: who gets it, what's waiting on them, and a signed-in person deciding about their own drafts through the same
// rules /api/records uses. On a database of its own on MONGODB_URI's server, emptied afterwards.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_myday");
process.env.MEMORY_AI_PROVIDER = "stub";

const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { postEvents } = await import("../server/memory/routes.ts");
const { draftPending } = await import("../server/memory/ingest.ts");
const { createKey } = await import("../server/keys.ts");
const { audits, memories, records } = await import("../server/collections.ts");
const { ApiError } = await import("../server/http.ts");
const recordRules = await import("../server/records/routes.ts");
const { usesPlugin, waitingOn } = await import("../server/stats.ts");

let n = 0;
const send = async (key: string, batch: unknown[]) => {
  const res = await postEvents(
    new Request("http://test/api/memory/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-memory-client": "test/1" },
      body: JSON.stringify({ batch }),
    }),
  );
  expect(res.status).toBe(202);
  // Drafting runs after the answer: wait for it, as the plugin's next look would.
  await draftPending();
};
const event = (sessionID: string, kind: string, payload: Record<string, unknown>) => ({
  v: 1,
  id: `md-${++n}-${randomBytes(3).toString("hex")}`,
  sessionID,
  scope: { project: "acme/billing" },
  kind,
  payload,
  ts: Date.now() + n,
});
const session = (sessionID: string) => [
  event(sessionID, "session", { event: "start", git: { branch: "PAY-412-retry" } }),
  event(sessionID, "prompt", { role: "user", text: "Add retry with backoff to the invoice sync worker." }),
  event(sessionID, "assistant", { role: "assistant", text: "Going forward, always run the invoice tests first." }),
  event(sessionID, "finding", { type: "context_gap", text: "Nothing records why the queue delivers at least once." }),
  event(sessionID, "session", { event: "end", reason: "prompt_input_exit" }),
];
const person = (userId: string) => ({ kind: "user" as const, userId, label: userId });

// A person whose plugin sent one session: their key, and their drafts.
async function connected(userId: string, sessionID: string) {
  const { key } = await createKey(userId, "laptop");
  await send(key, session(sessionID));
  return recordRules.ownDrafts(userId);
}

beforeAll(async () => {
  await ensureIndexes();
});
afterAll(async () => {
  await draftPending();
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("who gets My Day", () => {
  it("is people whose plugin has used one of their keys, and it counts what's waiting on them", async () => {
    const { key } = await createKey("dee", "laptop");
    expect(await usesPlugin("dee")).toBe(false);
    await send(key, session("s-dee"));
    // The key's last use is written in the background.
    for (let i = 0; i < 40 && !(await usesPlugin("dee")); i++) await new Promise((r) => setTimeout(r, 50));
    expect(await usesPlugin("dee")).toBe(true);
    const drafts = await recordRules.ownDrafts("dee");
    const candidates = await memories().countDocuments({ "scope.user": "dee", status: "candidate" });
    expect(drafts.length).toBeGreaterThan(0);
    expect(await waitingOn("dee")).toBe(drafts.length + candidates);
    expect(await usesPlugin("never-connected")).toBe(false);
  });

  it("shows a person only their own drafts", async () => {
    await connected("ada", "s-ada");
    await connected("grace", "s-grace");
    const mine = await recordRules.ownDrafts("ada");
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.scope.user === "ada" && r.status === "draft")).toBe(true);
  });
});

describe("deciding from My Day", () => {
  it("lets the author edit, then approve, and audits it as them", async () => {
    const [draft] = await connected("lin", "s-lin");
    const id = draft?._id.toHexString() ?? "";
    await recordRules.editRecord(person("lin"), id, { text: "Retries now back off, capped at five tries." });
    await recordRules.approve(person("lin"), id);
    const stored = await records().findOne({ _id: draft?._id });
    expect(stored).toMatchObject({
      status: "approved",
      edited: true,
      text: "Retries now back off, capped at five tries.",
    });
    const audited = await audits().findOne({ action: "record.approve", targetIds: id });
    expect(audited?.actor).toEqual({ kind: "user", id: "lin", label: "lin" });
    expect(
      (await recordRules.ownApprovedSince("lin", new Date(Date.now() - 60_000))).map((r) => r._id.toHexString()),
    ).toEqual([id]);
  });

  it("lets nobody else edit, approve or discard someone's draft, whatever their role", async () => {
    const [draft] = await connected("mo", "s-mo");
    const id = draft?._id.toHexString() ?? "";
    const other = person("an-admin");
    await expect(recordRules.editRecord(other, id, { text: "changed" })).rejects.toThrow(ApiError);
    await expect(recordRules.approve(other, id)).rejects.toThrow(ApiError);
    await expect(recordRules.discard(other, id)).rejects.toThrow(ApiError);
    expect(await records().findOne({ _id: draft?._id })).toMatchObject({ status: "draft", edited: false });
  });

  it("keeps a discarded draft out of My Day and out of anything shared", async () => {
    const [draft] = await connected("cy", "s-cy");
    const id = draft?._id.toHexString() ?? "";
    await recordRules.discard(person("cy"), id);
    expect((await recordRules.ownDrafts("cy")).map((r) => r._id.toHexString())).not.toContain(id);
    expect((await records().findOne({ _id: draft?._id }))?.status).toBe("discarded");
  });
});
