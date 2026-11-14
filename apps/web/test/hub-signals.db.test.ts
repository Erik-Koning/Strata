// Tool time into signal_daily, on a database of its own (test-database.ts): counted once as events arrive, re-runs found
// within a session, backfilled from stored events, never naming a person, never failing ingest, and read back as hours
// lost and a weekly trend only for products with approved work.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_hub_signals");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { draftPending, ingest } = await import("../server/memory/ingest.ts");
const { events, members, records, signalDaily } = await import("../server/collections.ts");
const { backfillSignals, itemKeyOf, timeLost, timeTrend } = await import("../server/hub/signals.ts");
const { bucketMid, bucketOf } = await import("../server/hub/time-math.ts");

const BILLING = "github.com/acme/billing";
const SHOP = "github.com/acme/shop";
const F1 = "1111111111111111";
const F2 = "2222222222222222";
const F3 = "3333333333333333";
const F9 = "9999999999999999";
const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
// Yesterday at noon UTC: every run below falls on one day.
const noon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12));
const day = noon.toISOString().slice(0, 10);

const user = new ObjectId().toHexString();
const other = new ObjectId().toHexString();
const suspended = new ObjectId().toHexString();
const principal = (userId: string) => ({ kind: "key" as const, userId, keyId: "k", label: "test", client: null });

let n = 0;
const event = (sessionID: string, project: string, kind: string, payload: Record<string, unknown>) => ({
  v: 1,
  id: `sig-${++n}`,
  sessionID,
  scope: { project },
  kind,
  payload,
  ts: noon.getTime() + n * 1000,
});
const bash = (status: string, ms: number, command: Record<string, unknown>) => ({ tool: "Bash", status, ms, command });

const sessionA = [
  event("sA", BILLING, "session", { event: "start", git: { remote: BILLING, branch: "main", path: "" } }),
  event("sA", BILLING, "tool", bash("error", 120_000, { class: "test", exit: 1, fp: F1 })),
  event("sA", BILLING, "tool", bash("ok", 60_000, { class: "test", fp: F1 })),
  event("sA", BILLING, "tool", bash("ok", 30_000, { class: "build", fp: F2 })),
  event("sA", BILLING, "tool", bash("ok", 100, { class: "other" })),
  event("sA", BILLING, "tool", { tool: "Read", status: "ok", ms: 3 }),
  event("sA", BILLING, "tool", bash("ok", 5, { class: "test", fp: F1, background: true })),
];
const sessionB = [
  event("sB", BILLING, "tool", bash("ok", 300_000, { class: "build", fp: F2 })),
  event("sB", BILLING, "tool", bash("ok", 60_000, { class: "test", fp: F1 })),
];

beforeAll(async () => {
  await ensureIndexes();
  const at = new Date();
  await members().insertOne({ _id: suspended, role: "manager", suspendedAt: at, createdAt: at, updatedAt: at });
});
afterAll(async () => {
  await draftPending();
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("counting tool time as events arrive", () => {
  it("counts runs, failures, re-runs and time per day, product, repository, class and fingerprint", async () => {
    expect((await ingest(principal(user), sessionA)).accepted).toBe(sessionA.length);
    expect((await ingest(principal(other), sessionB)).accepted).toBe(sessionB.length);
    const f1 = await signalDaily().findOne({ item: itemKeyOf(BILLING, "test", F1) });
    expect(f1).toMatchObject({
      day,
      productId: "billing",
      repo: BILLING,
      class: "test",
      fp: F1,
      runs: 4,
      failures: 1,
      reruns: 2,
      timedRuns: 3,
      totalMs: 240_000,
      failedMs: 120_000,
      rerunMs: 60_000,
    });
    const f2 = await signalDaily().findOne({ item: itemKeyOf(BILLING, "build", F2) });
    expect(f2).toMatchObject({ runs: 2, failures: 0, reruns: 0, totalMs: 330_000 });
    expect(await signalDaily().findOne({ class: "other" })).toMatchObject({ fp: "", runs: 1 });
    const tools = await events()
      .find({ kind: "tool", "payload.command": { $exists: true } })
      .toArray();
    expect(tools.every((e) => e.signaledAt)).toBe(true);
  });

  it("counts an event once, however often the client sends it", async () => {
    const before = await signalDaily()
      .find({}, { projection: { _id: 0, updatedAt: 0 } })
      .toArray();
    expect((await ingest(principal(user), sessionA)).duplicates).toBe(sessionA.length);
    expect(
      await signalDaily()
        .find({}, { projection: { _id: 0, updatedAt: 0 } })
        .toArray(),
    ).toEqual(before);
  });

  it("keeps no person, and no session, anywhere in it", async () => {
    const allowed = new Set([
      "_id",
      "day",
      "productId",
      "repo",
      "class",
      "fp",
      "item",
      "runs",
      "failures",
      "reruns",
      "timedRuns",
      "totalMs",
      "failedMs",
      "rerunMs",
      "hist",
      "okHist",
      "updatedAt",
    ]);
    const rows = await signalDaily().find().toArray();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const key of Object.keys(row)) expect(allowed.has(key)).toBe(true);
      const text = JSON.stringify(row);
      for (const id of [user, other, "sA", "sB"]) expect(text).not.toContain(id);
    }
  });

  it("never fails the request when counting fails, and the backfill counts what it missed", async () => {
    await signalDaily().insertOne({
      day,
      productId: "billing",
      repo: BILLING,
      class: "lint",
      fp: F9,
      item: itemKeyOf(BILLING, "lint", F9),
      runs: 0,
      failures: 0,
      reruns: 0,
      timedRuns: 0,
      totalMs: 0,
      failedMs: 0,
      rerunMs: 0,
      hist: "broken" as unknown as Record<string, number>,
      okHist: {},
      updatedAt: new Date(),
    });
    const lint = event("sA", BILLING, "tool", bash("ok", 2_000, { class: "lint", fp: F9 }));
    expect(await ingest(principal(user), [lint])).toMatchObject({ accepted: 1, rejected: [] });
    expect((await events().findOne({ id: lint.id }))?.signaledAt).toBeFalsy();
    await signalDaily().deleteOne({ item: itemKeyOf(BILLING, "lint", F9) });
    expect((await backfillSignals({ settleMs: 0 })).counted).toBe(1);
    expect(await signalDaily().findOne({ item: itemKeyOf(BILLING, "lint", F9) })).toMatchObject({ runs: 1, reruns: 0 });
  });
});

describe("the backfill", () => {
  it("counts stored events nobody counted, finds their re-runs in order, and leaves the newest to ingest", async () => {
    const received = new Date(Date.now() - 10 * 60_000);
    const raw = (id: string, ts: number, status: string, ms: number, receivedAt = received) => ({
      v: 1,
      id,
      sessionID: "sC",
      scope: { org: "default", project: SHOP, user: other },
      kind: "tool",
      payload: bash(status, ms, { class: "test", fp: F3 }),
      promptID: null,
      known: true,
      ts: new Date(noon.getTime() + ts),
      receivedAt,
      client: null,
    });
    // Stored out of order: the backfill reads a session in the order it happened.
    await events().insertMany([
      raw("old-3", 3000, "error", 2_000),
      raw("old-1", 1000, "ok", 1_000),
      raw("old-2", 2000, "ok", 1_000),
      raw("new-4", 4000, "ok", 1_000, new Date()),
    ]);
    expect(await backfillSignals()).toMatchObject({ counted: 3 });
    expect(await signalDaily().findOne({ item: itemKeyOf(SHOP, "test", F3) })).toMatchObject({
      productId: "shop",
      runs: 3,
      failures: 1,
      reruns: 2,
      failedMs: 2_000,
      rerunMs: 1_000,
    });
    expect((await events().findOne({ id: "new-4" }))?.signaledAt).toBeFalsy();
    expect(await backfillSignals()).toMatchObject({ counted: 0 });
  });
});

describe("hours lost", () => {
  it("shows nothing for a product with no approved work yet", async () => {
    expect(await timeLost({ since: new Date(Date.now() - 3 * DAY), until: now }, user)).toEqual({
      items: [],
      totalHours: 0,
    });
  });

  it("ranks items by time lost once the product has approved work", async () => {
    await records().insertOne({
      _id: new ObjectId(),
      scope: { org: "default", project: BILLING, user },
      sessionID: "sA",
      kind: "insight",
      status: "approved",
      title: null,
      text: "Billing has approved work now.",
      textKey: "k",
      refs: [],
      eventIds: [],
      edited: false,
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      memoryId: null,
    });
    const { items, totalHours } = await timeLost({ since: new Date(Date.now() - 3 * DAY), until: now }, other);
    expect(items.map((i) => [i.class, i.fp])).toEqual([
      ["build", F2],
      ["test", F1],
    ]);
    const [build, test] = items;
    const slow = Math.round(bucketMid(bucketOf(300_000)) - bucketMid(bucketOf(30_000)));
    expect(build).toMatchObject({
      productId: "billing",
      repo: BILLING,
      runs: 2,
      lost: { failedMs: 0, rerunMs: 0, slowMs: slow },
    });
    expect(test).toMatchObject({
      key: itemKeyOf(BILLING, "test", F1),
      runs: 4,
      failures: 1,
      reruns: 2,
      lost: { failedMs: 120_000, rerunMs: 60_000, slowMs: 0, totalMs: 180_000 },
      hours: 0.05,
      firstDay: day,
      lastDay: day,
    });
    expect(totalHours).toBeCloseTo((slow + 180_000) / 3_600_000, 2);
    // The shop has no approved work: its time stays out of sight.
    expect(items.some((i) => i.repo === SHOP)).toBe(false);
    const billingOnly = await timeLost(
      { productId: "billing", since: new Date(Date.now() - 3 * DAY), until: now },
      user,
    );
    expect(billingOnly.items).toHaveLength(2);
    expect((await timeLost({ productId: "shop", since: new Date(0), until: now }, user)).items).toEqual([]);
  });

  it("gives an item's trend week by week, empty weeks included", async () => {
    const weeks = await timeTrend(itemKeyOf(BILLING, "test", F1), { since: new Date(Date.now() - 21 * DAY) }, user);
    expect(weeks.length).toBeGreaterThanOrEqual(3);
    for (const week of weeks) expect(week.weekStart.getUTCDay()).toBe(1);
    expect(weeks.reduce((sum, w) => sum + w.runs, 0)).toBe(4);
    expect(weeks.filter((w) => w.runs === 0).length).toBe(weeks.length - 1);
    expect(weeks.find((w) => w.runs)?.lost.totalMs).toBe(180_000);
    expect(await timeTrend(itemKeyOf(SHOP, "test", F3), { since: new Date(0) }, user)).toEqual([]);
  });

  it("shows a suspended viewer nothing", async () => {
    expect((await timeLost({ since: new Date(0), until: now }, suspended)).items).toEqual([]);
    expect(await timeTrend(itemKeyOf(BILLING, "test", F1), { since: new Date(0) }, suspended)).toEqual([]);
  });
});
