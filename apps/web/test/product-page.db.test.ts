// The products pages' data, on a database of their own (test-database.ts): the list with each product's latest work,
// open gaps and time lost; one product's page with What's new by week, In progress, and its side column; old ids of a
// merged product sent on; drafts, private repositories and suspended viewers kept out; people named, never counted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_products");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { events, members, products, records, signalDaily, summaryRevisions } = await import("../server/collections.ts");
const { ensureProducts } = await import("../server/hub/products.ts");
const { syncGaps } = await import("../server/hub/gaps.ts");
const { itemKeyOf } = await import("../server/hub/signals.ts");
const { dayKey } = await import("../server/hub/text.ts");
const { HOUR_MS } = await import("../server/hub/time-math.ts");
const { productCards, productPage } = await import("../server/hub/product-page.ts");
type RecordDoc = import("../server/collections.ts").RecordDoc;
type SummaryRevisionDoc = import("../server/collections.ts").SummaryRevisionDoc;
type ProductPage = import("../server/hub/product-page.ts").ProductPage;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const BILLING = "github.com/acme/billing";
const SECRET = "github.com/acme/secret";

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
    files: [],
    review: { approved: true, approvedAt, edited: false },
  };
}

// A day of one command's runs, every one failed: all of its time lost.
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
    record(ada, "s1", BILLING, "summary", "Payments retry with backoff.", { refs: [{ type: "ticket", id: "PAY-1" }] }),
    record(ada, "s1", BILLING, "workflow", "Cap retries at three."),
    record(ada, "s1", BILLING, "insight", "A draft only Ada sees.", { status: "draft", approvedAt: null }),
    record(bo, "s2", BILLING, "context_gap", "No docs for the retry budget.", {
      approvedAt: ago(2),
      refs: [{ type: "ticket", id: "PAY-2" }],
    }),
  ]);
  await summaryRevisions().insertMany([
    summary(ada, "s1", 1, "git@github.com:acme/billing.git", ago(2), { title: "Old title", built: "An old version." }),
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
        insights: ["The ledger rounds per line."],
        gaps: ["No docs for the retry budget"],
      },
      { jira: ["PAY-1"] },
    ),
    summary(bo, "s5", 1, BILLING, ago(20), {
      title: "Older billing work",
      built: "Invoices list.",
      areas: ["payments"],
    }),
    summary(bo, "s6", 1, BILLING, ago(60), { title: "Ancient billing work", built: "The first invoice." }),
    summary(
      bo,
      "s3",
      1,
      "https://github.com/acme/shop.git",
      ago(3),
      { title: "Checkout tax", built: "Checkout shows tax per line.", areas: ["checkout"] },
      { pr: { number: 7, url: "https://github.com/acme/shop/pull/7" }, noTicket: true },
    ),
  ]);
  // Cy's own events in a repository no approved work names: it gets a product, never listed.
  await events().insertOne({
    v: 1,
    id: "secret-0",
    sessionID: "s-secret",
    scope: { org: "default", project: SECRET, user: cy },
    kind: "session",
    payload: { event: "start", git: { remote: SECRET, path: "" } },
    promptID: null,
    known: true,
    ts: ago(1),
    receivedAt: ago(1),
    client: null,
  });
  // A product an admin merged into billing.
  await products().insertOne({
    _id: "old-billing",
    org: "default",
    name: "Old billing",
    repos: [{ repo: "github.com/acme/old-billing", path: "" }],
    repoKeys: ["github.com/acme/old-billing#"],
    mergedInto: "billing",
    createdAt: now,
    updatedAt: now,
  });
  await ensureProducts();
  await syncGaps();
  await signalDaily().insertMany([
    failedRow("billing", BILLING, "test", "1111111111111111", 3),
    failedRow("billing", BILLING, "build", "2222222222222222", 2),
    failedRow("billing", BILLING, "lint", "3333333333333333", 1),
    failedRow("billing", BILLING, "install", "4444444444444444", 0.5),
    // Older than the 30 days shown.
    failedRow("billing", BILLING, "test", "5555555555555555", 9, 45),
    // A product nobody can see yet.
    failedRow("secret", SECRET, "test", "6666666666666666", 4),
  ]);
});

afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("productCards", () => {
  it("lists the products with approved work, each with its latest summaries, open gaps and time lost", async () => {
    const cards = await productCards(ada);
    expect(cards.map((c) => c.id)).toEqual(["billing", "shop"]);
    const billing = cards[0];
    expect(billing?.name).toBe("billing");
    expect(billing?.repos).toEqual([{ repo: BILLING, path: "", url: "https://github.com/acme/billing" }]);
    expect(billing?.latest.map((l) => l.title)).toEqual(["Retry with backoff", "Older billing work"]);
    expect(billing?.openGaps).toBe(1);
    expect(billing?.lostMs).toBe(6.5 * HOUR_MS);
    expect(cards[1]).toMatchObject({ id: "shop", openGaps: 0, lostMs: 0 });
    expect(cards[1]?.latest.map((l) => l.title)).toEqual(["Checkout tax"]);
  });

  it("shows a suspended viewer nothing", async () => {
    expect(await productCards(cy)).toEqual([]);
  });
});

describe("productPage", () => {
  let page: ProductPage;
  beforeAll(async () => {
    const result = await productPage("billing", ada);
    if (result.status !== "ok") throw new Error(`billing is ${result.status}`);
    page = result.page;
  });

  it("says where a merged product went, and is missing for unknown, private and unreadable products", async () => {
    expect(await productPage("old-billing", ada)).toEqual({ status: "moved", id: "billing" });
    expect(await productPage("nope", ada)).toEqual({ status: "missing" });
    expect(await productPage("", ada)).toEqual({ status: "missing" });
    expect(await productPage("secret", ada)).toEqual({ status: "missing" });
    expect(await productPage("billing", cy)).toEqual({ status: "missing" });
  });

  it("shows the last six weeks' work by session, each summary with what was shared alongside it", () => {
    expect(page.product).toEqual({
      id: "billing",
      name: "billing",
      repos: [{ repo: BILLING, path: "", url: "https://github.com/acme/billing" }],
    });
    const sessions = page.weeks.flatMap((w) => w.sessions);
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(["s1", "s2", "s5"]);
    expect(page.weeks.every((w) => w.label.length > 0)).toBe(true);
    const s1 = sessions.find((s) => s.sessionId === "s1");
    // The latest revision's summary leads; the server record's own summary, said differently, is kept beside it.
    expect(s1?.summary?.title).toBe("Retry with backoff");
    expect(s1?.findings.map((f) => f.text)).toEqual(
      expect.arrayContaining(["Cap retries at three.", "The ledger rounds per line."]),
    );
    expect(s1?.refs.map((r) => r.label)).toEqual(["PAY-1"]);
    expect(JSON.stringify(page)).not.toContain("An old version.");
  });

  it("groups recent work by ticket, with its open questions and who worked on it", () => {
    expect(page.work.map((w) => w.key).sort()).toEqual(["ticket:PAY-1", "ticket:PAY-2"]);
    const pay1 = page.work.find((w) => w.key === "ticket:PAY-1");
    expect(pay1).toMatchObject({ title: "Retry with backoff", sessionIds: ["s1"], people: ["Ada Lovelace"] });
    expect(pay1?.open.map((o) => o.text)).toEqual(["Should refunds retry too?"]);
  });

  it("shows the top three time sinks of the last 30 days, and the open gaps", () => {
    expect(page.time.top.map((t) => t.class)).toEqual(["test", "build", "lint"]);
    expect(page.time.top.map((t) => t.lostMs)).toEqual([3 * HOUR_MS, 2 * HOUR_MS, 1 * HOUR_MS]);
    expect(page.time.totalMs).toBe(6.5 * HOUR_MS);
    expect(page.gaps.open).toBe(1);
    expect(page.gaps.top[0]).toMatchObject({ sessions: 2, asked: 0, owner: null });
    expect(page.gaps.top[0]?.text.toLowerCase()).toContain("no docs for the retry budget");
  });

  it("names who worked on each area, alphabetically, and nothing about how much", () => {
    expect(page.areas).toEqual([
      { area: "ledger", people: ["Ada Lovelace"] },
      { area: "payments", people: ["Ada Lovelace", "Bo Diddley"] },
    ]);
    expect(page.people).toEqual(["Ada Lovelace", "Bo Diddley"]);
  });

  it("lists its tickets and pull requests, keeps drafts out, and is plain data", () => {
    expect(page.refs.map((r) => r.label).sort()).toEqual(["PAY-1", "PAY-2"]);
    expect(JSON.stringify(page)).not.toContain("A draft only Ada sees.");
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
  });

  it("shows a product's own page for another product", async () => {
    const shop = await productPage("shop", bo);
    expect(shop.status).toBe("ok");
    if (shop.status !== "ok") return;
    expect(shop.page.refs).toEqual([
      {
        key: "pr:https://github.com/acme/shop/pull/7",
        kind: "pr",
        label: "PR #7",
        url: "https://github.com/acme/shop/pull/7",
      },
    ]);
    expect(shop.page.time.top).toEqual([]);
    expect(shop.page.gaps).toEqual({ top: [], open: 0 });
  });
});
