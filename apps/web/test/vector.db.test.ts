// Retrieval governance on a real Atlas Search engine (the team's atlas-local MongoDB): recall and frozen give back only
// the scope's live memories, even when what they must leave out are the nearest vectors there are. Also: the vector
// index follows the provider's dimensions. On a database of its own, dropped afterwards.
import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const name = `am_vec_${randomBytes(4).toString("hex")}`;
const base = process.env.MONGODB_URI ?? "mongodb://localhost:9317/?directConnection=true";
process.env.MONGODB_URI = base.replace(/\/([^/?]*)(\?|$)/, `/${name}$2`);
process.env.MEMORY_AI_PROVIDER = "stub";

const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes, vectorIndexInfo } = await import("../server/indexes.ts");
const { memories, VECTOR_INDEX } = await import("../server/collections.ts");
const { recall, recallFilter } = await import("../server/memory/recall.ts");
const { frozen } = await import("../server/memory/frozen.ts");
const { addMemory } = await import("../server/memory/store.ts");
const { embeddingModelId, provider, stubEmbed } = await import("../server/ai/provider.ts");
type MemoryDoc = import("../server/collections.ts").MemoryDoc;

const scope = { org: "acme", user: "ada", project: "acme/api" };
const QUERY = "how do we rotate the production signing keys";
const MODEL = embeddingModelId(provider());
const DAY = 24 * 60 * 60 * 1000;

// Every memory gets the query's own vector, so each is as near as a memory can be (a score of 1).
const doc = (label: string, over: Partial<MemoryDoc> = {}): MemoryDoc => ({
  _id: new ObjectId(),
  scope,
  kind: "fact",
  text: `${label}: rotate the production signing keys every quarter`,
  textKey: label,
  embedding: stubEmbed(QUERY),
  embeddingModel: MODEL,
  provenance: { sessionID: null, messageID: null, eventId: null, source: "manual" },
  trust: "explicit",
  confidence: 0.9,
  status: "active",
  supersedes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
  ...over,
});

const kept = [
  doc("live"),
  doc("live-until-tomorrow", { expiresAt: new Date(Date.now() + DAY) }),
  doc("every-project", { scope: { ...scope, project: "*" } }),
  // No words in common with the query: only the vector search can find it, which proves that path ran.
  doc("vector-only", { text: "Quarterly credential turnover happens in the vault." }),
];
const left = [
  doc("expired", { expiresAt: new Date(Date.now() - DAY) }),
  doc("superseded", { status: "superseded" }),
  doc("archived", { status: "archived" }),
  doc("candidate", { status: "candidate" }),
  doc("other-user", { scope: { ...scope, user: "grace" } }),
  doc("other-project", { scope: { ...scope, project: "acme/web" } }),
  doc("other-org", { scope: { ...scope, org: "globex" } }),
];
// As near as the rest, but embedded by another model: recall's vector search never compares it (and it shares no words
// with the query for the text index). It is live and in scope, so frozen, which reads no vectors, still has it.
const otherModel = doc("other-model", {
  text: "Lunch is at noon on Fridays.",
  embeddingModel: "openai:text-embedding-3-small:256",
});

// mongot indexes inserts a moment after they land: wait until every probe is searchable.
async function searchable(ids: ObjectId[], timeoutMs = 60_000): Promise<void> {
  const want = new Set(ids.map((id) => id.toHexString()));
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const seen = await memories()
      .aggregate<{ _id: ObjectId }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "embedding",
            queryVector: stubEmbed(QUERY),
            numCandidates: 500,
            limit: 100,
          },
        },
        { $project: { _id: 1 } },
      ])
      .toArray()
      .catch(() => []);
    if ([...want].every((id) => seen.some((s) => s._id.toHexString() === id))) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the probe memories never became searchable");
}

beforeAll(async () => {
  await ensureIndexes({ wait: true, timeoutMs: 150_000 });
  await memories().insertMany([...kept, ...left, otherModel]);
  await searchable([...kept, ...left, otherModel].map((m) => m._id));
});
afterAll(async () => {
  await db().dropDatabase();
  await closeMongo();
});

describe("the vector index", () => {
  it("is built for the active provider: its dimensions, and every field recall filters on", async () => {
    const info = await vectorIndexInfo();
    expect(info).toMatchObject({ state: "ready", numDimensions: 256, expectedDimensions: 256, matches: true });
    expect(info.filters).toEqual(
      expect.arrayContaining(["scope.org", "scope.user", "scope.project", "status", "expiresAt", "embeddingModel"]),
    );
  });

  it("stamps each new memory with the model that embedded it", async () => {
    const { memory } = await addMemory({
      scope: { ...scope, user: "stamp" },
      kind: "fact",
      text: "The stamp test memory.",
      status: "active",
      trust: "explicit",
      confidence: 0.5,
      provenance: { sessionID: null, messageID: null, eventId: null, source: "manual" },
    });
    expect(memory.embeddingModel).toBe("stub:fnv1a-hash:256");
    expect((await memories().findOne({ _id: memory._id }))?.embeddingModel).toBe("stub:fnv1a-hash:256");
  });
});

describe("retrieval governance", () => {
  it("recall gives back only live memories in scope, never expired, superseded, archived, others' or another model's", async () => {
    const hits = await recall(scope, QUERY, 20);
    const labels = hits.map((h) => h.text.split(":")[0]).sort();
    expect(labels).toEqual(
      ["Quarterly credential turnover happens in the vault.", "every-project", "live", "live-until-tomorrow"].sort(),
    );
  });

  it("the vector search's own pre-filter leaves them out, before any later stage", async () => {
    const raw = await memories()
      .aggregate<{ _id: ObjectId }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "embedding",
            queryVector: stubEmbed(QUERY),
            numCandidates: 500,
            limit: 100,
            filter: { ...recallFilter(scope), embeddingModel: MODEL },
          },
        },
        { $project: { _id: 1 } },
      ])
      .toArray();
    expect(raw.map((r) => r._id.toHexString()).sort()).toEqual(kept.map((m) => m._id.toHexString()).sort());
  });

  it("frozen leaves out the same memories", async () => {
    const ids = new Set((await frozen(scope)).map((h) => h._id));
    for (const m of [...kept, otherModel]) expect(ids.has(m._id.toHexString()), m.textKey).toBe(true);
    for (const m of left) expect(ids.has(m._id.toHexString()), m.textKey).toBe(false);
  });

  it("a memory that expires drops out of recall at once, with no change to the index", async () => {
    const soon = doc("expires-soon", { expiresAt: new Date(Date.now() + 1500) });
    await memories().insertOne(soon);
    await searchable([soon._id]);
    expect((await recall(scope, QUERY, 20)).map((h) => h._id)).toContain(soon._id.toHexString());
    await new Promise((r) => setTimeout(r, 1600));
    expect((await recall(scope, QUERY, 20)).map((h) => h._id)).not.toContain(soon._id.toHexString());
    expect((await frozen(scope)).map((h) => h._id)).not.toContain(soon._id.toHexString());
  });
});

describe("health", () => {
  it("says what recall runs on, honestly: stub embeddings aren't semantic", async () => {
    const { GET } = await import("../app/api/health/route.ts");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      db: "up",
      search: "ready",
      embeddings: { provider: "stub", model: "fnv1a-hash", dimensions: 256, semantic: false },
      vectorIndex: { state: "ready", numDimensions: 256, expectedDimensions: 256, matchesProvider: true },
      cluster: { kind: "local", version: expect.any(String) },
    });
  });
});

describe("dimensions", () => {
  it("an index built for other dimensions is updated to the provider's", async () => {
    // An index left from another provider: 128 dimensions and none of the filters.
    await memories().dropSearchIndex(VECTOR_INDEX);
    const until = Date.now() + 60_000;
    while ((await memories().listSearchIndexes(VECTOR_INDEX).toArray()).length && Date.now() < until)
      await new Promise((r) => setTimeout(r, 500));
    await memories().createSearchIndex({
      name: VECTOR_INDEX,
      type: "vectorSearch",
      definition: { fields: [{ type: "vector", path: "embedding", numDimensions: 128, similarity: "cosine" }] },
    });
    expect(await vectorIndexInfo()).toMatchObject({ numDimensions: 128, matches: false, state: "pending" });

    const result = await ensureIndexes({ wait: true, timeoutMs: 150_000 });
    expect(result.vectorAction).toBe("updated");
    expect(result.vectorDetail).toContain("from 128 to 256 dimensions");
    expect(result.vector).toBe("ready");
    expect(await vectorIndexInfo()).toMatchObject({ numDimensions: 256, matches: true });
    expect((await ensureIndexes()).vectorAction).toBe("unchanged");
  }, 200_000);
});
