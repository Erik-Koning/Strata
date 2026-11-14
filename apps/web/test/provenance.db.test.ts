// Provenance, end to end through the HTTP route handlers, across real accounts: Ada's session logs a finding the way
// the plugin's strata_record does, the server drafts it at the session's end, she reviews and approves it, and hands it
// to Bea through Relay. Cy is unrelated. Every step is checked for the ids that tie it together: Ada's session, her
// finding's event, the record, the memory, and the session Bea reads it from. On a database of its own, emptied after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_provenance");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { createKey } = await import("../server/keys.ts");
const { createInvite, signUpWithInvite } = await import("../server/invites.ts");
const { draftPending } = await import("../server/memory/ingest.ts");
const memoryRoutes = await import("../server/memory/routes.ts");
const recordRoutes = await import("../server/records/routes.ts");
const handoffRoutes = await import("../server/handoffs/routes.ts");
const { audits, events, memories, records } = await import("../server/collections.ts");

const CLI = { kind: "service" as const, id: "cli", label: "command line" };
const PROJECT = "github.com/acme/durations";
const INSIGHT = "A repeated unit like 1h2h is a typo: reject it rather than summing the parts.";
const PRIVATE = "Private: I am interviewing elsewhere next week.";

interface Account {
  id: string;
  key: string;
}
let n = 0;
async function account(who: string): Promise<Account> {
  const email = `${who.toLowerCase()}.${++n}@example.com`;
  const { token } = await createInvite(CLI, { email, role: "engineer" });
  const { userId } = await signUpWithInvite({ token, name: who, password: "correct horse battery" });
  const { key } = await createKey(userId, `${who}'s laptop`);
  return { id: userId, key };
}

// biome-ignore lint/suspicious/noExplicitAny: each route file has its own second argument; bodies are checked by expect.
type Handler = (request: Request, arg?: any) => Promise<Response>;
async function call(
  handler: Handler,
  who: Account,
  init: { body?: unknown; id?: string; query?: string; headers?: Record<string, string>; handoff?: boolean } = {},
  // biome-ignore lint/suspicious/noExplicitAny: response bodies are read as the API answers them, checked by expect.
): Promise<{ status: number; body: any }> {
  const request = new Request(`http://test/api${init.query ?? ""}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${who.key}`, ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await handler(request, init.handoff ? { params: Promise.resolve({ id: init.id ?? "" }) } : init.id);
  return { status: res.status, body: await res.json() };
}

let A: Account; // Ada: the source
let B: Account; // Bea: the recipient
let C: Account; // Cy: nobody's recipient
const SOURCE_SESSION = "ada-session-7f3c";
const RECEIVING_SESSION = "bea-session-91d0";
let findingEventId = "";
let recordId = "";
let memoryId = "";
let privateId = "";
let handoffId = "";

let seq = 0;
const event = (kind: string, payload: Record<string, unknown>) => ({
  v: 1,
  id: `ada-${++seq}`,
  sessionID: SOURCE_SESSION,
  scope: { project: PROJECT },
  kind,
  payload,
  ts: Date.now() + seq,
});

beforeAll(async () => {
  await ensureIndexes();
  [A, B, C] = [await account("Ada"), await account("Bea"), await account("Cy")];
});
afterAll(async () => {
  await draftPending();
  await recordRoutes.hubPending();
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("a finding captured in a real session", () => {
  it("is drafted at the session's end as a record only its author sees", async () => {
    const finding = event("finding", { type: "insight", text: INSIGHT });
    findingEventId = finding.id;
    const batch = [
      event("session", { event: "start", git: { remote: PROJECT, branch: "main" } }),
      event("prompt", { role: "user", text: "Make parseDuration accept compound units." }),
      finding,
      event("assistant", { role: "assistant", text: "Compound units parse; repeated units are rejected." }),
      event("session", { event: "end", reason: "prompt_input_exit" }),
    ];
    const res = await call(memoryRoutes.postEvents, A, { body: { batch } });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(batch.length);
    await draftPending();

    const mine = await call(recordRoutes.listRecords, A, { query: `?sessionID=${SOURCE_SESSION}&kind=insight` });
    expect(mine.status).toBe(200);
    expect(mine.body.records).toHaveLength(1);
    const record = mine.body.records[0];
    expect(record).toMatchObject({ status: "draft", text: INSIGHT, sessionID: SOURCE_SESSION, memoryId: null });
    recordId = record._id;
    // The finding's own event leads the record's events, so what its approval remembers points at it.
    expect((await records().findOne({ _id: new ObjectId(recordId) }))?.eventIds[0]).toBe(findingEventId);

    // A draft is private: the others get nothing, by list or by id.
    for (const other of [B, C]) {
      const list = await call(recordRoutes.listRecords, other, { query: `?sessionID=${SOURCE_SESSION}` });
      expect(list.body.records).toEqual([]);
      expect((await call(recordRoutes.getRecord, other, { id: recordId })).status).toBe(404);
    }
    // Nothing is a memory before review.
    expect(await memories().countDocuments({ "scope.user": A.id })).toBe(0);
  });

  it("becomes a memory on approval, linked both ways and marked as captured, not saved or seeded", async () => {
    const res = await call(recordRoutes.approveRecord, A, { id: recordId, body: {} });
    expect(res.status).toBe(200);
    expect(res.body.record.status).toBe("approved");
    memoryId = res.body.record.memoryId;
    expect(memoryId).toMatch(/^[a-f0-9]{24}$/);

    const memory = await memories().findOne({ _id: new ObjectId(memoryId) });
    expect(memory).toMatchObject({ status: "active", text: INSIGHT, scope: { user: A.id, project: PROJECT } });
    expect(memory?.provenance).toEqual({
      sessionID: SOURCE_SESSION,
      messageID: null,
      eventId: findingEventId,
      source: "record",
      recordId,
    });
    // The event it names is the finding itself, as the client sent it.
    expect((await events().findOne({ id: findingEventId }))?.payload).toMatchObject({ type: "insight", text: INSIGHT });
    const approval = await audits().findOne({ action: "record.approve", targetIds: recordId });
    expect(approval?.detail).toMatchObject({ memoryId });
  });

  it("is not confused with a memory saved directly", async () => {
    const res = await call(memoryRoutes.postSave, A, {
      body: { scope: { project: PROJECT }, text: PRIVATE, kind: "fact" },
    });
    expect(res.status).toBe(201);
    privateId = res.body.memory._id;
    const saved = await memories().findOne({ _id: new ObjectId(privateId) });
    expect(saved?.provenance.source).toBe("tool");
    expect(saved?.provenance.recordId).toBeUndefined();
  });
});

describe("sharing it through Relay", () => {
  it("authorizes one recipient and names the memory on the approval", async () => {
    const created = await call(handoffRoutes.postHandoffs, A, {
      body: {
        project: PROJECT,
        title: "Finish compound durations",
        summary: "Parser half done.",
        nextAction: "Add the remaining unit tests.",
        testCommands: ["npm test"],
        sourceSessionID: SOURCE_SESSION,
      },
    });
    expect(created.status).toBe(201);
    handoffId = created.body.handoff._id;
    expect(created.body.handoff.sourceSessionID).toBe(SOURCE_SESSION);

    const approved = await call(handoffRoutes.postApprove, A, {
      handoff: true,
      id: handoffId,
      body: { recipientId: B.id, memoryIds: [memoryId] },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.handoff.memoryIds).toEqual([memoryId]);
    const entry = approved.body.handoff.timeline.find((e: { action: string }) => e.action === "approved");
    expect(entry.detail).toMatchObject({ recipient: B.id, memories: 1, memoryIds: [memoryId] });
  });

  it("gives the recipient the memory with its whole chain, and none of the sender's private memory", async () => {
    const res = await call(handoffRoutes.getResume, B, {
      handoff: true,
      id: handoffId,
      headers: { "x-strata-session": RECEIVING_SESSION },
    });
    expect(res.status).toBe(200);
    expect(res.body.memories).toHaveLength(1);
    expect(res.body.memories[0]).toMatchObject({
      _id: memoryId,
      text: INSIGHT,
      ownerId: A.id,
      provenance: { sessionID: SOURCE_SESSION, source: "record", eventId: findingEventId, recordId },
      correctionOf: null,
    });
    // The checkpoint is labelled as the sender's own writing; the memory says where it came from.
    expect(res.body.context).toContain(`Source session: ${SOURCE_SESSION}`);
    expect(res.body.context).toMatch(/written by the sender/);
    expect(res.body.context).toContain(`captured in session ${SOURCE_SESSION}, approved as record ${recordId}`);
    // Nothing of the private memory, anywhere in the answer.
    const whole = JSON.stringify(res.body);
    expect(whole).not.toContain(privateId);
    expect(whole).not.toContain("interviewing");

    // Which session retrieved which memory is in the audit log.
    const read = await audits().findOne({ action: "handoff.read", targetIds: handoffId, "detail.by": B.id });
    expect(read?.detail).toMatchObject({ party: "recipient", sessionID: RECEIVING_SESSION, memories: [memoryId] });
  });

  it("ignores a malformed session header rather than storing it", async () => {
    const res = await call(handoffRoutes.getResume, B, {
      handoff: true,
      id: handoffId,
      headers: { "x-strata-session": "x".repeat(300) },
    });
    expect(res.status).toBe(200);
    const reads = await audits()
      .find({ action: "handoff.read", targetIds: handoffId, "detail.by": B.id })
      .sort({ _id: -1 })
      .limit(1)
      .toArray();
    expect(reads[0]?.detail.sessionID).toBeNull();
  });

  it("refuses an unrelated account the handoff, and the sender can't share a memory that isn't hers", async () => {
    expect((await call(handoffRoutes.getResume, C, { handoff: true, id: handoffId })).status).toBe(404);
    expect((await call(handoffRoutes.getHandoff, C, { handoff: true, id: handoffId })).status).toBe(404);
    const other = await call(handoffRoutes.postHandoffs, B, { body: { project: PROJECT, title: "Bea's own" } });
    const steal = await call(handoffRoutes.postApprove, B, {
      handoff: true,
      id: other.body.handoff._id,
      body: { recipientId: C.id, memoryIds: [memoryId] },
    });
    expect(steal.status).toBe(400);
    expect(steal.body.error.code).toBe("bad_memory");
  });

  it("records the receiving session on the claim", async () => {
    const res = await call(handoffRoutes.postClaim, B, {
      handoff: true,
      id: handoffId,
      body: { sessionID: RECEIVING_SESSION, repo: { url: null, branch: "main", commit: null, pushed: null } },
    });
    expect(res.status).toBe(200);
    expect(res.body.handoff.continuation.sessionID).toBe(RECEIVING_SESSION);
    expect(res.body.handoff.sourceSessionID).toBe(SOURCE_SESSION);
  });
});

describe("taking it back", () => {
  it("follows a correction: the recipient gets the new words, marked as replacing the shared one", async () => {
    const res = await call(memoryRoutes.postCorrect, A, {
      body: {
        scope: { project: PROJECT },
        id: memoryId,
        text: "A repeated unit like 1h2h is a typo: reject it with a clear error.",
        sessionID: SOURCE_SESSION,
      },
    });
    expect(res.status).toBe(201);
    const corrected = res.body.memory._id;
    const resume = await call(handoffRoutes.getResume, B, { handoff: true, id: handoffId });
    expect(resume.body.memories).toHaveLength(1);
    expect(resume.body.memories[0]).toMatchObject({ _id: corrected, correctionOf: memoryId });
    expect(resume.body.memories[0].text).toMatch(/clear error/);
    memoryId = corrected;
  });

  it("forgetting excludes the memory from every later retrieval, and withdraws an approved record holding it", async () => {
    // A second captured insight, approved, shared on a second handoff, then forgotten.
    const text = "Durations are integer milliseconds: round once, at the end.";
    const session = "ada-session-2";
    const batch = [
      { ...event("finding", { type: "insight", text }), sessionID: session },
      { ...event("session", { event: "end", reason: "prompt_input_exit" }), sessionID: session },
    ];
    expect((await call(memoryRoutes.postEvents, A, { body: { batch } })).status).toBe(202);
    await draftPending();
    const draft = (await call(recordRoutes.listRecords, A, { query: `?sessionID=${session}&kind=insight` })).body
      .records[0];
    const approved = await call(recordRoutes.approveRecord, A, { id: draft._id, body: {} });
    const forgetMe = approved.body.record.memoryId;
    // Approved: everyone with access may read the record (records/routes.ts), Cy too.
    expect((await call(recordRoutes.getRecord, C, { id: draft._id })).status).toBe(200);

    const h = (await call(handoffRoutes.postHandoffs, A, { body: { project: PROJECT, title: "Rounding" } })).body
      .handoff;
    await call(handoffRoutes.postApprove, A, {
      handoff: true,
      id: h._id,
      body: { recipientId: B.id, memoryIds: [forgetMe] },
    });
    expect((await call(handoffRoutes.getResume, B, { handoff: true, id: h._id })).body.memories).toHaveLength(1);

    const gone = await call(memoryRoutes.postForget, A, { body: { scope: { project: PROJECT }, ids: [forgetMe] } });
    expect(gone.status).toBe(200);
    expect(gone.body.memories).toBe(1);

    const after = await call(handoffRoutes.getResume, B, { handoff: true, id: h._id });
    expect(after.body.memories).toEqual([]);
    expect(after.body.excluded).toEqual([{ _id: forgetMe, reason: "forgotten" }]);
    expect(after.body.context).not.toContain("round once");
    // The record that made it is withdrawn: others can't read its words any more; its author still sees it, discarded.
    expect((await call(recordRoutes.getRecord, C, { id: draft._id })).status).toBe(404);
    expect((await call(recordRoutes.getRecord, B, { id: draft._id })).status).toBe(404);
    expect((await call(recordRoutes.getRecord, A, { id: draft._id })).body.record.status).toBe("discarded");
    const audit = await audits().findOne({ action: "memory.forget", targetIds: forgetMe });
    expect(audit?.detail).toMatchObject({ recordsWithdrawn: 1 });
  });

  it("revoking cuts the recipient off from the handoff and its memories", async () => {
    const res = await call(handoffRoutes.postRevoke, A, {
      handoff: true,
      id: handoffId,
      body: { reason: "wrong person" },
    });
    expect(res.status).toBe(200);
    const resume = await call(handoffRoutes.getResume, B, { handoff: true, id: handoffId });
    expect(resume.status).toBe(404);
    expect(JSON.stringify(resume.body)).not.toContain(memoryId);
  });
});
