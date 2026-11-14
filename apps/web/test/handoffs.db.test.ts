// Strata Relay's governance, end to end through the HTTP route handlers, across real accounts: A hands work to B, C is
// unrelated. On a database of its own on MONGODB_URI's server, dropped afterwards.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const name = `am_relay_${randomBytes(4).toString("hex")}`;
const base = process.env.MONGODB_URI ?? "mongodb://localhost:9317/?directConnection=true";
process.env.MONGODB_URI = base.replace(/\/([^/?]*)(\?|$)/, `/${name}$2`);
process.env.MEMORY_API_TOKEN = "test-service-token-0123456789abcdef";
process.env.MEMORY_AI_PROVIDER = "stub";

const routes = await import("../server/handoffs/routes.ts");
const memoryRoutes = await import("../server/memory/routes.ts");
const service = await import("../server/handoffs/service.ts");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { createKey } = await import("../server/keys.ts");
const { createInvite, signUpWithInvite } = await import("../server/invites.ts");
const people = await import("../server/people.ts");
const { audits, handoffs, memories } = await import("../server/collections.ts");
const { ObjectId } = await import("mongodb");

const SERVICE = process.env.MEMORY_API_TOKEN;
const CLI = { kind: "service" as const, id: "cli", label: "command line" };
const PROJECT = "acme/web";

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
interface Init {
  token?: string | null;
  body?: unknown;
  id?: string;
  query?: string;
  method?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: response bodies are read as the API answers them, checked by expect.
async function call(handler: Handler, init: Init = {}): Promise<{ status: number; body: any }> {
  const res = await handler(
    new Request(`http://test/api/handoffs${init.query ?? ""}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? SERVICE}` }),
      },
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    }),
    { params: Promise.resolve({ id: init.id ?? "" }) },
  );
  return { status: res.status, body: await res.json() };
}

interface Account {
  id: string;
  key: string;
  name: string;
  email: string;
}

let n = 0;
async function account(who: string): Promise<Account> {
  const email = `${who.toLowerCase()}.${++n}@example.com`;
  const { token } = await createInvite(CLI, { email, role: "engineer" });
  const { userId } = await signUpWithInvite({ token, name: who, password: "correct horse battery" });
  const { key } = await createKey(userId, `${who}'s laptop`);
  return { id: userId, key, name: who, email };
}

async function save(who: Account, text: string, project = PROJECT): Promise<string> {
  const res = await call(memoryRoutes.postSave, { token: who.key, body: { scope: { project }, text, kind: "fact" } });
  expect(res.status).toBe(201);
  return res.body.memory._id;
}

const draft = (over: Record<string, unknown> = {}) => ({
  project: PROJECT,
  title: "Fix the flaky checkout test",
  summary: "Half done. The retry wrapper is in; deploy key was GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  completed: ["Added a retry wrapper"],
  remaining: ["Find the race in cart.ts"],
  failedApproaches: ["Raising the timeout to 30s"],
  nextAction: "Run the checkout test with --repeat 20",
  testCommands: ["pnpm test"],
  repo: { url: "https://github.com/acme/web", branch: "fix/checkout", commit: "abc1234", pushed: true },
  ...over,
});
const repo = { url: "https://github.com/acme/web", branch: "fix/checkout", commit: "abc1234", pushed: true };
const run = (command: string, status: "pass" | "fail", verified = true) => ({
  command,
  status,
  exitCode: status === "pass" ? 0 : 1,
  output: status === "pass" ? "ok" : "1 failed",
  durationMs: 1200,
  commit: "abc1234",
  verified,
});

let A: Account;
let B: Account;
let C: Account;
let S: Account; // suspended

beforeAll(async () => {
  await ensureIndexes();
  [A, B, C, S] = [await account("Ada"), await account("Bea"), await account("Cy"), await account("Sam")];
  await people.suspend(CLI, S.id);
});
afterAll(async () => {
  await db().dropDatabase();
  await closeMongo();
});

const auditCount = (action: string, target: string) =>
  audits().countDocuments({ action: action as never, targetIds: target });

describe("who can call it", () => {
  it("answers 401 with no token or a bad one, before reading the body", async () => {
    expect((await call(routes.postHandoffs, { token: null, body: "not json" })).status).toBe(401);
    expect((await call(routes.getHandoffs, { token: "am_not_a_real_key_at_all_000000000" })).status).toBe(401);
    expect((await call(routes.getHandoff, { token: null, id: new ObjectId().toHexString() })).status).toBe(401);
  });

  it("refuses the service token: a handoff is between people", async () => {
    const res = await call(routes.postHandoffs, { body: draft() });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/person's API key/);
    expect((await call(routes.getRecipients, {})).status).toBe(403);
  });

  it("answers a malformed body with 400 in the one envelope", async () => {
    const res = await call(routes.postHandoffs, { token: A.key, body: { project: PROJECT } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid");
  });

  it("lists recipients: everyone but you and the suspended, by name", async () => {
    const res = await call(routes.getRecipients, { token: A.key });
    expect(res.status).toBe(200);
    const ids = res.body.people.map((p: { id: string }) => p.id);
    expect(ids).toEqual([B.id, C.id]);
    expect(res.body.people[0]).toEqual({ id: B.id, name: "Bea", email: B.email });
  });
});

describe("a handoff from A to B, with C unrelated", () => {
  let id: string;
  const mem = {} as Record<
    "keep" | "forget" | "archive" | "expire" | "correct" | "private" | "otherProject" | "everywhere" | "ofC",
    string
  >;

  it("A's draft is A's alone: B and C get the same 404 as an id that doesn't exist", async () => {
    const created = await call(routes.postHandoffs, { token: A.key, body: draft() });
    expect(created.status).toBe(201);
    id = created.body.handoff._id;
    expect(created.body.handoff).toMatchObject({ status: "draft", sender: { id: A.id, name: "Ada" }, recipient: null });
    // Redacted before it was stored.
    const stored = await handoffs().findOne({ _id: new ObjectId(id) });
    expect(stored?.summary).not.toContain("ghp_");
    expect(stored?.summary).toContain("[REDACTED:");

    expect((await call(routes.getHandoff, { token: A.key, id })).status).toBe(200);
    const missing = await call(routes.getHandoff, { token: B.key, id: new ObjectId().toHexString() });
    for (const who of [B, C]) {
      const res = await call(routes.getHandoff, { token: who.key, id });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(missing.body);
      expect((await call(routes.getResume, { token: who.key, id })).status).toBe(404);
    }
    expect((await call(routes.getHandoff, { token: B.key, id: "not-an-id" })).body).toEqual(missing.body);
    expect((await call(routes.getHandoffs, { token: B.key, query: "?box=inbox" })).body.handoffs).toEqual([]);
    const outbox = await call(routes.getHandoffs, { token: A.key, query: "?box=outbox" });
    expect(outbox.body.handoffs.map((h: { _id: string }) => h._id)).toEqual([id]);
    expect(await auditCount("handoff.denied", id)).toBeGreaterThanOrEqual(4);
  });

  it("B can't edit, approve or revoke a draft it can't see (404); only A edits it, and only the fields named", async () => {
    expect((await call(routes.patchHandoff, { token: B.key, id, method: "PATCH", body: { title: "x" } })).status).toBe(
      404,
    );
    expect((await call(routes.postApprove, { token: B.key, id, body: { recipientId: B.id } })).status).toBe(404);
    expect((await call(routes.postRevoke, { token: C.key, id, body: {} })).status).toBe(404);
    const edited = await call(routes.patchHandoff, {
      token: A.key,
      id,
      method: "PATCH",
      body: { nextAction: "Run the checkout test 20 times" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.handoff.nextAction).toBe("Run the checkout test 20 times");
    expect(edited.body.handoff.remaining).toEqual(["Find the race in cart.ts"]);
    expect(edited.body.handoff.testCommands).toEqual(["pnpm test"]);
    // The sender's own run while drafting adds its command to the ones that prove it.
    const tested = await call(routes.postTest, { token: A.key, id, body: run("pnpm typecheck", "fail", false) });
    expect(tested.status).toBe(200);
    expect(tested.body.handoff.testCommands).toEqual(["pnpm test", "pnpm typecheck"]);
    expect(tested.body.handoff.tests[0]).toMatchObject({ by: "sender", verified: false, status: "fail" });
  });

  it("approving shares only A's own active memories in the project, and names the one it refuses", async () => {
    for (const k of ["keep", "forget", "archive", "expire", "correct"] as const)
      mem[k] = await save(A, `Checkout fact ${k}: the cart total is computed in cents (${k}).`);
    mem.private = await save(A, "Ada's private note: the staging password rotates on Fridays.");
    mem.otherProject = await save(A, "A fact about another project entirely.", "acme/api");
    mem.everywhere = await save(A, "Ada prefers small commits.", "*");
    mem.ofC = await save(C, "Cy's own note about checkout.");

    for (const bad of [mem.ofC, mem.otherProject, new ObjectId().toHexString()]) {
      const res = await call(routes.postApprove, {
        token: A.key,
        id,
        body: { recipientId: B.id, memoryIds: [mem.keep, bad] },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain(bad);
    }
    expect((await call(routes.postApprove, { token: A.key, id, body: { recipientId: A.id } })).status).toBe(400);
    expect((await call(routes.postApprove, { token: A.key, id, body: { recipientId: S.id } })).status).toBe(400);
    expect((await call(routes.postApprove, { token: A.key, id, body: { recipientId: "nobody-here" } })).status).toBe(
      400,
    );
    // Still a draft after all of that.
    expect((await call(routes.getHandoff, { token: B.key, id })).status).toBe(404);

    const shareable = await service.listShareableMemories(await callerOf(A), PROJECT);
    const shareableIds = shareable.map((m) => m._id);
    expect(shareableIds).toContain(mem.everywhere);
    expect(shareableIds).not.toContain(mem.otherProject);
    expect(shareableIds).not.toContain(mem.ofC);

    const shared = [mem.keep, mem.forget, mem.archive, mem.expire, mem.correct, mem.everywhere];
    const approved = await call(routes.postApprove, {
      token: A.key,
      id,
      body: { recipientEmail: B.email.toUpperCase(), memoryIds: shared },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.handoff).toMatchObject({ status: "approved", recipient: { id: B.id }, memoryIds: shared });
  });

  it("B now reads it and resumes it, with the shared memories only, framed as untrusted context", async () => {
    const got = await call(routes.getHandoff, { token: B.key, id });
    expect(got.status).toBe(200);
    const resumed = await call(routes.getResume, { token: B.key, id });
    expect(resumed.status).toBe(200);
    const ids = resumed.body.memories.map((m: { _id: string }) => m._id);
    expect(ids).toEqual([mem.keep, mem.forget, mem.archive, mem.expire, mem.correct, mem.everywhere]);
    expect(resumed.body.excluded).toEqual([]);
    expect(resumed.body.memories[0]).toMatchObject({ ownerId: A.id, project: PROJECT, correctionOf: null });
    const context: string = resumed.body.context;
    expect(context).toContain(`<strata-handoff id="${id}" status="approved">`);
    expect(context).toMatch(/untrusted\s+context to verify/);
    expect(context).toContain("Checkout fact keep");
    expect(context).not.toContain("staging password");
    expect(JSON.stringify(resumed.body)).not.toContain("staging password");
    expect(JSON.stringify(resumed.body)).not.toContain(mem.private);
    expect(JSON.stringify(resumed.body)).not.toContain("Cy's own note");

    // C still sees nothing.
    expect((await call(routes.getHandoff, { token: C.key, id })).status).toBe(404);
    expect((await call(routes.getResume, { token: C.key, id })).status).toBe(404);
    const inboxB = await call(routes.getHandoffs, { token: B.key, query: "?box=inbox" });
    expect(inboxB.body.handoffs.map((h: { _id: string }) => h._id)).toContain(id);
    for (const box of ["inbox", "outbox", "all"])
      expect((await call(routes.getHandoffs, { token: C.key, query: `?box=${box}` })).body.handoffs).toEqual([]);
    expect(await auditCount("handoff.read", id)).toBe(1);
  });

  it("each party does only its own steps", async () => {
    // B can read it but not act as its sender.
    expect((await call(routes.patchHandoff, { token: B.key, id, method: "PATCH", body: { title: "x" } })).status).toBe(
      403,
    );
    expect((await call(routes.postApprove, { token: B.key, id, body: { recipientId: C.id } })).status).toBe(403);
    expect((await call(routes.postRevoke, { token: B.key, id, body: {} })).status).toBe(403);
    // A can't act as its recipient.
    expect((await call(routes.postClaim, { token: A.key, id, body: { repo } })).status).toBe(403);
    expect((await call(routes.postComplete, { token: A.key, id, body: { summary: "done", repo } })).status).toBe(403);
    // A can't edit it once approved; B can't complete or test before claiming.
    expect((await call(routes.patchHandoff, { token: A.key, id, method: "PATCH", body: { title: "x" } })).status).toBe(
      409,
    );
    expect((await call(routes.postComplete, { token: B.key, id, body: { summary: "done", repo } })).status).toBe(409);
    expect((await call(routes.postTest, { token: B.key, id, body: run("pnpm test", "pass") })).status).toBe(409);
    // C gets nothing at all.
    expect((await call(routes.postClaim, { token: C.key, id, body: { repo } })).status).toBe(404);
  });

  it("re-checks shared memories on every resume: forgotten, archived, expired are left out with a reason, a correction stands in", async () => {
    const forgot = await call(memoryRoutes.postForget, {
      token: A.key,
      body: { scope: { project: PROJECT }, ids: [mem.forget] },
    });
    expect(forgot.status).toBe(200);
    await memories().updateOne({ _id: new ObjectId(mem.archive) }, { $set: { status: "archived" } });
    await memories().updateOne({ _id: new ObjectId(mem.expire) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    // Only the owner corrects: for B, A's memory isn't there.
    const notYours = await call(memoryRoutes.postCorrect, {
      token: B.key,
      body: { scope: { project: PROJECT }, id: mem.correct, text: "B's idea of the truth." },
    });
    expect(notYours.status).toBe(404);
    const corrected = await call(memoryRoutes.postCorrect, {
      token: A.key,
      body: {
        scope: { project: PROJECT },
        id: mem.correct,
        text: "Correction: the cart total is in cents, tax added last.",
      },
    });
    expect(corrected.status).toBe(201);
    expect(corrected.body.supersedes).toBe(mem.correct);
    const replacement = corrected.body.memory._id;
    const stored = await memories().findOne({ _id: new ObjectId(replacement) });
    expect(stored).toMatchObject({
      status: "active",
      trust: "explicit",
      kind: "fact",
      supersedes: new ObjectId(mem.correct),
    });
    expect(stored?.scope).toEqual({ org: "default", user: A.id, project: PROJECT });
    expect(stored?.embedding.length).toBeGreaterThan(0);
    expect(stored?.embeddingModel).toBeTruthy();
    expect((await memories().findOne({ _id: new ObjectId(mem.correct) }))?.status).toBe("superseded");
    expect(await auditCount("memory.correct", mem.correct)).toBe(1);
    // A second correction of the superseded one is refused.
    const again = await call(memoryRoutes.postCorrect, {
      token: A.key,
      body: { scope: { project: PROJECT }, id: mem.correct, text: "Another take." },
    });
    expect(again.status).toBe(409);

    const resumed = await call(routes.getResume, { token: B.key, id });
    expect(resumed.status).toBe(200);
    const byId = new Map(resumed.body.memories.map((m: { _id: string }) => [m._id, m]));
    expect([...byId.keys()]).toEqual([mem.keep, replacement, mem.everywhere]);
    expect(byId.get(replacement)).toMatchObject({
      correctionOf: mem.correct,
      text: expect.stringContaining("tax added"),
    });
    expect(resumed.body.excluded).toEqual([
      { _id: mem.forget, reason: "forgotten" },
      { _id: mem.archive, reason: "archived" },
      { _id: mem.expire, reason: "expired" },
    ]);
    expect(resumed.body.context).toContain(`(correction of ${mem.correct})`);
    expect(resumed.body.context).not.toContain("Checkout fact forget");
    // Each exclusion is on the timeline once, however often it's resumed.
    await call(routes.getResume, { token: B.key, id });
    const doc = await handoffs().findOne({ _id: new ObjectId(id) });
    expect(doc?.timeline.filter((e) => e.action === "memory_excluded")).toHaveLength(3);
  });

  it("follows a chain of corrections, and drops one whose chain ends nowhere active", async () => {
    const replacement = (await memories().findOne({ supersedes: new ObjectId(mem.correct) }))!._id.toHexString();
    const second = await call(memoryRoutes.postCorrect, {
      token: A.key,
      body: { scope: { project: PROJECT }, id: replacement, text: "Correction two: totals are integers of cents." },
    });
    expect(second.status).toBe(201);
    let resumed = await call(routes.getResume, { token: B.key, id });
    const latest = resumed.body.memories.find((m: { correctionOf: string | null }) => m.correctionOf === mem.correct);
    expect(latest?._id).toBe(second.body.memory._id);
    await memories().updateOne({ _id: new ObjectId(second.body.memory._id) }, { $set: { status: "archived" } });
    resumed = await call(routes.getResume, { token: B.key, id });
    expect(resumed.body.excluded).toContainEqual({ _id: mem.correct, reason: "superseded" });
  });

  it("B claims it, runs only its listed commands, and completes it verified", async () => {
    const claimed = await call(routes.postClaim, { token: B.key, id, body: { sessionID: "sess-b", repo } });
    expect(claimed.status).toBe(200);
    expect(claimed.body.handoff).toMatchObject({
      status: "claimed",
      continuation: { claimRepo: repo, verified: false },
    });
    // Claiming again from the same recipient is a no-op.
    expect((await call(routes.postClaim, { token: B.key, id, body: { repo } })).status).toBe(200);

    const unlisted = await call(routes.postTest, { token: B.key, id, body: run("rm -rf /", "pass") });
    expect(unlisted.status).toBe(400);
    expect(unlisted.body.error.code).toBe("unknown_command");
    // A can't add tests once it's out of draft.
    expect((await call(routes.postTest, { token: A.key, id, body: run("pnpm test", "pass") })).status).toBe(409);

    expect((await call(routes.postTest, { token: B.key, id, body: run("pnpm test", "fail") })).status).toBe(200);
    expect((await call(routes.postTest, { token: B.key, id, body: run("pnpm test", "pass") })).status).toBe(200);
    const last = await call(routes.postTest, { token: B.key, id, body: run("pnpm typecheck", "pass") });
    expect(last.body.handoff.tests.filter((t: { by: string }) => t.by === "recipient")).toHaveLength(3);

    const done = await call(routes.postComplete, {
      token: B.key,
      id,
      body: {
        summary: "Found the race in cart.ts",
        completed: ["Fixed the race"],
        repo: { ...repo, commit: "def5678" },
      },
    });
    expect(done.status).toBe(200);
    expect(done.body.handoff).toMatchObject({
      status: "completed",
      continuation: { verified: true, sessionID: "sess-b", summary: "Found the race in cart.ts" },
    });
    expect(done.body.handoff.completedAt).toBeTruthy();
    // Still readable by B once completed, and listed in B's inbox.
    expect((await call(routes.getHandoff, { token: B.key, id })).status).toBe(200);
  });

  it("can't be revoked once completed", async () => {
    const res = await call(routes.postRevoke, { token: A.key, id, body: { reason: "too late" } });
    expect(res.status).toBe(409);
  });

  it("has every step on its timeline and in the audit log", async () => {
    const doc = await handoffs().findOne({ _id: new ObjectId(id) });
    const actions = doc?.timeline.map((e) => e.action);
    for (const a of ["created", "edited", "test", "approved", "claimed", "completed", "memory_excluded"])
      expect(actions).toContain(a);
    for (const a of ["create", "edit", "approve", "read", "claim", "test", "complete", "denied"])
      expect(await auditCount(`handoff.${a}`, id)).toBeGreaterThan(0);
    expect(await auditCount("handoff.test", id)).toBe(4);
    const approve = await audits().findOne({ action: "handoff.approve", targetIds: id });
    expect(approve?.actor).toMatchObject({ kind: "key" });
  });
});

describe("revoking", () => {
  it("cuts the recipient off at once: every read is 404 again, and it leaves their inbox", async () => {
    const memory = await save(A, "A fact to share, then take back.");
    const id = (await call(routes.postHandoffs, { token: A.key, body: draft({ title: "To be revoked" }) })).body.handoff
      ._id;
    await call(routes.postApprove, { token: A.key, id, body: { recipientId: B.id, memoryIds: [memory] } });
    expect((await call(routes.getResume, { token: B.key, id })).status).toBe(200);
    await call(routes.postClaim, { token: B.key, id, body: { repo } });

    const revoked = await call(routes.postRevoke, { token: A.key, id, body: { reason: "Wrong person" } });
    expect(revoked.status).toBe(200);
    expect(revoked.body.handoff).toMatchObject({ status: "revoked", revokeReason: "Wrong person" });
    expect((await call(routes.getHandoff, { token: B.key, id })).status).toBe(404);
    expect((await call(routes.getResume, { token: B.key, id })).status).toBe(404);
    expect((await call(routes.postTest, { token: B.key, id, body: run("pnpm test", "pass") })).status).toBe(404);
    expect((await call(routes.postComplete, { token: B.key, id, body: { summary: "x", repo } })).status).toBe(404);
    const inbox = await call(routes.getHandoffs, { token: B.key, query: "?box=inbox" });
    expect(inbox.body.handoffs.map((h: { _id: string }) => h._id)).not.toContain(id);
    // The sender still has it, and revoking again changes nothing.
    expect((await call(routes.getHandoff, { token: A.key, id })).body.handoff.status).toBe("revoked");
    expect((await call(routes.postRevoke, { token: A.key, id })).status).toBe(200);
    expect(await auditCount("handoff.revoke", id)).toBe(1);
  });
});

describe("verification", () => {
  it("is false when the recipient only claims the tests passed", async () => {
    const id = (await call(routes.postHandoffs, { token: A.key, body: draft({ title: "Claims only" }) })).body.handoff
      ._id;
    await call(routes.postApprove, { token: A.key, id, body: { recipientId: B.id } });
    await call(routes.postClaim, { token: B.key, id, body: { repo } });
    await call(routes.postTest, { token: B.key, id, body: run("pnpm test", "pass", false) });
    const done = await call(routes.postComplete, { token: B.key, id, body: { summary: "Trust me", repo } });
    expect(done.status).toBe(200);
    expect(done.body.handoff.continuation.verified).toBe(false);
  });

  it("is false when the latest verified run failed", async () => {
    const id = (await call(routes.postHandoffs, { token: A.key, body: draft({ title: "Regressed" }) })).body.handoff
      ._id;
    await call(routes.postApprove, { token: A.key, id, body: { recipientId: B.id } });
    await call(routes.postClaim, { token: B.key, id, body: { repo } });
    await call(routes.postTest, { token: B.key, id, body: run("pnpm test", "pass") });
    await call(routes.postTest, { token: B.key, id, body: run("pnpm test", "fail") });
    const done = await call(routes.postComplete, { token: B.key, id, body: { summary: "Mostly", repo } });
    expect(done.body.handoff.continuation.verified).toBe(false);
  });

  it("moves only once when two completions race", async () => {
    const id = (await call(routes.postHandoffs, { token: A.key, body: draft({ title: "Race" }) })).body.handoff._id;
    await call(routes.postApprove, { token: A.key, id, body: { recipientId: B.id } });
    await call(routes.postClaim, { token: B.key, id, body: { repo } });
    const results = await Promise.all(
      [1, 2, 3].map(() => call(routes.postComplete, { token: B.key, id, body: { summary: "done", repo } })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const doc = await handoffs().findOne({ _id: new ObjectId(id) });
    expect(doc?.timeline.filter((e) => e.action === "completed")).toHaveLength(1);
  });
});

async function callerOf(who: Account) {
  return { userId: who.id, name: who.name, email: who.email, actor: { kind: "key" as const, id: "k", label: "test" } };
}
