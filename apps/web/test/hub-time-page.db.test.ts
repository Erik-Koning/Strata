// The time page's data, on a database of its own (test-database.ts): tool time sent by two people's sessions, read
// back as commands ranked by time lost, each with its weekly trend, its product's approved pain points (never a draft)
// and a ticket; filtered by product and range; nothing for a suspended viewer or a product without approved work; and
// no person anywhere in it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_hub_time_page");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { draftPending, ingest } = await import("../server/memory/ingest.ts");
const { members, products, records } = await import("../server/collections.ts");
const { timePage } = await import("../server/hub/time-page.ts");
type RecordDoc = import("../server/collections.ts").RecordDoc;

const BILLING = "github.com/acme/billing";
const SHOP = "github.com/acme/shop";
const MONO = "github.com/acme/mono";
const F1 = "1111111111111111";
const F2 = "2222222222222222";
const F3 = "3333333333333333";
const DAY = 24 * 60 * 60 * 1000;
const BASE = "https://strata.example.com";
const now = new Date();
const noon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12));

const user = new ObjectId().toHexString();
const other = new ObjectId().toHexString();
const suspended = new ObjectId().toHexString();
const principal = (userId: string) => ({ kind: "key" as const, userId, keyId: "k", label: "test", client: null });

let n = 0;
const event = (sessionID: string, project: string, kind: string, payload: Record<string, unknown>) => ({
  v: 1,
  id: `tp-${++n}`,
  sessionID,
  scope: { project },
  kind,
  payload,
  ts: noon.getTime() + n * 1000,
});
const bash = (status: string, ms: number, command: Record<string, unknown>) => ({ tool: "Bash", status, ms, command });

function record(
  userId: string,
  sessionID: string,
  kind: RecordDoc["kind"],
  text: string,
  extra: Partial<RecordDoc> = {},
) {
  const at = new Date(noon.getTime() + ++n * 1000);
  return {
    _id: new ObjectId(),
    scope: { org: "default", project: BILLING, user: userId },
    sessionID,
    kind,
    status: "approved" as const,
    title: null,
    text,
    textKey: `k${n}`,
    refs: [],
    eventIds: [],
    edited: false,
    createdAt: at,
    updatedAt: at,
    approvedAt: at,
    memoryId: null,
    ...extra,
  } satisfies RecordDoc;
}

const query = (days: 7 | 30 | 90, productId: string | null = null) => ({ days, productId });

beforeAll(async () => {
  await ensureIndexes();
  const at = new Date();
  await members().insertOne({ _id: suspended, role: "engineer", suspendedAt: at, createdAt: at, updatedAt: at });
  await ingest(principal(user), [
    event("sA", BILLING, "session", { event: "start", git: { remote: BILLING, branch: "main", path: "" } }),
    event("sA", BILLING, "tool", bash("error", 120_000, { class: "test", exit: 1, fp: F1 })),
    event("sA", BILLING, "tool", bash("ok", 60_000, { class: "test", fp: F1 })),
    event("sA", BILLING, "tool", bash("ok", 30_000, { class: "build", fp: F2 })),
  ]);
  await ingest(principal(other), [
    event("sB", BILLING, "tool", bash("ok", 300_000, { class: "build", fp: F2 })),
    event("sB", BILLING, "tool", bash("ok", 60_000, { class: "test", fp: F1 })),
    event("sC", SHOP, "tool", bash("error", 600_000, { class: "test", exit: 2, fp: F3 })),
  ]);
  await records().insertMany([
    record(user, "sP1", "insight", "Billing retries are idempotent."),
    record(user, "sP1", "pain_point", "The billing Vitest suite is flaky on CI."),
    record(other, "sP2", "pain_point", "Nobody knows who owns the invoices job."),
    record(other, "sP3", "pain_point", "Draft: the tests here are awful.", { status: "draft", approvedAt: null }),
  ]);
});
afterAll(async () => {
  await draftPending();
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("where engineering time goes", () => {
  it("ranks commands by time lost, with totals, for products with approved work only", async () => {
    const page = await timePage(user, query(30), { baseURL: BASE });
    expect(page.products).toEqual([{ id: "billing", name: "billing" }]);
    expect(page).toMatchObject({ product: null, missingProduct: false, movedTo: null, commands: 2, repos: 1 });
    expect(page.rows.map((r) => [r.class, r.fp])).toEqual([
      ["build", F2],
      ["test", F1],
    ]);
    const test = page.rows[1];
    expect(test).toMatchObject({
      productId: "billing",
      productName: "billing",
      repo: BILLING,
      runs: 3,
      failures: 1,
      reruns: 1,
      lost: { failedMs: 120_000, rerunMs: 60_000, slowMs: 0, totalMs: 180_000 },
    });
    expect(page.lost.totalMs).toBe(page.rows.reduce((sum, r) => sum + r.lost.totalMs, 0));
    expect(page.lost.failedMs).toBe(120_000);
    // The shop has no approved work: its ten failed minutes stay out of sight.
    expect(page.rows.some((r) => r.repo === SHOP)).toBe(false);
  });

  it("gives each command its weekly trend, every week of the range, as plain data", async () => {
    const page = await timePage(user, query(30), { baseURL: BASE });
    const trend = page.rows[1]?.trend ?? [];
    expect(trend.length).toBeGreaterThanOrEqual(5);
    for (const week of trend) {
      expect(typeof week.weekStart).toBe("string");
      expect(new Date(week.weekStart).getUTCDay()).toBe(1);
    }
    expect(trend.reduce((sum, w) => sum + w.runs, 0)).toBe(3);
    expect(trend.reduce((sum, w) => sum + w.lostMs, 0)).toBe(180_000);
    expect(typeof page.since).toBe("string");
  });

  it("shows the product's approved pain points, those about the command first, never a draft", async () => {
    const page = await timePage(user, query(30), { baseURL: BASE });
    const [build, test] = page.rows;
    expect(test?.painPoints.map((p) => [p.text, p.mentions])).toEqual([
      ["The billing Vitest suite is flaky on CI.", true],
      ["Nobody knows who owns the invoices job.", false],
    ]);
    expect(build?.painPoints.map((p) => p.mentions)).toEqual([false, false]);
    expect(JSON.stringify(page)).not.toContain("awful");
    expect(test?.painPoints[0]?.sessionId).toBe("sP1");
  });

  it("writes a ticket with the figures, the trend and the pain points", async () => {
    const page = await timePage(user, query(30), { baseURL: BASE });
    const ticket = page.rows[1]?.ticket ?? "";
    expect(ticket).toContain("## Cut time lost to test runs in billing");
    expect(ticket).toContain("**3 min lost**");
    expect(ticket).toContain("- Runs: 3, of which 1 failed and 1 re-run");
    expect(ticket).toContain("### Time lost per week");
    expect(ticket).toContain(`([session](${BASE}/sessions/sP1))`);
    expect(ticket).toContain(`${BASE}/time?product=billing`);
  });

  it("names no person, and none of the sessions the time came from", async () => {
    const text = JSON.stringify(await timePage(other, query(90), { baseURL: BASE }));
    for (const id of [user, other, "sA", "sB", "sC"]) expect(text).not.toContain(id);
  });

  it("filters by product, and says so when the product asked for isn't listed", async () => {
    const billing = await timePage(user, query(7, "billing"), { baseURL: BASE });
    expect(billing.product).toEqual({ id: "billing", name: "billing" });
    expect(billing.filters).toEqual({ days: 7, productId: "billing" });
    expect(billing.rows).toHaveLength(2);

    const shop = await timePage(user, query(30, "shop"), { baseURL: BASE });
    expect(shop).toMatchObject({ product: null, missingProduct: true, filters: { productId: null } });
    expect(shop.rows.some((r) => r.repo === SHOP)).toBe(false);
  });

  it("is empty for a range with no runs in it", async () => {
    const later = new Date(now.getTime() + 60 * DAY);
    const page = await timePage(user, query(30), { now: later, baseURL: BASE });
    expect(page.rows).toEqual([]);
    expect(page.lost.totalMs).toBe(0);
    expect(page.products).toHaveLength(1);
  });

  it("shows a suspended viewer nothing", async () => {
    const page = await timePage(suspended, query(90, "billing"), { baseURL: BASE });
    expect(page).toMatchObject({ products: [], product: null, rows: [], commands: 0 });
  });

  it("sends a merged product's page on to the product it became", async () => {
    await products().updateOne({ _id: "shop" }, { $set: { mergedInto: "billing" } });
    const page = await timePage(user, query(30, "shop"), { baseURL: BASE });
    expect(page.movedTo).toBe("billing");
    expect(page.rows).toEqual([]);
  });
});

describe("a repository split into products by folder", () => {
  const F5 = "5555555555555555";

  it("gives the same command a row per product, each with its own product's trend", async () => {
    const at = new Date();
    await products().insertMany(
      (["api", "web"] as const).map((folder) => ({
        _id: `mono-${folder}`,
        org: "default",
        name: `mono ${folder}`,
        repos: [{ repo: MONO, path: folder }],
        repoKeys: [`${MONO}#${folder}`],
        mergedInto: null,
        createdAt: at,
        updatedAt: at,
      })),
    );
    const start = (sessionID: string, path: string) =>
      event(sessionID, MONO, "session", { event: "start", git: { remote: MONO, branch: "main", path } });
    const failing = (sessionID: string) =>
      event(sessionID, MONO, "tool", bash("error", 60_000, { class: "test", exit: 1, fp: F5 }));
    await ingest(principal(user), [start("sM1", "api"), failing("sM1")]);
    await ingest(principal(other), [start("sM2", "web"), failing("sM2"), failing("sM2"), failing("sM2")]);
    await records().insertOne(
      record(user, "sM1", "insight", "Mono is shared now.", { scope: { org: "default", project: MONO, user } }),
    );

    const page = await timePage(user, query(30), { baseURL: BASE });
    const mono = page.rows.filter((r) => r.repo === MONO);
    expect(mono.map((r) => [r.productId, r.runs]).sort()).toEqual([
      ["mono-api", 1],
      ["mono-web", 3],
    ]);
    for (const row of mono) {
      expect(row.trend.reduce((sum, w) => sum + w.runs, 0)).toBe(row.runs);
      expect(row.trend.reduce((sum, w) => sum + w.lostMs, 0)).toBe(row.lost.totalMs);
    }
    expect(new Set(page.rows.map((r) => r.id)).size).toBe(page.rows.length);

    const web = await timePage(user, query(30, "mono-web"), { baseURL: BASE });
    expect(web.rows.map((r) => [r.productId, r.runs])).toEqual([["mono-web", 3]]);
    expect(web.rows[0]?.trend.reduce((sum, w) => sum + w.runs, 0)).toBe(3);
  });
});
