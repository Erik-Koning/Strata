// An approved summary from the plugin reaches the hub without a backfill, on a database of its own: its repository is a
// product by the time /v1/events answers, and its gaps reach the gaps list just after; a retraction takes its gaps
// away. The /v1 answers stay as they were, even when the hub fails, and gap syncs never overlap.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

// Switches that make the hub fail, and a watch on how many gap syncs run at once.
const hub = vi.hoisted(() => ({ failProducts: false, failGaps: false, running: 0, mostAtOnce: 0, syncs: 0 }));

vi.mock("../server/hub/products.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../server/hub/products.ts")>();
  return {
    ...real,
    ensureProductsFor: async (names: Parameters<typeof real.ensureProductsFor>[0]) => {
      if (hub.failProducts) throw new Error("products are down");
      return real.ensureProductsFor(names);
    },
  };
});

vi.mock("../server/hub/gaps.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../server/hub/gaps.ts")>();
  return {
    ...real,
    syncGaps: async () => {
      hub.running++;
      hub.syncs++;
      hub.mostAtOnce = Math.max(hub.mostAtOnce, hub.running);
      try {
        if (hub.failGaps) throw new Error("gaps are down");
        return await real.syncGaps();
      } finally {
        hub.running--;
      }
    },
  };
});

const name = testDatabase("am_summary_hub");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { getProjects, postSummaryEvent, deleteSessionSummary } = await import("../server/summary/routes.ts");
const { gapSyncPending } = await import("../server/summary/store.ts");
const { closeMongo, db } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { createKey } = await import("../server/keys.ts");
const { gaps, products, summaryRevisions } = await import("../server/collections.ts");
const { listGaps } = await import("../server/hub/gaps.ts");
const { listProducts } = await import("../server/hub/products.ts");

const user = new ObjectId().toHexString();
let key = "";
let projectId = "";
let idem = 0;

const post = (event: Record<string, unknown>) =>
  postSummaryEvent(
    new Request("http://test/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(event),
    }),
  );

const summaryEvent = (sessionId: string, revision: number, remote: string, gapLines: string[]) => ({
  v: 1,
  idempotencyKey: `${sessionId}:summary:${++idem}`,
  type: "session_summary",
  sessionId,
  revision,
  projectId,
  updatedAt: new Date().toISOString(),
  client: { plugin: "0.3.0", platform: "test" },
  repo: { remote, branch: "main", head: "abc1234" },
  links: { jira: ["LED-1"], pr: null, noTicket: false },
  summary: {
    title: "Ledger close",
    built: "The ledger closes each month on its own.",
    why: "Closing by hand took a day.",
    decisions: [],
    areas: ["ledger"],
    open: [],
    insights: [],
    workflow: [],
    painPoints: [],
    gaps: gapLines,
  },
  files: ["src/close.ts"],
  review: { approved: true, approvedAt: new Date().toISOString(), edited: false },
});

beforeAll(async () => {
  await ensureIndexes({ wait: false });
  key = (await createKey(user, "test")).key;
  const listed = await getProjects(
    new Request("http://test/v1/projects", { headers: { authorization: `Bearer ${key}` } }),
  );
  projectId = (await listed.json()).projects[0].id;
});

afterAll(async () => {
  await gapSyncPending();
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("an approved summary reaches the hub", () => {
  const LEDGER = "https://github.com/acme/ledger.git";
  const GAP = "No runbook for the month-end close.";

  it("makes its repository a product before answering, and its gaps reach the gaps list after", async () => {
    const response = await post(summaryEvent("s1", 1, LEDGER, [GAP]));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    // Before any background work has finished: the product is already there.
    const product = await products().findOne({ repoKeys: "github.com/acme/ledger#" });
    expect(product).toMatchObject({ _id: "ledger", name: "ledger", mergedInto: null });
    expect((await listProducts(user)).map((p) => p.id)).toEqual(["ledger"]);

    await gapSyncPending();
    const open = await listGaps({ status: "open" }, user);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ text: GAP, productId: "ledger", sessions: 1, fromAgents: 1 });
  });

  it("answers a replay as before, and takes a gap away when a later revision drops it", async () => {
    const event = summaryEvent("s2", 1, LEDGER, [GAP]);
    expect((await post(event)).status).toBe(201);
    const replay = await post(event);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, duplicate: true });
    await gapSyncPending();
    expect((await listGaps({ status: "open" }, user))[0]?.sessions).toBe(2);

    expect((await post(summaryEvent("s2", 2, LEDGER, []))).status).toBe(201);
    await gapSyncPending();
    expect((await listGaps({ status: "open" }, user))[0]?.sessions).toBe(1);
  });

  it("takes a retracted session's gaps away with it", async () => {
    const retract = await deleteSessionSummary(
      new Request("http://test/v1/sessions/s1", { method: "DELETE", headers: { authorization: `Bearer ${key}` } }),
      "s1",
    );
    expect(retract.status).toBe(200);
    expect(await retract.json()).toEqual({ ok: true });
    await gapSyncPending();
    expect(await gaps().countDocuments({})).toBe(0);
  });

  it("stores and answers as before when the hub fails, and says so in the log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    hub.failProducts = true;
    hub.failGaps = true;
    try {
      const response = await post(summaryEvent("s3", 1, "https://github.com/acme/broken.git", ["Who owns the cron?"]));
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ ok: true });
      await gapSyncPending();
      expect(await summaryRevisions().countDocuments({ sessionId: "s3" })).toBe(1);
      expect(await products().findOne({ repoKeys: "github.com/acme/broken#" })).toBeNull();
      const messages = logged.mock.calls.map((call) => String(call[0]));
      expect(messages).toEqual(
        expect.arrayContaining([
          "hub: making a product for an approved summary failed",
          "hub: syncing gaps after a summary changed failed",
        ]),
      );
    } finally {
      hub.failProducts = false;
      hub.failGaps = false;
      logged.mockRestore();
    }
    // The next summary catches up on what was missed.
    expect(
      (await post(summaryEvent("s3", 2, "https://github.com/acme/broken.git", ["Who owns the cron?"]))).status,
    ).toBe(201);
    await gapSyncPending();
    expect(await products().findOne({ repoKeys: "github.com/acme/broken#" })).not.toBeNull();
    expect((await listGaps({ productId: "broken" }, user)).map((g) => g.text)).toEqual(["Who owns the cron?"]);
  });

  it("runs one gap sync at a time, however many summaries arrive together", async () => {
    hub.mostAtOnce = 0;
    hub.syncs = 0;
    const answers = await Promise.all(
      Array.from({ length: 6 }, (_, i) => post(summaryEvent(`p${i}`, 1, LEDGER, [`Gap number ${i}.`]))),
    );
    expect(answers.map((a) => a.status)).toEqual(Array(6).fill(201));
    await gapSyncPending();
    expect(hub.mostAtOnce).toBe(1);
    expect(hub.syncs).toBeGreaterThan(0);
    const texts = (await listGaps({ productId: "ledger" }, user)).map((g) => g.text).sort();
    expect(texts).toEqual(expect.arrayContaining(Array.from({ length: 6 }, (_, i) => `Gap number ${i}.`)));
  });
});
