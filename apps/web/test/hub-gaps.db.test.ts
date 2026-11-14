// Context gaps across sessions, and the hub's backfill, on a database of their own (test-database.ts): one gap per
// text per product, counted by session and by question (never by person), owned, resolved and reopened through the
// module, kept in line with approved work, and the backfill script run twice to the same result.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_hub_gaps");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { audits, gaps, members, records, summaryRevisions } = await import("../server/collections.ts");
const { Refusal } = await import("../server/people.ts");
const { gapHistory, getGap, listGaps, recordAskGap, reopenGap, resolveGap, syncGaps, takeGap } = await import(
  "../server/hub/gaps.ts"
);
const { runHubBackfill } = await import("../server/hub/backfill.ts");
type RecordDoc = import("../server/collections.ts").RecordDoc;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const BILLING = "github.com/acme/billing";
const SHOP = "github.com/acme/shop";
const ada = new ObjectId().toHexString();
const bo = new ObjectId().toHexString();
const cy = new ObjectId().toHexString();

let n = 0;
const gapRecord = (user: string, sessionID: string, project: string, text: string, approvedAt: Date | null) =>
  ({
    _id: new ObjectId(),
    scope: { org: "default", project, user },
    sessionID,
    kind: "context_gap",
    status: approvedAt ? "approved" : "draft",
    title: null,
    text,
    textKey: `g${++n}`,
    refs: [],
    eventIds: [],
    edited: false,
    createdAt: approvedAt ?? new Date(),
    updatedAt: approvedAt ?? new Date(),
    approvedAt,
    memoryId: null,
  }) satisfies RecordDoc;

const summaryWithGaps = (userId: string, sessionId: string, remote: string, approvedAt: Date, gapLines: string[]) => ({
  v: 1,
  userId,
  authorName: null,
  sessionId,
  projectId: new ObjectId().toHexString(),
  revision: 1,
  idempotencyKey: `${sessionId}:1`,
  updatedAt: approvedAt,
  receivedAt: approvedAt,
  client: null,
  repo: { remote, branch: "main", head: "abc1234" },
  links: { jira: [], pr: null, noTicket: true },
  summary: {
    title: "A session",
    built: "Something.",
    why: "",
    decisions: [],
    areas: [],
    open: [],
    insights: [],
    workflow: [],
    painPoints: [],
    gaps: gapLines,
  },
  files: [],
  review: { approved: true as const, approvedAt, edited: false },
});

let shopGapRecord: RecordDoc;

beforeAll(async () => {
  await ensureIndexes();
  const at = new Date();
  await db()
    .collection("user")
    .insertMany(
      [
        [ada, "Ada Lovelace"],
        [bo, "Bo Diddley"],
      ].map(([id, person]) => ({ _id: new ObjectId(id), name: person, email: `${id}@example.com`, createdAt: at })),
    );
  await members().insertOne({ _id: cy, role: "engineer", suspendedAt: at, createdAt: at, updatedAt: at });
  shopGapRecord = gapRecord(bo, "s6", SHOP, "No docs for the retry budget.", ago(1));
  await records().insertMany([
    gapRecord(ada, "s1", BILLING, "No docs for the retry budget.", ago(3)),
    gapRecord(bo, "s2", BILLING, "no docs for the retry-budget", ago(2)),
    gapRecord(ada, "s1", BILLING, "A draft gap nobody else sees.", null),
    shopGapRecord,
  ]);
  await summaryRevisions().insertMany([
    summaryWithGaps(ada, "s1", "git@github.com:acme/billing.git", ago(1), ["No docs for the retry budget"]),
    summaryWithGaps(bo, "s3", "https://github.com/acme/billing.git", ago(1), ["Where is the staging env list?"]),
  ]);
});
afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

const byText = async (text: string, viewer = bo) => (await listGaps({}, viewer)).find((g) => g.text === text);

describe("gaps from approved work", () => {
  it("makes one gap per text per product, counted once per session, from records and summaries", async () => {
    expect(await syncGaps()).toEqual({ gaps: 3, created: 3, updated: 0, removed: 0 });
    const retry = await byText("No docs for the retry budget.");
    expect(retry).toMatchObject({ productId: "billing", sessions: 2, fromAgents: 2, fromPeople: 0, status: "open" });
    // First seen in s1's record (three days ago), last in s2's (two days ago): s1's summary line is the same session.
    expect(retry?.firstSeen.getTime()).toBeLessThan(ago(2.5).getTime());
    expect(retry?.lastSeen.getTime()).toBeGreaterThan(ago(2.5).getTime());
    expect(retry?.lastSeen.getTime()).toBeLessThan(ago(1.5).getTime());
    expect(await byText("Where is the staging env list?")).toMatchObject({ productId: "billing", sessions: 1 });
    const shop = (await listGaps({ productId: "shop" }, bo)).map((g) => g.text);
    expect(shop).toEqual(["No docs for the retry budget."]);
    expect((await listGaps({}, bo)).map((g) => g.text)).not.toContain("A draft gap nobody else sees.");
  });

  it("changes nothing when run again", async () => {
    const before = await gaps().find().toArray();
    expect(await syncGaps()).toEqual({ gaps: 3, created: 0, updated: 0, removed: 0 });
    expect(await gaps().find().toArray()).toEqual(before);
  });
});

describe("questions Ask Strata couldn't answer", () => {
  it("count toward the gap with the same text, open a new one, or count toward the one named", async () => {
    expect(await recordAskGap("No docs for the retry budget?", "billing")).toMatchObject({ created: false });
    const asked = await recordAskGap("How do refunds reconcile with the ledger?", "billing");
    expect(asked.created).toBe(true);
    const staging = await byText("Where is the staging env list?");
    expect(await recordAskGap("Which variables does staging need?", null, { gapId: staging!.id })).toEqual({
      id: staging!.id,
      created: false,
    });
    expect(await byText("No docs for the retry budget.")).toMatchObject({ sessions: 2, fromAgents: 2, fromPeople: 1 });
    expect(await byText("How do refunds reconcile with the ledger?")).toMatchObject({
      sessions: 0,
      fromAgents: 0,
      fromPeople: 1,
    });
    // Who asked is kept nowhere.
    const raw = JSON.stringify(await gaps().find().toArray());
    for (const id of [ada, bo]) expect(raw).not.toContain(id);
  });

  it("are kept when approved work is synced again", async () => {
    expect(await syncGaps()).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(await byText("No docs for the retry budget.")).toMatchObject({ fromPeople: 1 });
  });

  it("refuse an empty question", async () => {
    await expect(recordAskGap("   ", "billing")).rejects.toBeInstanceOf(Refusal);
  });
});

describe("listing", () => {
  it("ranks open gaps by how often they come back, and filters by source and product", async () => {
    const texts = (await listGaps({ status: "open" }, bo)).map((g) => g.text);
    expect(texts).toEqual([
      "No docs for the retry budget.",
      "Where is the staging env list?",
      "How do refunds reconcile with the ledger?",
      "No docs for the retry budget.",
    ]);
    const people = await listGaps({ source: "people" }, bo);
    expect(people.every((g) => g.fromPeople > 0)).toBe(true);
    expect(people).toHaveLength(3);
    const agents = await listGaps({ source: "agents" }, bo);
    expect(agents.every((g) => g.fromAgents > 0)).toBe(true);
    expect(agents).toHaveLength(3);
  });

  it("gives a gap's sessions, newest first", async () => {
    const retry = await byText("No docs for the retry budget.");
    const detail = await getGap(retry!.id, ada);
    expect(detail?.sessionIds).toEqual(["s2", "s1"]);
    expect(detail?.sourceIds).toEqual(expect.arrayContaining(["session:s1", "session:s2"]));
    expect(await getGap("not-an-id", ada)).toBeNull();
  });
});

describe("owning and resolving", () => {
  it("lets anyone take a gap on, resolve it with what answers it, and reopen it, each in the audit log", async () => {
    const retry = await byText("No docs for the retry budget.");
    expect((await takeGap(retry!.id, bo)).owner).toEqual({ id: bo, name: "Bo Diddley" });
    await expect(resolveGap(retry!.id, bo, { url: "not a link", note: "" })).rejects.toBeInstanceOf(Refusal);
    await expect(resolveGap(retry!.id, bo, { note: "  " })).rejects.toBeInstanceOf(Refusal);
    const resolved = await resolveGap(
      retry!.id,
      { userId: ada },
      { url: "https://wiki.example.com/retry", note: "Documented." },
    );
    expect(resolved).toMatchObject({
      status: "resolved",
      resolution: { url: "https://wiki.example.com/retry", note: "Documented." },
      owner: { id: bo, name: "Bo Diddley" },
      seenSinceResolved: false,
    });
    const resolvedList = await listGaps({ status: "resolved" }, bo);
    expect(resolvedList.map((g) => g.id)).toEqual([retry!.id]);
    expect((await listGaps({}, bo)).at(-1)?.id).toBe(retry!.id);

    // It came up again after it was resolved.
    await records().insertOne(
      gapRecord(ada, "s7", BILLING, "No docs for the retry budget", new Date(Date.now() + 1000)),
    );
    await syncGaps();
    expect(await getGap(retry!.id, bo)).toMatchObject({ status: "resolved", sessions: 3, seenSinceResolved: true });

    const reopened = await reopenGap(retry!.id, bo);
    expect(reopened).toMatchObject({ status: "open", resolution: null, seenSinceResolved: false });
    const trail = await audits().find({ targetIds: retry!.id }).sort({ ts: 1 }).toArray();
    expect(trail.map((a) => [a.action, a.actor.id])).toEqual([
      ["gap.take", bo],
      ["gap.resolve", ada],
      ["gap.reopen", bo],
    ]);
  });

  it("needs a note to resolve a gap, a link alone isn't enough", async () => {
    const retry = await byText("No docs for the retry budget.");
    for (const input of [
      { url: "https://wiki.example.com/retry", note: "" },
      { url: "https://wiki.example.com/retry", note: "   " },
      { note: "x".repeat(1001) },
      null as unknown as { note: string },
    ])
      await expect(resolveGap(retry!.id, bo, input), JSON.stringify(input)).rejects.toThrow(/note/);
    expect(await getGap(retry!.id, bo)).toMatchObject({ status: "open", resolution: null });
  });

  it("gives a gap's history, newest first: each time it came up, and who changed it", async () => {
    const retry = await byText("No docs for the retry budget.");
    const history = await gapHistory(retry!.id, bo);
    const count = (kind: string) => history.filter((e) => e.kind === kind).length;
    expect([count("session"), count("question"), count("take"), count("resolve"), count("reopen")]).toEqual([
      3, 1, 1, 1, 1,
    ]);
    for (let i = 1; i < history.length; i++) expect(history[i - 1]!.at >= history[i]!.at).toBe(true);
    expect(history.filter((e) => e.kind === "session").map((e) => "sessionId" in e && e.sessionId)).toEqual(
      expect.arrayContaining(["s1", "s2", "s7"]),
    );
    expect(history.find((e) => e.kind === "resolve")).toMatchObject({
      by: "Ada Lovelace",
      url: "https://wiki.example.com/retry",
    });
    expect(history.find((e) => e.kind === "take")).toMatchObject({ by: "Bo Diddley", url: null });
    // Nobody is named behind a session or a question.
    for (const e of history.filter((e) => e.kind === "session" || e.kind === "question"))
      expect(e).not.toHaveProperty("by");
    expect(await gapHistory(retry!.id, bo, 2)).toHaveLength(2);
    expect(await gapHistory(retry!.id.toUpperCase(), bo)).toEqual(history);
  });

  it("gives no history to a suspended person, or for a gap that isn't there", async () => {
    const retry = await byText("No docs for the retry budget.");
    expect(await gapHistory(retry!.id, cy)).toEqual([]);
    expect(await gapHistory("not-an-id", bo)).toEqual([]);
    expect(await gapHistory(new ObjectId().toHexString(), bo)).toEqual([]);
  });

  it("refuses a suspended person, and a gap that isn't there", async () => {
    const retry = await byText("No docs for the retry budget.");
    await expect(takeGap(retry!.id, cy)).rejects.toBeInstanceOf(Refusal);
    await expect(takeGap(new ObjectId().toHexString(), bo)).rejects.toBeInstanceOf(Refusal);
    expect(await listGaps({}, cy)).toEqual([]);
    expect(await getGap(retry!.id, cy)).toBeNull();
  });

  it("drops a gap whose only source is no longer approved, unless someone has it", async () => {
    await records().updateOne({ _id: shopGapRecord._id }, { $set: { status: "discarded", approvedAt: null } });
    expect(await syncGaps()).toMatchObject({ removed: 1 });
    expect(await listGaps({ productId: "shop" }, bo)).toEqual([]);
  });
});

describe("the backfill", () => {
  it("does everything once: a second run finds nothing left to do", async () => {
    await runHubBackfill();
    const second = await runHubBackfill();
    expect(second.products.created).toEqual([]);
    expect(second.signals.counted).toBe(0);
    expect(second.gaps).toMatchObject({ created: 0, updated: 0, removed: 0 });
  });

  it("runs as pnpm hub:backfill does, on this test's database and no other", async () => {
    const uri = process.env.MONGODB_URI ?? "";
    expect(new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname).toBe(`/${name}`);
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ["scripts/hub-backfill.ts"], {
      cwd,
      env: { ...process.env, MONGODB_URI: uri },
      timeout: 120_000,
    });
    expect(stdout).toContain("hub:backfill: products: 0 made");
    expect(stdout).toContain("signal_daily: 0 tool runs counted");
    expect(stdout).toContain("0 new, 0 updated, 0 removed");
    expect(stdout).toContain("hub:backfill: done");
  });
});
