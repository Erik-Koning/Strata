// Drafts and approvals, end to end through the events API: a session's summary drafted when it ends, a draft for each
// finding the agent logged, and the author's decisions about them. On a database of its own on MONGODB_URI's server,
// dropped afterwards.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const name = `am_records_${randomBytes(4).toString("hex")}`;
const base = process.env.MONGODB_URI ?? "mongodb://localhost:9317/?directConnection=true";
process.env.MONGODB_URI = base.replace(/\/([^/?]*)(\?|$)/, `/${name}$2`);
process.env.MEMORY_AI_PROVIDER = "stub";

const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { postEvents } = await import("../server/memory/routes.ts");
const { createKey } = await import("../server/keys.ts");
const { records, audits } = await import("../server/collections.ts");
const { Refusal } = await import("../server/refusal.ts");
const recordsApi = await import("../server/records.ts");
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
  return res.json();
};
const event = (session: string, kind: string, payload: Record<string, unknown>) => ({
  v: 1,
  id: `ev-${++n}-${randomBytes(3).toString("hex")}`,
  sessionID: session,
  scope: { project: "acme/billing" },
  kind,
  payload,
  ts: Date.now() + n,
});
const session = (sessionID: string) => [
  event(sessionID, "session", {
    event: "start",
    git: { branch: "feat/PAY-412-invoice-retry" },
    refs: [{ type: "ticket", id: "PAY-412" }],
  }),
  event(sessionID, "prompt", { role: "user", text: "Add retry with backoff to the invoice sync worker." }),
  event(sessionID, "assistant", { role: "assistant", text: "Added exponential backoff, capped at five tries." }),
  event(sessionID, "finding", {
    type: "context_gap",
    text: "Nothing records why the job queue delivers at least once.",
    refs: [{ type: "ticket", id: "PAY-412" }],
  }),
];
const end = (sessionID: string) => event(sessionID, "session", { event: "end", reason: "prompt_input_exit" });

beforeAll(async () => {
  await ensureIndexes();
});
afterAll(async () => {
  await db().dropDatabase();
  await closeMongo();
});

describe("drafting", () => {
  it("drafts each finding at once, and the session's summary when it ends, for its author alone", async () => {
    const { key, doc } = await createKey("ada", "laptop");
    await send(key, session("s-1"));
    const before = await recordsApi.listDrafts("ada");
    expect(before.map((r) => r.kind)).toEqual(["context_gap"]);
    expect(before[0]).toMatchObject({ status: "draft", refs: [{ type: "ticket", id: "PAY-412" }] });

    await send(key, [end("s-1")]);
    const summary = (await recordsApi.listDrafts("ada")).find((r) => r.kind === "summary");
    expect(summary?.text).toContain("Add retry with backoff");
    expect(summary?.scope).toMatchObject({ user: "ada", project: "acme/billing" });
    expect(summary?.refs).toEqual(
      expect.arrayContaining([
        { type: "ticket", id: "PAY-412" },
        { type: "branch", id: "feat/PAY-412-invoice-retry" },
      ]),
    );
    expect(await recordsApi.listDrafts("grace")).toEqual([]);
    expect(doc.userId).toBe("ada");
  });

  it("makes each draft once, however often its events are sent", async () => {
    const { key } = await createKey("lin", "laptop");
    const batch = [...session("s-2"), end("s-2")];
    await send(key, batch);
    await send(key, batch);
    expect(await records().countDocuments({ "scope.user": "lin" })).toBe(2);
  });

  it("redrafts a summary when its session ends again, unless its author edited it", async () => {
    const { key } = await createKey("mo", "laptop");
    await send(key, [...session("s-3"), end("s-3")]);
    await send(key, [event("s-3", "prompt", { role: "user", text: "Also log each retry." }), end("s-3")]);
    const redrafted = await records().findOne({ "scope.user": "mo", kind: "summary" });
    expect(redrafted?.text).toContain("Also log each retry");

    await recordsApi.saveDraft("mo", redrafted?._id.toHexString() ?? "", "Retries with backoff; each one logged.");
    await send(key, [event("s-3", "prompt", { role: "user", text: "One more change." }), end("s-3")]);
    expect((await records().findOne({ "scope.user": "mo", kind: "summary" }))?.text).toBe(
      "Retries with backoff; each one logged.",
    );
    expect(await records().countDocuments({ "scope.user": "mo", kind: "summary" })).toBe(1);
  });
});

describe("deciding", () => {
  it("lets the author approve, with a last edit, which shares it and is audited", async () => {
    const { key } = await createKey("ana", "laptop");
    await send(key, [...session("s-4"), end("s-4")]);
    const [gap] = (await recordsApi.listDrafts("ana")).filter((r) => r.kind === "context_gap");
    const id = gap?._id.toHexString() ?? "";
    await recordsApi.approveRecord({ id: "ana", label: "Ana" }, id, "Why does the job queue deliver at least once?");
    const approved = await records().findOne({ _id: gap?._id });
    expect(approved).toMatchObject({ status: "approved", edited: true });
    expect(approved?.text).toBe("Why does the job queue deliver at least once?");
    expect(await audits().countDocuments({ action: "record.approve", targetIds: id })).toBe(1);
    // Approved is shared: no more edits, no discarding it from here.
    await expect(recordsApi.saveDraft("ana", id, "changed")).rejects.toThrow(Refusal);
    await expect(recordsApi.discardRecord({ id: "ana", label: "Ana" }, id)).rejects.toThrow(Refusal);
  });

  it("lets nobody else approve, edit or discard someone's draft", async () => {
    const { key } = await createKey("ben", "laptop");
    await send(key, [...session("s-5"), end("s-5")]);
    const [draft] = await recordsApi.listDrafts("ben");
    const id = draft?._id.toHexString() ?? "";
    const other = { id: "an-admin", label: "Admin" };
    await expect(recordsApi.approveRecord(other, id)).rejects.toThrow(Refusal);
    await expect(recordsApi.saveDraft(other.id, id, "x")).rejects.toThrow(Refusal);
    await expect(recordsApi.discardRecord(other, id)).rejects.toThrow(Refusal);
    expect((await records().findOne({ _id: draft?._id }))?.status).toBe("draft");
  });

  it("deletes a discarded draft, and refuses an empty edit", async () => {
    const { key } = await createKey("cy", "laptop");
    await send(key, [...session("s-6"), end("s-6")]);
    const [draft] = await recordsApi.listDrafts("cy");
    const id = draft?._id.toHexString() ?? "";
    await expect(recordsApi.saveDraft("cy", id, "   ")).rejects.toThrow(/empty/);
    await recordsApi.discardRecord({ id: "cy", label: "Cy" }, id);
    expect(await records().findOne({ _id: draft?._id })).toBeNull();
    expect(await audits().countDocuments({ action: "record.discard", targetIds: id })).toBe(1);
  });
});

describe("who gets My Day", () => {
  it("is people whose plugin has used one of their keys, and counts what's waiting on them", async () => {
    const { key } = await createKey("dee", "laptop");
    expect(await usesPlugin("dee")).toBe(false);
    await send(key, [...session("s-7"), end("s-7")]);
    // The key's last use is written in the background.
    for (let i = 0; i < 20 && !(await usesPlugin("dee")); i++) await new Promise((r) => setTimeout(r, 50));
    expect(await usesPlugin("dee")).toBe(true);
    expect(await waitingOn("dee")).toBe(2);
    expect(await usesPlugin("never-connected")).toBe(false);
  });
});
