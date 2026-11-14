// Products and the team read model, on a database of their own (test-database.ts): approved work from both stores
// read as one, duplicates in a session dropped, drafts their author's alone, a suspended viewer shown nothing, and a
// repository that appears only in someone's own events never listed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_hub_read");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { events, members, products, records, summaryRevisions } = await import("../server/collections.ts");
const { ensureProducts, getProduct, listProducts, productFor } = await import("../server/hub/products.ts");
const { contributorsFor, inProgress, recordsFor, sessionDetail, whatsNew } = await import(
  "../server/hub/team-records.ts"
);
type RecordDoc = import("../server/collections.ts").RecordDoc;
type SummaryRevisionDoc = import("../server/collections.ts").SummaryRevisionDoc;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const BILLING = "github.com/acme/billing";
const SHOP = "github.com/acme/shop";
const SECRET = "github.com/acme/secret";
const OTHER = "github.com/other/billing";

const ada = new ObjectId().toHexString();
const bo = new ObjectId().toHexString();
const cy = new ObjectId().toHexString();

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
  revision: number,
  remote: string,
  approvedAt: Date,
  fields: Partial<SummaryRevisionDoc["summary"]>,
  links: Partial<SummaryRevisionDoc["links"]> = {},
): SummaryRevisionDoc {
  return {
    v: 1,
    userId,
    authorName: "Stored name",
    sessionId,
    projectId: new ObjectId().toHexString(),
    revision,
    idempotencyKey: `${sessionId}:${revision}`,
    updatedAt: approvedAt,
    receivedAt: approvedAt,
    client: null,
    repo: { remote, branch: "main", head: "abc1234" },
    links: { jira: [], pr: null, noTicket: false, ...links },
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
    files: ["src/retry.ts"],
    review: { approved: true, approvedAt, edited: false },
  };
}

beforeAll(async () => {
  await ensureIndexes();
  const now = new Date();
  await db()
    .collection("user")
    .insertMany(
      [
        [ada, "Ada Lovelace"],
        [bo, "Bo Diddley"],
        [cy, "Cy Twombly"],
      ].map(([id, person]) => ({
        _id: new ObjectId(id),
        name: person,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
  await members().insertOne({ _id: cy, role: "admin", suspendedAt: now, createdAt: now, updatedAt: now });
  await records().insertMany([
    record(ada, "s1", BILLING, "summary", "Payments retry with backoff.", {
      title: "Retry with backoff",
      refs: [{ type: "ticket", id: "PAY-1" }],
    }),
    record(ada, "s1", BILLING, "insight", "The ledger rounds per line."),
    record(ada, "s1", BILLING, "insight", "A draft only Ada sees.", { status: "draft", approvedAt: null }),
    record(ada, "s-drafts", BILLING, "insight", "Ada's other draft.", { status: "draft", approvedAt: null }),
    record(bo, "s2", BILLING, "context_gap", "No docs for the retry budget.", {
      approvedAt: ago(2),
      refs: [{ type: "ticket", id: "PAY-2" }],
    }),
    record(bo, "s2", BILLING, "insight", "A discarded line.", { status: "discarded", approvedAt: null }),
    record(bo, "s4", "scratch", "workflow", "Run the seed before the tests."),
    record(bo, "s5", OTHER, "insight", "The other billing has its own ledger.", { approvedAt: ago(5) }),
    record(cy, "s9", BILLING, "insight", "Cy approved this before being suspended."),
  ]);
  await summaryRevisions().insertMany([
    summary(ada, "s1", 1, "git@github.com:acme/billing.git", ago(2), { title: "Old title", built: "An old draft." }),
    summary(
      ada,
      "s1",
      2,
      "git@github.com:acme/billing.git",
      ago(1),
      {
        title: "Retry with backoff",
        built: "Payments retry with backoff, capped at three.",
        areas: ["payments", "ledger"],
        open: ["Should refunds retry too?"],
        insights: ["the ledger rounds per line"],
        gaps: ["No docs for the retry budget"],
      },
      { jira: ["PAY-1"] },
    ),
    summary(
      bo,
      "s3",
      1,
      "https://github.com/acme/shop.git",
      ago(10),
      { title: "Checkout tax", built: "Checkout shows tax per line.", areas: ["checkout"] },
      { pr: { number: 7, url: "https://github.com/acme/shop/pull/7" }, noTicket: true },
    ),
  ]);
  // Cy's own events in a repository no approved work names: a product is made for it, but never listed.
  await events().insertMany(
    [
      { kind: "session", payload: { event: "start", git: { remote: SECRET, path: "" } } },
      {
        kind: "tool",
        payload: { tool: "Bash", status: "ok", ms: 50, command: { class: "test", fp: "0123456789abcdef" } },
      },
    ].map((e, i) => ({
      v: 1,
      id: `secret-${i}`,
      sessionID: "s-secret",
      scope: { org: "default", project: SECRET, user: cy },
      kind: e.kind,
      payload: e.payload,
      promptID: null,
      known: true,
      ts: ago(1),
      receivedAt: ago(1),
      client: null,
    })),
  );
  // Ada's own tool time in s1, which only she sees on the session's page.
  await events().insertOne({
    v: 1,
    id: "ada-tool",
    sessionID: "s1",
    scope: { org: "default", project: BILLING, user: ada },
    kind: "tool",
    payload: { tool: "Bash", status: "error", ms: 1500, command: { class: "test", exit: 1, fp: "fedcba9876543210" } },
    promptID: null,
    known: true,
    ts: ago(1),
    receivedAt: ago(1),
    client: null,
  });
});

afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("products", () => {
  it("makes one product per repository seen, named after it, and making them again makes none", async () => {
    const first = await ensureProducts();
    expect(first.created.map((p) => p.id).sort()).toEqual(["billing", "other-billing", "secret", "shop"]);
    expect(first.created.find((p) => p.id === "billing")).toMatchObject({
      name: "billing",
      repos: [{ repo: BILLING, path: "" }],
    });
    const again = await ensureProducts();
    expect(again.created).toEqual([]);
    expect(again.total).toBe(4);
    expect(await products().countDocuments()).toBe(4);
  });

  it("lists only products with approved work: a repository in someone's own events stays theirs", async () => {
    expect((await listProducts(bo)).map((p) => p.id)).toEqual(["billing", "other-billing", "shop"]);
    expect(await getProduct("secret", bo)).toBeNull();
    expect((await getProduct("shop", bo))?.repos).toEqual([{ repo: SHOP, path: "" }]);
    expect((await productFor("git@github.com:acme/secret.git"))?.id).toBe("secret");
    expect(await productFor("scratch")).toBeNull();
  });

  it("shows a suspended viewer no products", async () => {
    expect(await listProducts(cy)).toEqual([]);
    expect(await getProduct("billing", cy)).toBeNull();
  });
});

describe("the team read model", () => {
  it("reads approved work from both stores, the latest summary only, one line per session", async () => {
    const all = await recordsFor({}, bo);
    const texts = all.map((r) => r.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "Payments retry with backoff.",
        "The ledger rounds per line.",
        "No docs for the retry budget.",
        "Payments retry with backoff, capped at three.",
        "Should refunds retry too?",
        "No docs for the retry budget",
        "Checkout shows tax per line.",
        "Run the seed before the tests.",
        "Cy approved this before being suspended.",
      ]),
    );
    // Drafts and discarded records are nobody's but their author's, and the older revision is gone.
    for (const hidden of ["A draft only Ada sees.", "Ada's other draft.", "A discarded line.", "An old draft."])
      expect(texts).not.toContain(hidden);
    // The summary's copy of the record's insight, in the same session, is dropped; the record's stays.
    const ledger = all.filter((r) => r.text.toLowerCase().startsWith("the ledger rounds"));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ source: "record", status: "approved", productId: "billing" });
    expect(all.every((r) => r.status === "approved")).toBe(true);
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.at >= all[i]!.at).toBe(true);
  });

  it("fills in the product, the author's name and the links", async () => {
    const all = await recordsFor({}, ada);
    const built = all.find((r) => r.text === "Payments retry with backoff, capped at three.");
    expect(built).toMatchObject({
      kind: "summary",
      title: "Retry with backoff",
      productId: "billing",
      repo: BILLING,
      sessionId: "s1",
      areas: ["payments", "ledger"],
      author: { id: ada, name: "Ada Lovelace" },
      source: "summary",
    });
    expect(built?.refs).toEqual([{ type: "ticket", id: "PAY-1", system: "jira" }]);
    const scratch = all.find((r) => r.text === "Run the seed before the tests.");
    expect(scratch).toMatchObject({ productId: null, repo: "scratch" });
  });

  it("filters by product, kind, date and count", async () => {
    const billing = await recordsFor({ productId: "billing" }, bo);
    expect(billing.length).toBeGreaterThan(0);
    expect(billing.every((r) => r.productId === "billing")).toBe(true);
    expect(billing.map((r) => r.text)).not.toContain("Checkout shows tax per line.");
    const insights = await recordsFor({ kind: ["insight"] }, bo);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every((r) => r.kind === "insight")).toBe(true);
    const recent = await recordsFor({ since: ago(3) }, bo);
    expect(recent.map((r) => r.text)).not.toContain("Checkout shows tax per line.");
    expect(await recordsFor({ limit: 2 }, bo)).toHaveLength(2);
    expect(await recordsFor({ productId: "no-such-product" }, bo)).toEqual([]);
  });

  it("groups what's new by week, newest first, summaries apart from findings", async () => {
    const weeks = await whatsNew({ since: ago(30) }, bo);
    expect(weeks.length).toBeGreaterThan(0);
    for (const week of weeks) {
      expect(week.weekStart.getUTCDay()).toBe(1);
      expect(week.summaries.every((r) => r.kind === "summary")).toBe(true);
      expect(week.findings.every((r) => r.kind !== "summary" && r.kind !== "open")).toBe(true);
    }
    for (let i = 1; i < weeks.length; i++) expect(weeks[i - 1]!.weekStart > weeks[i]!.weekStart).toBe(true);
    const summaries = weeks.flatMap((w) => w.summaries.map((r) => r.text));
    expect(summaries).toEqual(expect.arrayContaining(["Checkout shows tax per line.", "Payments retry with backoff."]));
    const shop = await whatsNew({ productId: "shop", since: ago(30) }, bo);
    expect(shop.flatMap((w) => [...w.summaries, ...w.findings]).map((r) => r.text)).toEqual([
      "Checkout shows tax per line.",
    ]);
  });

  it("shows work in progress by ticket, then pull request, then session, with its open questions", async () => {
    const { work, open } = await inProgress({ since: ago(14) }, bo);
    const pay1 = work.find((w) => w.kind === "ticket" && w.key === "PAY-1");
    expect(pay1).toMatchObject({
      title: "Retry with backoff",
      productId: "billing",
      tickets: ["PAY-1"],
      sessionIds: ["s1"],
      people: [{ id: ada, name: "Ada Lovelace" }],
    });
    expect(pay1?.open.map((r) => r.text)).toEqual(["Should refunds retry too?"]);
    expect(work.find((w) => w.kind === "ticket" && w.key === "PAY-2")?.sessionIds).toEqual(["s2"]);
    expect(work.find((w) => w.kind === "pr")).toMatchObject({
      key: "https://github.com/acme/shop/pull/7",
      pr: { id: "7", url: "https://github.com/acme/shop/pull/7" },
    });
    expect(work.some((w) => w.kind === "session" && w.key === "s4")).toBe(true);
    expect(open.map((r) => r.text)).toEqual(["Should refunds retry too?"]);
    for (let i = 1; i < work.length; i++) expect(work[i - 1]!.lastAt >= work[i]!.lastAt).toBe(true);
    const recent = await inProgress({ since: ago(3) }, bo);
    expect(recent.work.some((w) => w.kind === "pr")).toBe(false);
  });

  it("names who worked on a product and its areas, alphabetically, and never counts them", async () => {
    const result = await contributorsFor("billing", bo);
    expect(result.people.map((p) => p.name)).toEqual(["Ada Lovelace", "Bo Diddley", "Cy Twombly"]);
    expect(result.areas.map((a) => a.area).sort()).toEqual(["ledger", "payments"]);
    expect(result.areas.every((a) => a.people.map((p) => p.name).join() === "Ada Lovelace")).toBe(true);
    // Who, never how much: nothing per person but their id and name.
    for (const person of [...result.people, ...result.areas.flatMap((a) => a.people)])
      expect(Object.keys(person).sort()).toEqual(["id", "name"]);
  });
});

describe("a session's page", () => {
  it("shows its author their drafts and their own tool time", async () => {
    const mine = await sessionDetail("s1", ada);
    expect(mine).toMatchObject({
      sessionId: "s1",
      title: "Retry with backoff",
      mine: true,
      productId: "billing",
      repo: BILLING,
      tickets: ["PAY-1"],
      author: { id: ada, name: "Ada Lovelace" },
      files: ["src/retry.ts"],
    });
    expect(mine?.summary?.built).toBe("Payments retry with backoff, capped at three.");
    expect(mine?.records.find((r) => r.text === "A draft only Ada sees.")?.status).toBe("draft");
    expect(mine?.records.at(-1)?.status).toBe("draft");
    expect(mine?.tools).toEqual([{ class: "test", runs: 1, failures: 1, totalMs: 1500 }]);
  });

  it("shows anyone else only the approved work, and no time", async () => {
    const theirs = await sessionDetail("s1", bo);
    expect(theirs?.mine).toBe(false);
    expect(theirs?.tools).toBeNull();
    expect(theirs?.records.every((r) => r.status === "approved")).toBe(true);
    expect(theirs?.records.map((r) => r.text)).not.toContain("A draft only Ada sees.");
    expect(await sessionDetail("s-drafts", bo)).toBeNull();
    expect((await sessionDetail("s-drafts", ada))?.records.map((r) => r.text)).toEqual(["Ada's other draft."]);
    expect(await sessionDetail("no-such-session", ada)).toBeNull();
  });
});

describe("a suspended viewer", () => {
  it("reads nothing at all, not even their own sessions", async () => {
    expect(await recordsFor({}, cy)).toEqual([]);
    expect(await whatsNew({ since: ago(30) }, { userId: cy })).toEqual([]);
    expect(await inProgress({}, cy)).toEqual({ work: [], open: [] });
    expect(await contributorsFor("billing", cy)).toEqual({ people: [], areas: [] });
    expect(await sessionDetail("s9", cy)).toBeNull();
  });
});

describe("a merged product", () => {
  it("sends its old id to the product it joined, whose reads include its work", async () => {
    await products().updateOne({ _id: "other-billing" }, { $set: { mergedInto: "billing", repos: [], repoKeys: [] } });
    await products().updateOne(
      { _id: "billing" },
      { $push: { repos: { repo: OTHER, path: "" }, repoKeys: `${OTHER}#` } },
    );
    expect((await getProduct("other-billing", bo))?.id).toBe("billing");
    expect((await listProducts(bo)).map((p) => p.id)).toEqual(["billing", "shop"]);
    const billing = await recordsFor({ productId: "other-billing" }, bo);
    expect(billing.map((r) => r.text)).toContain("The other billing has its own ledger.");
  });
});
