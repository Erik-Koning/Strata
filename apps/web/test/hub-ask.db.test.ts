// Ask Strata on a database of its own (test-database.ts), with a fake model: answers come only from approved work (a
// draft, anyone's, is never a source; a suspended person is refused), a product scope keeps to that product, a question
// nothing answers becomes a gap with no asker on it, a slow model isn't a gap, and the recent and first-week readings
// pick what they should.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_hub_ask");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { gaps, members, records, summaryRevisions } = await import("../server/collections.ts");
const { ensureProducts } = await import("../server/hub/products.ts");
const { Refusal } = await import("../server/people.ts");
const { askStrata, previewAsk, QUESTION_MAX } = await import("../server/hub/ask.ts");
type RecordDoc = import("../server/collections.ts").RecordDoc;
type SummaryRevisionDoc = import("../server/collections.ts").SummaryRevisionDoc;
type AnswerSource = import("../server/ai/provider.ts").AnswerSource;
type Answer = import("../server/ai/provider.ts").Answer;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const BILLING = "github.com/acme/billing";
const SHOP = "github.com/acme/shop";
const LEGACY = "github.com/acme/legacy";

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

const draft = { status: "draft", approvedAt: null } as const;

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
    authorName: null,
    sessionId,
    projectId: new ObjectId().toHexString(),
    revision: 1,
    idempotencyKey: `${sessionId}:1`,
    updatedAt: approvedAt,
    receivedAt: approvedAt,
    client: null,
    repo: { remote, branch: "main", head: "abc1234" },
    links: { jira: ["PAY-9"], pr: null, noTicket: false },
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

// A model that records what it was given and answers as told.
const calls: { question: string; sources: AnswerSource[] }[] = [];
const model = (reply: (question: string, sources: AnswerSource[]) => Answer | null | Promise<Answer | null>) => ({
  name: "fake",
  answer: async (question: string, sources: AnswerSource[]) => {
    calls.push({ question, sources });
    return reply(question, sources);
  },
});
const citesFirst = model((_q, sources) => ({
  text: "It is three, because the bank limits refunds [1].",
  cited: [sources[0]?.id ?? ""],
}));
const knowsNothing = model(() => null);
const lastCall = () => calls.at(-1);

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
  await members().insertOne({ _id: cy, role: "engineer", suspendedAt: now, createdAt: now, updatedAt: now });
  await records().insertMany([
    record(ada, "s1", BILLING, "summary", "Payments retry with backoff, capped at three attempts.", {
      title: "Retry with backoff",
      approvedAt: ago(2),
      refs: [{ type: "ticket", id: "PAY-1" }],
    }),
    record(ada, "s1", BILLING, "insight", "The retry budget is three because the bank rate-limits refunds.", {
      approvedAt: ago(2),
    }),
    // Drafts match the question best, and must still never be read: Bo's, and the asker's own.
    record(bo, "s2", BILLING, "insight", "Bo's draft: the retry budget is three, and the secret is hunter2.", draft),
    record(ada, "s3", BILLING, "insight", "Ada's own draft about the retry budget being three.", draft),
    record(bo, "s4", SHOP, "workflow", "Run pnpm seed before the checkout tests.", { approvedAt: ago(1) }),
    record(bo, "s5", SHOP, "insight", "The checkout retry budget is five, not three.", { approvedAt: ago(3) }),
    record(ada, "s6", BILLING, "workflow", "Run pnpm dev:billing to start the billing service locally.", {
      approvedAt: ago(3),
    }),
    record(bo, "s8", BILLING, "workflow", "Install the ledger CLI before anything else.", { approvedAt: ago(20) }),
    record(bo, "s8", BILLING, "insight", "We settle refunds nightly, not in real time.", { approvedAt: ago(20) }),
    record(bo, "s9", LEGACY, "insight", "The legacy invoices are generated by a cron job.", { approvedAt: ago(40) }),
  ]);
  await summaryRevisions().insertOne(
    summary(ada, "s7", "git@github.com:acme/billing.git", ago(4), {
      title: "Ledger rounding",
      built: "The ledger now rounds per line instead of per invoice.",
      why: "Auditors reconcile line by line, so totals must match each line.",
      areas: ["ledger", "payments"],
      insights: ["Rounding per invoice hid one-cent differences."],
    }),
  );
  await ensureProducts();
});

beforeEach(() => {
  calls.length = 0;
});

afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

const gapFor = (text: string) => gaps().findOne({ text });

describe("answers come only from approved work", () => {
  it("never reads a draft, another person's or the asker's own", async () => {
    for (const asker of [ada, bo]) {
      const result = await askStrata("Why is the retry budget three?", {}, asker, { provider: citesFirst });
      expect(result.status).toBe("answered");
      const read =
        lastCall()
          ?.sources.map((s) => s.text)
          .join("\n") ?? "";
      expect(read).toContain("bank rate-limits refunds");
      expect(read).not.toContain("hunter2");
      expect(read).not.toContain("Ada's own draft");
      expect(result.sources.every((s) => !s.text.includes("draft"))).toBe(true);
    }
  });

  it("returns the answer with its sources numbered, cited and linked", async () => {
    const result = await askStrata("Why is the retry budget three?", {}, ada, { provider: citesFirst });
    expect(result.answer?.text).toContain("[1]");
    expect(result.sources[0]).toMatchObject({ n: 1, cited: true });
    expect(result.sources.map((s) => s.n)).toEqual(result.sources.map((_, i) => i + 1));
    const billing = result.sources.find((s) => s.text.includes("bank rate-limits refunds"));
    expect(billing).toMatchObject({
      product: { id: "billing", name: "billing" },
      sessionId: "s1",
      author: "Ada Lovelace",
    });
    expect(result.sources.filter((s) => s.cited)).toHaveLength(1);
    expect(result.sources.length).toBeLessThanOrEqual(8);
    expect(result.gap).toBeNull();
  });

  it("refuses a suspended person, and keeps no gap for them", async () => {
    const before = await gaps().countDocuments();
    await expect(askStrata("Why is the retry budget three?", {}, cy, { provider: citesFirst })).rejects.toThrow(
      Refusal,
    );
    await expect(previewAsk("Why is the retry budget three?", {}, cy)).rejects.toThrow(Refusal);
    expect(await gaps().countDocuments()).toBe(before);
    expect(calls).toHaveLength(0);
  });

  it("drops citations of sources it wasn't given, and an answer citing none is no answer", async () => {
    const stray = model(() => ({ text: "It is three [1]. Also [9].", cited: [] }));
    const result = await askStrata("Why is the retry budget three?", {}, ada, { provider: stray });
    expect(result.answer?.text).toBe("It is three [1]. Also.");
    const uncited = model(() => ({ text: "It is three.", cited: [] }));
    const none = await askStrata("Why is the retry budget three?", {}, ada, { provider: uncited });
    expect(none.status).toBe("unanswered");
  });

  it("gives a summary line the summary's reason", async () => {
    await askStrata("Why does the ledger round per line?", {}, ada, { provider: citesFirst });
    const ledger = lastCall()?.sources.find((s) => s.title === "Ledger rounding");
    expect(ledger?.text).toContain("Why: Auditors reconcile line by line");
  });
});

describe("a product scope", () => {
  it("reads only that product's work", async () => {
    const all = await previewAsk("What is the retry budget?", {}, ada);
    expect(new Set(all.sources.map((s) => s.product?.id))).toEqual(new Set(["billing", "shop"]));
    const billing = await previewAsk("What is the retry budget?", { productId: "billing" }, ada);
    expect(billing.product).toEqual({ id: "billing", name: "billing" });
    expect(billing.sources.length).toBeGreaterThan(0);
    expect(billing.sources.every((s) => s.product?.id === "billing")).toBe(true);
  });

  it("refuses a product that isn't listed", async () => {
    await expect(previewAsk("What is the retry budget?", { productId: "nope" }, ada)).rejects.toThrow(Refusal);
  });
});

describe("a question nothing answers", () => {
  it("becomes a gap for the product, with no asker on it", async () => {
    const question = "Why is the refund retry budget three?";
    const result = await askStrata(question, { productId: "billing" }, ada, { provider: knowsNothing });
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("unanswered");
    expect(result.answer).toBeNull();
    expect(result.gap?.created).toBe(true);
    const gap = await gapFor(question);
    expect(gap).toMatchObject({ productId: "billing", status: "open", fromPeople: 1 });
    expect(JSON.stringify(gap)).not.toContain(ada);
  });

  it("becomes a gap without asking the model when there's nothing to read", async () => {
    const question = "How is the kubernetes helm chart rolled out?";
    const result = await askStrata(question, {}, bo, { provider: citesFirst });
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ status: "unanswered", sources: [], answer: null });
    expect(result.gap?.created).toBe(true);
    expect(await gapFor(question)).toMatchObject({ productId: null, fromPeople: 1 });
  });

  it("isn't a gap when the model was only slow", async () => {
    const before = await gaps().countDocuments();
    const stalls = model(() => new Promise<null>(() => undefined));
    const slow = await askStrata("Why is the retry budget three?", {}, ada, { provider: stalls, waitMs: 50 });
    expect(slow.status).toBe("slow");
    expect(slow.sources.length).toBeGreaterThan(0);
    const timedOut = await askStrata("Why is the retry budget three?", {}, ada, {
      provider: knowsNothing,
      slowAfterMs: 0,
    });
    expect(timedOut.status).toBe("slow");
    expect(await gaps().countDocuments()).toBe(before);
  });
});

describe("the question's length", () => {
  it(`is capped at ${QUESTION_MAX} characters, and nothing is read or kept past it`, async () => {
    const before = await gaps().countDocuments();
    const long = `Why is the retry budget three ${"x".repeat(QUESTION_MAX)}?`;
    await expect(askStrata(long, {}, ada, { provider: knowsNothing })).rejects.toThrow(/500 characters/);
    await expect(askStrata("   ", {}, ada, { provider: knowsNothing })).rejects.toThrow(Refusal);
    expect(calls).toHaveLength(0);
    expect(await gaps().countDocuments()).toBe(before);
    const trimmed = await askStrata("   Why is the retry   budget three?  ", {}, ada, { provider: citesFirst });
    expect(trimmed.question).toBe("Why is the retry budget three?");
  });
});

describe("what changed lately", () => {
  it("reads what was approved in the window, summaries first, in the product the question names", async () => {
    const result = await askStrata("What changed in billing this week?", {}, ada, { provider: citesFirst });
    expect(result.mode).toBe("recent");
    expect(result.product?.id).toBe("billing");
    expect(result.sources[0]?.kind).toBe("summary");
    expect(result.sources.every((s) => s.product?.id === "billing")).toBe(true);
    expect(result.sources.every((s) => s.at && new Date(s.at) >= ago(7.01))).toBe(true);
    expect(result.sources.map((s) => s.text)).not.toContain("We settle refunds nightly, not in real time.");
    expect(lastCall()?.question).toContain("What changed in billing this week?");
  });

  it("says a quiet window is quiet, and keeps no gap", async () => {
    const before = await gaps().countDocuments();
    const result = await askStrata("What changed this week?", { productId: "legacy" }, ada, { provider: citesFirst });
    expect(result).toMatchObject({ status: "quiet", gap: null, sources: [] });
    expect(calls).toHaveLength(0);
    expect(await gaps().countDocuments()).toBe(before);
  });
});

describe("a first week for someone new", () => {
  it("puts the newest workflow findings first, then names who has worked there, never how much", async () => {
    const result = await askStrata("I'm new to billing: where do I start?", {}, bo, { provider: citesFirst });
    expect(result.mode).toBe("onboarding");
    expect(result.product?.id).toBe("billing");
    expect(result.sources.slice(0, 2).map((s) => s.text)).toEqual([
      "Run pnpm dev:billing to start the billing service locally.",
      "Install the ledger CLI before anything else.",
    ]);
    const people = result.sources.at(-1);
    expect(people).toMatchObject({ kind: "people", product: { id: "billing" }, sessionId: null });
    expect(people?.text).toContain("Ada Lovelace");
    expect(people?.text).toContain("Bo Diddley");
    expect(people?.text).toContain("ledger: Ada Lovelace");
    expect(people?.text).not.toMatch(/\d/);
    const asked = lastCall()?.question ?? "";
    expect(asked).toMatch(/set it up/);
    expect(asked).toMatch(/whom to ask/);
    expect(lastCall()?.sources.at(-1)?.id).toBe("people:billing");
  });
});
