// The weekly digest's data, on a database of their own (test-database.ts): one Monday-to-Sunday week (UTC) of approved
// work by product, with work either side of its edges kept out; the time lost on tools and the gaps opened and resolved
// that week; the product filter, merged ids and unknown ones; drafts, private repositories and suspended viewers kept
// out; and the email it renders, every link absolute and nobody counted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_digest");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { events, gaps, members, products, records, signalDaily, summaryRevisions } = await import(
  "../server/collections.ts"
);
const { ensureProducts } = await import("../server/hub/products.ts");
const { syncGaps } = await import("../server/hub/gaps.ts");
const { itemKeyOf } = await import("../server/hub/signals.ts");
const { HOUR_MS } = await import("../server/hub/time-math.ts");
const { buildDigest, renderDigestEmail } = await import("../server/hub/digest.ts");
type RecordDoc = import("../server/collections.ts").RecordDoc;
type SummaryRevisionDoc = import("../server/collections.ts").SummaryRevisionDoc;
type Digest = import("../server/hub/digest.ts").Digest;

const at = (iso: string) => new Date(iso);
// The week under test runs from Monday 2 to Sunday 8 November 2026; "now" is in the week after.
const WEEK = at("2026-11-02T00:00:00.000Z");
const NOW = at("2026-11-14T10:00:00.000Z");
const BILLING = "github.com/acme/billing";
const SHOP = "github.com/acme/shop";
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
  when: Date,
  extra: Partial<RecordDoc> = {},
): RecordDoc {
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
    createdAt: when,
    updatedAt: when,
    approvedAt: when,
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
  links: Partial<SummaryRevisionDoc["links"]> = {},
): SummaryRevisionDoc {
  return {
    v: 1,
    userId,
    authorName: "Stored name",
    sessionId,
    projectId: new ObjectId().toHexString(),
    revision: 1,
    idempotencyKey: `${sessionId}:1`,
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
const failedRow = (day: string, productId: string, repo: string, cls: string, fp: string, hours: number) => ({
  day,
  productId,
  repo,
  class: cls,
  fp,
  item: itemKeyOf(repo, cls, fp),
  runs: 2,
  failures: 2,
  reruns: 0,
  timedRuns: 2,
  totalMs: hours * HOUR_MS,
  failedMs: hours * HOUR_MS,
  rerunMs: 0,
  hist: {},
  okHist: {},
  updatedAt: NOW,
});

const PERSON_COUNT =
  /\b\d+\s+(?:other\s+)?(?:people|persons?|engineers?|contributors?|members?|authors?|developers?|teammates?)\b/i;

beforeAll(async () => {
  await ensureIndexes();
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
        createdAt: NOW,
        updatedAt: NOW,
      })),
    );
  await members().insertOne({ _id: cy, role: "admin", suspendedAt: NOW, createdAt: NOW, updatedAt: NOW });
  await records().insertMany([
    record(ada, "s1", BILLING, "summary", "Payments retry with backoff.", at("2026-11-03T09:30:00.000Z"), {
      refs: [{ type: "ticket", id: "PAY-1" }],
    }),
    // The week's first moment and its last.
    record(bo, "s-start", BILLING, "workflow", "Run the ledger check first.", at("2026-11-02T00:00:00.000Z")),
    record(bo, "s2", BILLING, "context_gap", "No docs for the retry budget.", at("2026-11-08T23:59:59.999Z"), {
      refs: [{ type: "ticket", id: "PAY-2" }],
    }),
    // Just before the week, and just after it.
    record(ada, "s0", BILLING, "summary", "Before the week.", at("2026-11-01T23:59:59.999Z")),
    record(ada, "s0", BILLING, "context_gap", "No runbook for refunds.", at("2026-11-01T12:00:00.000Z")),
    record(bo, "s9", BILLING, "summary", "After the week.", at("2026-11-09T00:00:00.000Z")),
    record(bo, "s9", BILLING, "context_gap", "No staging data.", at("2026-11-09T00:00:00.000Z")),
    // Drafts: their authors' alone, never in a digest.
    record(ada, "s1", BILLING, "insight", "A draft only Ada sees.", at("2026-11-03T09:00:00.000Z"), {
      status: "draft",
      approvedAt: null,
    }),
    record(cy, "s-secret", SECRET, "summary", "A secret draft.", at("2026-11-03T09:00:00.000Z"), {
      status: "draft",
      approvedAt: null,
    }),
  ]);
  await summaryRevisions().insertMany([
    summary(
      ada,
      "s1",
      `git@github.com:acme/billing.git`,
      at("2026-11-03T10:00:00.000Z"),
      {
        title: "Retry with backoff",
        built: "Payments retry with backoff, capped at three.",
        open: ["Should refunds retry too?"],
        decisions: ["Cap retries at three."],
      },
      { jira: ["PAY-1"] },
    ),
    summary(
      bo,
      "s3",
      "https://github.com/acme/shop.git",
      at("2026-11-04T10:00:00.000Z"),
      { title: "Checkout tax", built: "Checkout shows tax per line.", open: ["Round per line?"] },
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
    ts: at("2026-11-03T09:00:00.000Z"),
    receivedAt: at("2026-11-03T09:00:00.000Z"),
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
    createdAt: NOW,
    updatedAt: NOW,
  });
  await ensureProducts();
  await syncGaps();
  // The refunds gap, first seen the week before, was answered in the week.
  await gaps().updateOne(
    { text: /runbook for refunds/i },
    {
      $set: {
        status: "resolved",
        resolution: { url: "https://docs.example.com/refunds", note: "", at: at("2026-11-05T12:00:00.000Z") },
      },
    },
  );
  await signalDaily().insertMany([
    failedRow("2026-11-02", "billing", BILLING, "test", "1111111111111111", 3),
    failedRow("2026-11-08", "billing", BILLING, "build", "2222222222222222", 1),
    failedRow("2026-11-05", "shop", SHOP, "test", "3333333333333333", 2),
    // Either side of the week.
    failedRow("2026-11-01", "billing", BILLING, "install", "4444444444444444", 4),
    failedRow("2026-11-09", "billing", BILLING, "lint", "5555555555555555", 5),
    // A product nobody can see.
    failedRow("2026-11-05", "secret", SECRET, "test", "6666666666666666", 9),
  ]);
});

afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

const texts = (digest: Digest) => JSON.stringify(digest);

describe("buildDigest", () => {
  let digest: Digest;
  beforeAll(async () => {
    digest = await buildDigest({ weekStart: at("2026-11-05T15:00:00.000Z") }, ada, NOW);
  });

  it("is the Monday-to-Sunday week, in UTC, of the moment given", () => {
    expect(digest.week).toMatchObject({
      start: WEEK.toISOString(),
      end: "2026-11-09T00:00:00.000Z",
      key: "2026-11-02",
      isoWeek: "2026-W45",
      label: "Last week",
      current: false,
      previous: "2026-10-26",
      next: "2026-11-09",
    });
    expect(digest.href).toBe("/digest?week=2026-11-02");
  });

  it("shows each product's work from the week's first moment to its last, and nothing either side", () => {
    expect(digest.products.map((p) => p.id)).toEqual(["billing", "shop"]);
    const billing = digest.products[0];
    expect(billing?.sessions.map((s) => s.sessionId)).toEqual(["s2", "s1", "s-start"]);
    // The latest summary leads its session; the decision shared with it is listed beneath.
    const s1 = billing?.sessions.find((s) => s.sessionId === "s1");
    expect(s1?.summary?.title).toBe("Retry with backoff");
    expect(s1?.findings.map((f) => f.text)).toContain("Cap retries at three.");
    expect(texts(digest)).not.toContain("Before the week.");
    expect(texts(digest)).not.toContain("After the week.");
    expect(texts(digest)).not.toContain("No staging data");
  });

  it("groups the week's work in progress by ticket or pull request, with what it left open", () => {
    const billing = digest.products.find((p) => p.id === "billing");
    expect(billing?.work.map((w) => w.key)).toEqual(["ticket:PAY-2", "ticket:PAY-1", "session:s-start"]);
    expect(billing?.work.find((w) => w.key === "session:s-start")).toMatchObject({
      title: "Run the ledger check first.",
      people: ["Bo Diddley"],
      open: [],
    });
    const pay1 = billing?.work.find((w) => w.key === "ticket:PAY-1");
    expect(pay1).toMatchObject({ title: "Retry with backoff", sessionIds: ["s1"], people: ["Ada Lovelace"] });
    expect(pay1?.open.map((o) => o.text)).toEqual(["Should refunds retry too?"]);
    const shop = digest.products.find((p) => p.id === "shop");
    expect(shop?.work.map((w) => w.key)).toEqual(["pr:https://github.com/acme/shop/pull/7"]);
    expect(shop?.work[0]?.open.map((o) => o.text)).toEqual(["Round per line?"]);
  });

  it("counts the time lost on tools on the week's days only, in products people can see", () => {
    expect(digest.time.top.map((t) => [t.productId, t.class, t.lostMs])).toEqual([
      ["billing", "test", 3 * HOUR_MS],
      ["shop", "test", 2 * HOUR_MS],
      ["billing", "build", 1 * HOUR_MS],
    ]);
    expect(digest.time.totalMs).toBe(6 * HOUR_MS);
    expect(digest.time.commands).toBe(3);
    expect(digest.time.top[0]?.productName).toBe("billing");
  });

  it("lists the gaps first seen in the week, and those resolved in it", () => {
    expect(digest.gaps.opened.map((g) => g.text.toLowerCase())).toEqual([
      expect.stringContaining("no docs for the retry budget"),
    ]);
    expect(digest.gaps.opened[0]).toMatchObject({ productId: "billing", productName: "billing", sessions: 1 });
    expect(digest.gaps.resolved.map((g) => g.text.toLowerCase())).toEqual([
      expect.stringContaining("no runbook for refunds"),
    ]);
    expect(digest.gaps.resolved[0]?.resolution?.url).toBe("https://docs.example.com/refunds");
    expect(digest.gaps.resolved[0]?.at).toBe("2026-11-05T12:00:00.000Z");
  });

  it("keeps drafts and private repositories out, and is plain data", async () => {
    for (const viewer of [ada, bo]) {
      const seen = await buildDigest({ weekStart: WEEK }, viewer, NOW);
      expect(texts(seen)).not.toContain("draft");
      expect(texts(seen)).not.toContain(SECRET);
      expect(seen.products.map((p) => p.id)).not.toContain("secret");
      expect(seen.time.top.map((t) => t.productId)).not.toContain("secret");
    }
    expect(JSON.parse(JSON.stringify(digest))).toEqual(digest);
  });

  it("shows a suspended viewer nothing", async () => {
    const none = await buildDigest({ weekStart: WEEK, productIds: ["billing"] }, cy, NOW);
    expect(none.products).toEqual([]);
    expect(none.time).toEqual({ top: [], totalMs: 0, commands: 0 });
    expect(none.gaps.opened).toEqual([]);
    expect(none.gaps.resolved).toEqual([]);
    expect(none.picked).toEqual([]);
  });

  it("is this week so far, for a moment in this week", async () => {
    const now = await buildDigest({ weekStart: NOW }, ada, NOW);
    expect(now.week).toMatchObject({ key: "2026-11-09", label: "This week", current: true, next: null });
    expect(now.href).toBe("/digest?week=2026-11-09");
    expect(now.products.flatMap((p) => p.sessions.map((s) => s.sessionId))).toEqual(["s9"]);
    expect(now.time.top.map((t) => t.class)).toEqual(["lint"]);
    expect(now.gaps.opened.map((g) => g.text.toLowerCase())).toEqual([expect.stringContaining("no staging data")]);
  });
});

describe("buildDigest, for some products", () => {
  it("keeps only the products picked, in every part", async () => {
    const shop = await buildDigest({ weekStart: WEEK, productIds: ["shop"] }, ada, NOW);
    expect(shop.picked).toEqual([{ id: "shop", name: "shop" }]);
    expect(shop.unknown).toEqual([]);
    expect(shop.products.map((p) => p.id)).toEqual(["shop"]);
    expect(shop.time.top.map((t) => t.productId)).toEqual(["shop"]);
    expect(shop.time.totalMs).toBe(2 * HOUR_MS);
    expect(shop.gaps).toEqual({ opened: [], resolved: [], moreOpened: 0, moreResolved: 0 });
    expect(shop.href).toBe("/digest?week=2026-11-02&product=shop");
  });

  it("follows a merged product's old id to the one it's part of now", async () => {
    const billing = await buildDigest({ weekStart: WEEK, productIds: ["old-billing", "billing"] }, ada, NOW);
    expect(billing.picked).toEqual([{ id: "billing", name: "billing" }]);
    expect(billing.products.map((p) => p.id)).toEqual(["billing"]);
    expect(billing.gaps.opened).toHaveLength(1);
    expect(billing.gaps.resolved).toHaveLength(1);
  });

  it("says which picks aren't products people can see, and shows every product when none is", async () => {
    const some = await buildDigest({ weekStart: WEEK, productIds: ["billing", "nope"] }, ada, NOW);
    expect(some.picked.map((p) => p.id)).toEqual(["billing"]);
    expect(some.unknown).toEqual(["nope"]);
    expect(some.products.map((p) => p.id)).toEqual(["billing"]);

    const none = await buildDigest({ weekStart: WEEK, productIds: ["nope", "secret", "Not an id!"] }, ada, NOW);
    expect(none.picked).toEqual([]);
    expect(none.unknown).toEqual(["nope", "secret", "Not an id!"]);
    expect(none.products.map((p) => p.id)).toEqual(["billing", "shop"]);
  });
});

describe("renderDigestEmail, from a built digest", () => {
  it("links every part absolutely, holds no draft and counts nobody", async () => {
    const digest = await buildDigest({ weekStart: WEEK }, ada, NOW);
    const email = renderDigestEmail(digest, { baseUrl: "http://localhost:9316" });
    expect(email.subject).toBe("Strata weekly digest: 2 to 8 November 2026");
    const hrefs = [...email.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? "");
    for (const href of hrefs) expect(href).toMatch(/^https?:\/\//);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "http://localhost:9316/products/billing",
        "http://localhost:9316/products/shop",
        "http://localhost:9316/sessions/s1",
        "https://github.com/acme/shop/pull/7",
        "http://localhost:9316/digest?week=2026-11-02",
      ]),
    );
    for (const part of [email.text, email.html]) {
      expect(part).not.toContain("draft");
      expect(part).not.toContain("Before the week.");
      expect(part).not.toMatch(PERSON_COUNT);
    }
    expect(email.text).toContain("Retry with backoff");
    expect(email.text).toContain("with Ada Lovelace");
  });
});
