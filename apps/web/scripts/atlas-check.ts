// pnpm atlas:check: what MONGODB_URI's database really is, and a real round trip through Atlas Vector Search with the
// active embeddings provider. It prints the server (Atlas or local, its version), the database, its collections, the
// indexes on memories and handoffs, and the vector index against the provider's dimensions; then it stores three probe
// memories in a throwaway scope, waits until they're searchable, searches with the provider's query embedding, prints
// the ranking with scores, and deletes the probes. Any failure exits non-zero. It says plainly whether the search was
// semantic (a real model) or the stub's hash vectors.
import { randomBytes } from "node:crypto";
import { embeddingModelId, provider } from "../server/ai/provider.ts";
import { memories, VECTOR_INDEX } from "../server/collections.ts";
import { config } from "../server/config.ts";
import { closeMongo, db } from "../server/db.ts";
import { clusterInfo, vectorIndexInfo } from "../server/indexes.ts";
import { recall, recallFilter } from "../server/memory/recall.ts";
import { addMemory } from "../server/memory/store.ts";

const failures: string[] = [];
const ok = (line: string) => console.log(`  ok    ${line}`);
const fail = (line: string) => {
  failures.push(line);
  console.log(`  FAIL  ${line}`);
};
const info = (line: string) => console.log(`        ${line}`);

// The probes: one the lexical query matches, one only a semantic model connects to its paraphrase, one about neither.
const PROBES = [
  { key: "pnpm", text: "Use pnpm to install dependencies, never npm or yarn." },
  { key: "staging", text: "Staging deploys from the release branch, not from main." },
  { key: "coffee", text: "The office coffee machine is on the third floor." },
];
const QUERIES = [
  // Shares words with the staging probe: any provider, the stub included, must rank it first.
  { query: "which branch does staging deploy from?", expect: "staging", semanticOnly: false },
  // Shares no meaningful word with the pnpm probe: only a semantic model ranks it first.
  { query: "which tool adds JavaScript libraries to a project?", expect: "pnpm", semanticOnly: true },
];

const scope = { org: "strata-atlas-check", user: `probe-${randomBytes(4).toString("hex")}`, project: "atlas-check" };

async function main(): Promise<void> {
  const uri = config().mongoUri;
  console.log("Strata atlas:check\n");

  console.log("Server");
  const cluster = await clusterInfo();
  await db().command({ ping: 1 });
  ok(`connected: ${cluster.kind === "atlas" ? "MongoDB Atlas (cloud)" : "local MongoDB (not Atlas cloud)"}`);
  info(
    `scheme ${uri.startsWith("mongodb+srv:") ? "mongodb+srv" : "mongodb"}, server version ${cluster.version ?? "unknown"}`,
  );
  info(`database ${db().databaseName}`);
  const collections = (await db().listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
  info(`collections (${collections.length}): ${collections.join(", ") || "none"}`);

  console.log("\nIndexes");
  for (const name of ["memories", "handoffs"]) {
    if (!collections.includes(name)) {
      fail(`${name}: no such collection (run pnpm db:indexes)`);
      continue;
    }
    const indexes = await db().collection(name).indexes();
    info(`${name}:`);
    for (const ix of indexes) info(`  ${ix.name}  ${JSON.stringify(ix.key)}${ix.unique ? " unique" : ""}`);
  }

  console.log("\nEmbeddings");
  const ai = provider();
  const model = embeddingModelId(ai);
  info(`provider ${ai.name}, model ${ai.model}, ${ai.dimensions} dimensions (${model})`);
  info(`summaries: ${ai.summarizer}`);
  if (ai.semantic) ok("a real embedding model: vector search is semantic");
  else info("STUB: hash embeddings, lexical only. Vector search here proves the index and the pipeline, not meaning.");

  console.log("\nVector index");
  const vector = await vectorIndexInfo();
  if (vector.state === "unavailable") {
    fail("this server has no Atlas Search (listSearchIndexes failed): recall would use the text index only");
    return;
  }
  info(`${VECTOR_INDEX}: status ${vector.status ?? "missing"}, queryable ${vector.queryable}`);
  info(`definition ${JSON.stringify(vector.definition)}`);
  if (vector.numDimensions === null) fail(`${VECTOR_INDEX} doesn't exist (run pnpm db:indexes)`);
  else if (vector.numDimensions !== ai.dimensions)
    fail(
      `${vector.numDimensions} dimensions, but ${ai.name} gives ${ai.dimensions} (run pnpm db:indexes, then pnpm db:reembed)`,
    );
  else ok(`${vector.numDimensions} dimensions, matching the provider`);
  if (vector.matches) ok(`definition matches what recall needs (filters: ${vector.filters.join(", ")})`);
  else
    fail(
      `definition differs from what recall needs (filters: ${vector.filters.join(", ") || "none"}); run pnpm db:indexes`,
    );
  if (vector.state !== "ready") {
    fail(`not ready (${vector.state}); run pnpm db:indexes, which waits for it`);
    return;
  }
  const counts = await memories()
    .aggregate<{ _id: string | null; n: number }>([{ $group: { _id: "$embeddingModel", n: { $sum: 1 } } }])
    .toArray();
  info(`memories by model: ${counts.map((c) => `${c._id ?? "unrecorded"} ${c.n}`).join(", ") || "none"}`);
  const stale = counts.filter((c) => c._id !== model).reduce((n, c) => n + c.n, 0);
  if (stale) info(`${stale} memories are on another model and invisible to vector search until pnpm db:reembed`);

  console.log(`\nEnd to end (throwaway scope ${scope.org}/${scope.user})`);
  const ids = [];
  try {
    const started = Date.now();
    for (const p of PROBES) {
      const { memory } = await addMemory({
        scope,
        kind: "fact",
        text: p.text,
        status: "active",
        trust: "explicit",
        confidence: 0.5,
        provenance: { sessionID: null, messageID: null, eventId: null, source: "manual" },
      });
      ids.push(memory._id);
    }
    ok(`stored ${ids.length} probe memories, embedded by ${model} (${Date.now() - started} ms)`);

    // Searchable once a filtered search sees all three.
    const waitStart = Date.now();
    const [anyVector] = await ai.embed([PROBES[0]!.text], { purpose: "query" });
    for (;;) {
      const seen = await search(anyVector!, 10);
      if (seen.length >= PROBES.length) break;
      if (Date.now() - waitStart > 90_000) {
        fail(`the probes weren't searchable after 90 s (${seen.length}/${PROBES.length} seen)`);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    ok(`searchable after ${Date.now() - waitStart} ms`);

    for (const q of QUERIES) {
      const t = Date.now();
      const [qv] = await ai.embed([q.query], { purpose: "query" });
      const embedMs = Date.now() - t;
      const ranked = await search(qv!, PROBES.length);
      console.log(
        `\n  query: "${q.query}"  (query embedding ${embedMs} ms, $vectorSearch ${Date.now() - t - embedMs} ms)`,
      );
      for (const [i, r] of ranked.entries())
        info(`${i + 1}. ${r.score.toFixed(4)}  ${PROBES.find((p) => p.text === r.text)?.key ?? "?"}  ${r.text}`);
      const top = PROBES.find((p) => p.text === ranked[0]?.text)?.key;
      if (q.semanticOnly && !ai.semantic)
        info(
          `paraphrase test skipped for the stub (top: ${top ?? "nothing"}); hash vectors can't match meaning, so any order here is chance`,
        );
      else if (top === q.expect)
        ok(`top result is the ${q.expect} probe${q.semanticOnly ? " (a paraphrase: semantic)" : ""}`);
      else fail(`top result is ${top ?? "nothing"}, expected ${q.expect}`);
    }

    const hits = await recall(scope, QUERIES[0]!.query, 3);
    if (hits[0]?.text === PROBES[1]!.text) ok(`recall() through the app's own code ranks the staging probe first`);
    else fail(`recall() gave ${JSON.stringify(hits.map((h) => h.text))}`);
  } finally {
    if (ids.length) {
      const { deletedCount } = await memories().deleteMany({ _id: { $in: ids } });
      if (deletedCount === ids.length) ok(`deleted the ${deletedCount} probes`);
      else fail(`deleted ${deletedCount} of ${ids.length} probes`);
    }
  }
  console.log(
    `\nRetrieval was ${ai.semantic ? `SEMANTIC (${model})` : "the STUB (hash vectors: lexical, not semantic)"} on ${cluster.kind === "atlas" ? "Atlas cloud" : "a local MongoDB"}.`,
  );

  async function search(queryVector: number[], limit: number) {
    return memories()
      .aggregate<{ text: string; score: number }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "embedding",
            queryVector,
            numCandidates: 100,
            limit,
            filter: { ...recallFilter(scope), embeddingModel: model },
          },
        },
        { $project: { _id: 0, text: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
  }
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await closeMongo();
}
if (failures.length) {
  console.log(`\natlas:check FAILED (${failures.length}):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exitCode = 1;
} else console.log("\natlas:check passed");
