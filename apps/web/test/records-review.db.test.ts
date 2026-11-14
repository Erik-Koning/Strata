// Deciding about a record after it was approved: its memory follows the decision (discarding or editing retires it,
// approving again brings the same one back), an edit that repeats another record's words is refused as a conflict, and
// each decision brings the hub's products and gaps along. On a database of its own, emptied afterwards.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_rec_review");
process.env.MEMORY_AI_PROVIDER = "stub";

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { gaps, memories, products, records } = await import("../server/collections.ts");
const { ApiError } = await import("../server/http.ts");
const { normalize } = await import("../server/memory/extract.ts");
const { createKey } = await import("../server/keys.ts");
const recordRules = await import("../server/records/routes.ts");
type RecordDoc = import("../server/collections.ts").RecordDoc;

const REPO = "github.com/acme/billing";
const person = (userId: string) => ({ kind: "user" as const, userId, label: userId });

// A draft as the server writes one, keyed the way the records' unique index keys it.
async function draft(
  user: string,
  sessionID: string,
  kind: RecordDoc["kind"],
  text: string,
  project = REPO,
): Promise<string> {
  const now = new Date();
  const doc: RecordDoc = {
    _id: new ObjectId(),
    scope: { org: "default", user, project },
    sessionID,
    kind,
    status: "draft",
    title: null,
    text,
    textKey: createHash("sha1").update(normalize(text)).digest("hex"),
    refs: [],
    eventIds: [],
    edited: false,
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    memoryId: null,
  };
  await records().insertOne(doc);
  return doc._id.toHexString();
}

const stored = async (id: string) => records().findOne({ _id: new ObjectId(id) });
const memoryOf = async (id: string) => {
  const memoryId = (await stored(id))?.memoryId;
  return memoryId ? memories().findOne({ _id: memoryId }) : null;
};

beforeAll(async () => {
  await ensureIndexes();
});
afterAll(async () => {
  await recordRules.hubPending();
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("an approved record's memory", () => {
  it("is archived when the record is discarded", async () => {
    const id = await draft("ada", "s-discard", "insight", "Invoices round per line, then sum.");
    await recordRules.approve(person("ada"), id);
    expect((await memoryOf(id))?.status).toBe("active");

    await recordRules.discard(person("ada"), id);
    expect((await stored(id))?.status).toBe("discarded");
    expect((await memoryOf(id))?.status).toBe("archived");
  });

  it("is archived when the record is edited, and comes back with the new words when it's approved again", async () => {
    const id = await draft("ada", "s-edit", "workflow", "Run the ledger tests before the integration tests.");
    await recordRules.approve(person("ada"), id);
    const first = await memoryOf(id);
    expect(first).toMatchObject({ status: "active", kind: "convention" });

    await recordRules.editRecord(person("ada"), id, { text: "Run the ledger tests first, always." });
    expect((await stored(id))?.status).toBe("draft");
    expect((await memories().findOne({ _id: first?._id }))?.status).toBe("archived");

    await recordRules.approve(person("ada"), id);
    const again = await memoryOf(id);
    expect(again?._id.equals(first?._id ?? new ObjectId())).toBe(true);
    expect(again).toMatchObject({ status: "active", text: "Run the ledger tests first, always." });
    // One memory for the record, never a second.
    expect(await memories().countDocuments({ "scope.user": "ada", "provenance.sessionID": "s-edit" })).toBe(1);
  });

  it("stays one memory when only the title changed between approvals", async () => {
    const id = await draft("ada", "s-title", "insight", "Refunds never touch the ledger directly.");
    await recordRules.approve(person("ada"), id);
    const first = await memoryOf(id);
    await recordRules.editRecord(person("ada"), id, { title: "Refunds" });
    await recordRules.approve(person("ada"), id);
    expect((await memoryOf(id))?._id.equals(first?._id ?? new ObjectId())).toBe(true);
    expect((await memoryOf(id))?.status).toBe("active");
    expect(
      await memories().countDocuments({ "scope.user": "ada", text: "Refunds never touch the ledger directly." }),
    ).toBe(1);
  });

  it("uses the memory already there when the new words are one, and leaves the first retired", async () => {
    const kept = await draft("ada", "s-kept", "insight", "Webhooks retry for three days.");
    await recordRules.approve(person("ada"), kept);
    const id = await draft("ada", "s-moved", "insight", "Webhooks retry for a day.");
    await recordRules.approve(person("ada"), id);
    const first = await memoryOf(id);

    await recordRules.editRecord(person("ada"), id, { text: "Webhooks retry for three days." });
    await recordRules.approve(person("ada"), id);
    expect((await stored(id))?.memoryId?.equals((await stored(kept))?.memoryId ?? new ObjectId())).toBe(true);
    expect((await memories().findOne({ _id: first?._id }))?.status).toBe("archived");
    expect(
      await memories().countDocuments({
        "scope.user": "ada",
        text: "Webhooks retry for three days.",
        status: "active",
      }),
    ).toBe(1);
  });

  it("stays while another approved record holds the same memory", async () => {
    const one = await draft("bo", "s-one", "insight", "Tax is computed per line item.");
    const two = await draft("bo", "s-two", "insight", "Tax is computed per line item.");
    await recordRules.approve(person("bo"), one);
    await recordRules.approve(person("bo"), two);
    const shared = await memoryOf(one);
    expect((await stored(two))?.memoryId?.equals(shared?._id ?? new ObjectId())).toBe(true);

    await recordRules.discard(person("bo"), one);
    expect((await memories().findOne({ _id: shared?._id }))?.status).toBe("active");
    await recordRules.discard(person("bo"), two);
    expect((await memories().findOne({ _id: shared?._id }))?.status).toBe("archived");
  });
});

describe("an edit that repeats another record", () => {
  it("is refused with a conflict, not a server error, and changes nothing", async () => {
    await draft("cy", "s-dup", "insight", "The invoice sync is at-least-once.");
    const id = await draft("cy", "s-dup", "insight", "The invoice sync can deliver twice.");
    const error = await recordRules
      .editRecord(person("cy"), id, { text: "The invoice sync is at-least-once." })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "duplicate" });
    expect((error as Error).message).toMatch(/already has the same insight/);
    expect(await stored(id)).toMatchObject({ text: "The invoice sync can deliver twice.", edited: false });

    // Through the API too: a 409 with the message, never a 500.
    const { key } = await createKey("cy", "laptop");
    const res = await recordRules.patchRecord(
      new Request(`http://test/api/records/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ text: "the invoice sync is at-least-once" }),
      }),
      id,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "duplicate" });
  });

  it("says so when the record it repeats was discarded", async () => {
    const gone = await draft("cy", "s-dup-gone", "pain_point", "The staging deploy hangs.");
    await recordRules.discard(person("cy"), gone);
    const id = await draft("cy", "s-dup-gone", "pain_point", "Staging deploys are slow.");
    await expect(recordRules.editRecord(person("cy"), id, { text: "The staging deploy hangs." })).rejects.toThrow(
      /discarded the same pain point/,
    );
  });

  it("goes through when the same words are a different kind of record", async () => {
    await draft("cy", "s-kinds", "insight", "Nobody owns the retry budget.");
    const id = await draft("cy", "s-kinds", "context_gap", "Who owns the retry budget?");
    const updated = await recordRules.editRecord(person("cy"), id, { text: "Nobody owns the retry budget." });
    expect(updated.text).toBe("Nobody owns the retry budget.");
  });
});

describe("the hub after a decision", () => {
  it("makes the product of an approved record's repository", async () => {
    const id = await draft(
      "dee",
      "s-shop",
      "pain_point",
      "The shop's build takes four minutes.",
      "github.com/acme/shop",
    );
    await recordRules.approve(person("dee"), id);
    expect(await products().findOne({ "repos.repo": "github.com/acme/shop" })).toBeTruthy();
  });

  it("opens a gap for an approved context gap, and drops it when that's discarded", async () => {
    const text = "No docs for how the retry budget is set.";
    const id = await draft("dee", "s-gap", "context_gap", text);
    await recordRules.approve(person("dee"), id);
    // Gaps sync in the background, after the decision.
    await recordRules.hubPending();
    const gap = await gaps().findOne({ text });
    expect(gap).toMatchObject({ status: "open", sessions: 1, fromAgents: 1 });
    expect(gap?.productId).toBe((await products().findOne({ "repos.repo": REPO }))?._id);

    await recordRules.discard(person("dee"), id);
    await recordRules.hubPending();
    expect(await gaps().findOne({ text })).toBeNull();
  });

  it("drops a gap when its approved record is edited back to a draft", async () => {
    const text = "Nothing says which queue the invoices use.";
    const id = await draft("dee", "s-gap-edit", "context_gap", text);
    await recordRules.approve(person("dee"), id);
    await recordRules.hubPending();
    expect(await gaps().findOne({ text })).toBeTruthy();

    await recordRules.editRecord(person("dee"), id, { text: "Nothing says which queue the invoices go to." });
    await recordRules.hubPending();
    expect(await gaps().findOne({ text })).toBeNull();
  });

  it("approves a record whose project isn't a repository without making a product", async () => {
    const before = await products().countDocuments();
    const id = await draft("dee", "s-local", "context_gap", "No docs for the local scripts.", "scratch");
    await recordRules.approve(person("dee"), id);
    await recordRules.hubPending();
    expect((await stored(id))?.status).toBe("approved");
    expect(await products().countDocuments()).toBe(before);
    expect(await gaps().findOne({ text: "No docs for the local scripts." })).toMatchObject({ productId: null });
  });
});
