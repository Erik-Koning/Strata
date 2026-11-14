// The overview by role, on a database of its own (test-database.ts): what's waiting for each person's own review; an
// engineer's products (those they've shared work in, else every product) with this week's news, their open gaps and
// their own sessions; every product for a manager, an executive and an admin, with what shipped, time lost on tools,
// the gaps that come back most and what's in progress. Drafts stay their author's: nobody else's overview counts or
// shows them. A suspended person gets nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_overview");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { apiKeys, events, members, memories, records, signalDaily, summaryRevisions, teams } = await import(
  "../server/collections.ts"
);
const { ensureProducts } = await import("../server/hub/products.ts");
const { syncGaps } = await import("../server/hub/gaps.ts");
const { itemKeyOf } = await import("../server/hub/signals.ts");
const { dayKey } = await import("../server/hub/text.ts");
const { HOUR_MS } = await import("../server/hub/time-math.ts");
const { homeFor } = await import("../server/hub/overview.ts");
type RecordDoc = import("../server/collections.ts").RecordDoc;
type MemoryDoc = import("../server/collections.ts").MemoryDoc;
type SummaryRevisionDoc = import("../server/collections.ts").SummaryRevisionDoc;
type Home = import("../server/hub/overview.ts").Home;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const BILLING = "github.com/acme/billing";
const SHOP = "github.com/acme/shop";
const SECRET = "github.com/acme/secret";
const DRAFTS = ["A draft only Ada sees.", "Another of Ada's drafts."];

const id = () => new ObjectId().toHexString();
const ada = id(); // engineer, uses the plugin, shares work in billing
const dan = id(); // engineer, shared nothing yet, no plugin
const bo = id(); // manager of a team, uses the plugin
const eve = id(); // executive
const ann = id(); // admin
const cy = id(); // suspended

let n = 0;
function record(
  user: string,
  sessionID: string,
  project: string,
  kind: RecordDoc["kind"],
  text: string,
  extra: Partial<RecordDoc> = {},
): RecordDoc {
  const at = extra.approvedAt ?? ago(1);
  return {
    _id: new ObjectId(),
    scope: { org: "default", project, user },
    sessionID,
    kind,
    status: "approved",
    title: null,
    text,
    textKey: `k${++n}`,
    refs: [],
    eventIds: [],
    edited: false,
    createdAt: at,
    updatedAt: at,
    approvedAt: at,
    memoryId: null,
    ...extra,
  };
}

function summary(
  userId: string,
  sessionId: string,
  remote: string,
  approvedAt: Date,
  fields: Partial<SummaryRevisionDoc["summary"]>,
): SummaryRevisionDoc {
  return {
    v: 1,
    userId,
    authorName: "Stored name",
    sessionId,
    projectId: id(),
    revision: 1,
    idempotencyKey: `${sessionId}:1`,
    updatedAt: approvedAt,
    receivedAt: approvedAt,
    client: null,
    repo: { remote, branch: "main", head: "abc1234" },
    links: { jira: [], pr: null, noTicket: true },
    summary: {
      title: "",
      built: "",
      why: "",
      decisions: [],
      areas: [],
      open: [],
      insights: [],
      workflow: [],
      painPoints: [],
      gaps: [],
      ...fields,
    },
    files: [],
    review: { approved: true, approvedAt, edited: false },
  };
}

const failedRow = (productId: string, repo: string, cls: string, fp: string, hours: number, daysAgo = 1) => ({
  day: dayKey(ago(daysAgo)),
  productId,
  repo,
  class: cls,
  fp,
  item: itemKeyOf(repo, cls, fp),
  runs: 3,
  failures: 3,
  reruns: 0,
  timedRuns: 3,
  totalMs: hours * HOUR_MS,
  failedMs: hours * HOUR_MS,
  rerunMs: 0,
  hist: {},
  okHist: {},
  updatedAt: new Date(),
});

const memory = (user: string, status: MemoryDoc["status"], text: string): MemoryDoc => ({
  _id: new ObjectId(),
  scope: { org: "default", project: BILLING, user },
  kind: "fact",
  text,
  textKey: `m${++n}`,
  embedding: [],
  provenance: { sessionID: "s1", messageID: null, eventId: null, source: "assistant" },
  trust: "inferred",
  confidence: 0.5,
  status,
  supersedes: null,
  createdAt: ago(1),
  updatedAt: ago(1),
  expiresAt: null,
});

const usedKey = (userId: string, lastUsedAt: Date) => ({
  _id: new ObjectId(),
  userId,
  name: "laptop",
  prefix: "sk_test",
  hash: `h${++n}`,
  createdAt: ago(10),
  lastUsedAt,
  lastClient: "claude-code/1",
  revokedAt: null,
});

const sessionEvent = (user: string, sessionID: string, kind: string, at: Date) => ({
  v: 1,
  id: `e${++n}`,
  sessionID,
  scope: { org: "default", project: BILLING, user },
  kind,
  payload: kind === "session" ? { event: "start", git: { remote: BILLING, path: "" } } : { text: "hello" },
  promptID: null,
  known: true,
  ts: at,
  receivedAt: at,
  client: "claude-code/1",
});

const read = async (viewer: string): Promise<Home> => {
  const home = await homeFor(viewer);
  if (!home) throw new Error("no home");
  return home;
};

beforeAll(async () => {
  await ensureIndexes();
  const now = new Date();
  await db()
    .collection("user")
    .insertMany(
      [
        [ada, "Ada Lovelace"],
        [dan, "Dan Brown"],
        [bo, "Bo Diddley"],
        [eve, "Eve Arden"],
        [ann, "Ann Admin"],
        [cy, "Cy Twombly"],
      ].map(([userId, person]) => ({
        _id: new ObjectId(userId),
        name: person,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
  await members().insertMany([
    { _id: bo, role: "manager", suspendedAt: null, createdAt: now, updatedAt: now },
    { _id: eve, role: "exec", suspendedAt: null, createdAt: now, updatedAt: now },
    { _id: ann, role: "admin", suspendedAt: null, createdAt: now, updatedAt: now },
    { _id: cy, role: "manager", suspendedAt: now, createdAt: now, updatedAt: now },
  ]);
  await teams().insertOne({
    _id: new ObjectId(),
    name: "Payments",
    memberIds: [ada],
    managerIds: [bo],
    createdAt: now,
  });
  await apiKeys().insertMany([usedKey(ada, new Date()), usedKey(bo, ago(2))]);
  await memories().insertMany([
    memory(ada, "candidate", "Ada's suggested memory."),
    memory(ada, "active", "Ada's kept memory."),
    memory(bo, "active", "Bo's own memory."),
  ]);

  await records().insertMany([
    record(ada, "s1", BILLING, "summary", "Payments retry with backoff.", {
      title: "Retry with backoff",
      refs: [{ type: "ticket", id: "PAY-1" }],
    }),
    record(ada, "s1", BILLING, "context_gap", "No docs for the retry budget."),
    record(ada, "s1", BILLING, "insight", DRAFTS[0] as string, { status: "draft", approvedAt: null }),
    record(ada, "s9", BILLING, "pain_point", DRAFTS[1] as string, { status: "draft", approvedAt: null }),
    record(bo, "s3", SHOP, "context_gap", "No docs for the tax table.", { approvedAt: ago(2) }),
    record(bo, "s3b", SHOP, "context_gap", "No docs for the tax table.", { approvedAt: ago(3) }),
  ]);
  await summaryRevisions().insertMany([
    summary(bo, "s3", `https://${SHOP}.git`, ago(2), {
      title: "Checkout tax",
      built: "Checkout shows tax per line.",
      open: ["Do refunds include tax?"],
    }),
    summary(bo, "s5", BILLING, ago(20), { title: "Older billing work", built: "Invoices list." }),
  ]);
  // Ada's own sessions, as her plugin sent them: s1 she shared, s7 she hasn't.
  await events().insertMany([
    sessionEvent(ada, "s1", "session", ago(1.2)),
    sessionEvent(ada, "s1", "prompt", ago(1.1)),
    sessionEvent(ada, "s7", "session", ago(0.2)),
    sessionEvent(ada, "s7", "prompt", ago(0.1)),
    // Cy's own events in a repository nobody shared: it gets a product, never shown.
    { ...sessionEvent(cy, "s-secret", "session", ago(1)), scope: { org: "default", project: SECRET, user: cy } },
  ]);
  await ensureProducts();
  await syncGaps();
  await signalDaily().insertMany([
    failedRow("billing", BILLING, "test", "1111111111111111", 3),
    failedRow("billing", BILLING, "build", "2222222222222222", 2),
    failedRow("shop", SHOP, "lint", "3333333333333333", 1),
    failedRow("billing", BILLING, "install", "4444444444444444", 0.5),
    // Older than the month shown.
    failedRow("billing", BILLING, "test", "5555555555555555", 9, 45),
    // A product nobody can see yet.
    failedRow("secret", SECRET, "test", "6666666666666666", 4),
  ]);
});

afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("what's waiting", () => {
  it("counts the person's own drafts and candidate memories, and links My Day only for plugin users", async () => {
    const home = await read(ada);
    expect(home.usesPlugin).toBe(true);
    expect(home.waiting).toEqual({ drafts: 2, candidates: 1 });
  });

  it("never counts someone else's: a manager who uses the plugin has none waiting", async () => {
    expect((await read(bo)).waiting).toEqual({ drafts: 0, candidates: 0 });
  });

  it("has no drafts to go to for someone who doesn't use the plugin", async () => {
    expect((await read(dan)).waiting).toEqual({ drafts: null, candidates: 0 });
    expect((await read(eve)).waiting).toEqual({ drafts: null, candidates: 0 });
  });
});

describe("an engineer", () => {
  it("sees the products they've shared work in, each with this week's news", async () => {
    const home = await read(ada);
    expect(home.layout).toMatchObject({ role: "engineer", view: "engineer", teamsHint: false, admin: false });
    expect(home.lead).toBeNull();
    const engineer = home.engineer;
    expect(engineer?.mine).toBe(true);
    expect(engineer?.products.map((p) => p.id)).toEqual(["billing"]);
    const billing = engineer?.products[0];
    expect(billing?.repos).toEqual([BILLING]);
    expect(billing?.sessions.map((s) => s.sessionId)).toEqual(["s1"]);
    expect(billing?.sessions[0]?.summary?.title).toBe("Retry with backoff");
    expect(billing?.sessions[0]?.refs.map((r) => r.label)).toEqual(["PAY-1"]);
    // Older work isn't this week's.
    expect(JSON.stringify(engineer)).not.toContain("Older billing work");
  });

  it("sees the open gaps on those products only", async () => {
    const engineer = (await read(ada)).engineer;
    expect(engineer?.gaps.map((g) => g.text)).toEqual(["No docs for the retry budget."]);
    expect(engineer?.gaps[0]).toMatchObject({ productId: "billing", productName: "billing", sessions: 1 });
    expect(engineer?.openGaps).toBe(1);
  });

  it("sees their own recent sessions, marked when they've shared work from them", async () => {
    const sessions = (await read(ada)).engineer?.sessions ?? [];
    expect(sessions.map((s) => [s.id, s.shared])).toEqual([
      ["s7", false],
      ["s1", true],
    ]);
    expect(sessions[0]).toMatchObject({ project: BILLING, prompts: 1 });
  });

  it("sees every product, and every product's gaps, until they've shared work", async () => {
    const engineer = (await read(dan)).engineer;
    expect(engineer?.mine).toBe(false);
    expect(engineer?.products.map((p) => p.id)).toEqual(["billing", "shop"]);
    // The tax table came up in two sessions, so it comes first.
    expect(engineer?.gaps.map((g) => g.text)).toEqual(["No docs for the tax table.", "No docs for the retry budget."]);
    expect(engineer?.sessions).toEqual([]);
  });
});

describe("a manager, an executive and an admin", () => {
  it("see every product: what shipped this week, time lost this month, gaps and work in progress", async () => {
    const home = await read(bo);
    expect(home.layout).toMatchObject({ role: "manager", view: "lead", teamsHint: true, admin: false });
    expect(home.engineer).toBeNull();
    const lead = home.lead;
    expect(lead?.shipped.map((p) => p.id)).toEqual(["billing", "shop"]);
    expect(lead?.shipped[1]?.sessions[0]?.summary?.title).toBe("Checkout tax");
    expect(JSON.stringify(lead?.shipped)).not.toContain("Older billing work");

    expect(lead?.time.commands).toBe(4);
    expect(lead?.time.totalMs).toBe(6.5 * HOUR_MS);
    expect(lead?.time.top.map((t) => [t.class, t.productName, t.lostMs])).toEqual([
      ["test", "billing", 3 * HOUR_MS],
      ["build", "billing", 2 * HOUR_MS],
      ["lint", "shop", 1 * HOUR_MS],
    ]);
    expect(lead?.time.top[0]?.anchor).toBe(`item-${itemKeyOf(BILLING, "test", "1111111111111111")}-billing`);

    expect(lead?.gaps.map((g) => g.text)).toEqual(["No docs for the tax table.", "No docs for the retry budget."]);
    expect(lead?.openGaps).toBe(2);

    const checkout = lead?.work.find((w) => w.title === "Checkout tax");
    expect(checkout).toMatchObject({ productId: "shop", productName: "shop", people: ["Bo Diddley"] });
    expect(checkout?.open.map((q) => q.text)).toEqual(["Do refunds include tax?"]);
  });

  it("an executive's has no teams hint, an admin's has the way to people", async () => {
    expect((await read(eve)).layout).toMatchObject({ role: "exec", view: "lead", teamsHint: false, admin: false });
    const admin = await read(ann);
    expect(admin.layout).toMatchObject({ role: "admin", view: "lead", teamsHint: false, admin: true });
    expect(admin.lead?.shipped.map((p) => p.id)).toEqual(["billing", "shop"]);
  });
});

describe("privacy", () => {
  it("never shows anyone a draft, the author included, and counts drafts only for their author", async () => {
    for (const viewer of [ada, dan, bo, eve, ann]) {
      const text = JSON.stringify(await read(viewer));
      for (const draft of DRAFTS) expect(text).not.toContain(draft);
      // A session that holds nothing but drafts isn't news to anyone.
      expect(text).not.toContain('"sessionId":"s9"');
    }
  });

  it("names no repository that only someone's own events know", async () => {
    for (const viewer of [ada, bo, ann]) expect(JSON.stringify(await read(viewer))).not.toContain("secret");
  });

  it("keeps the agent section to the person's own connection", async () => {
    const ada_ = await read(ada);
    expect(ada_.agent).toMatchObject({ keys: 1, live: true, project: BILLING });
    expect(ada_.agent.lastSeen?.client).toBe("claude-code/1");
    const eve_ = await read(eve);
    expect(eve_.agent).toEqual({ keys: 0, lastSeen: null, live: false, project: null });
  });

  it("gives a suspended person nothing", async () => {
    expect(await homeFor(cy)).toBeNull();
  });
});
