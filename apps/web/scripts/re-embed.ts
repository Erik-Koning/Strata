// pnpm db:reembed: embed again, with the active provider, every memory whose vector came from another model (or from
// no recorded model), so recall's vector search can see it. The vector index is brought to the provider's dimensions
// first. Flags: --dry-run (count only), --all (every memory, even ones already on this model), --batch=N.
// Statuses are left as they are; updatedAt too (the memory's words didn't change).
import type { ObjectId } from "mongodb";
import { embeddingModelId, provider } from "../server/ai/provider.ts";
import { memories } from "../server/collections.ts";
import { closeMongo } from "../server/db.ts";
import { ensureIndexes } from "../server/indexes.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const all = args.includes("--all");
const batchSize = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? 64);

try {
  const ai = provider();
  const model = embeddingModelId(ai);
  const filter = all ? {} : { embeddingModel: { $ne: model } };
  const total = await memories().countDocuments(filter);
  const byModel = await memories()
    .aggregate<{ _id: string | null; n: number }>([
      { $match: filter },
      { $group: { _id: "$embeddingModel", n: { $sum: 1 } } },
    ])
    .toArray();
  console.log(`db:reembed: active model ${model}${ai.semantic ? "" : " (stub: hash vectors, not semantic)"}`);
  console.log(
    `db:reembed: ${total} memories to embed${all ? " (--all)" : ""}: ${byModel.map((m) => `${m._id ?? "unrecorded"} ${m.n}`).join(", ") || "none"}`,
  );
  if (dryRun || total === 0) {
    if (dryRun) console.log("db:reembed: --dry-run, nothing changed");
  } else {
    const index = await ensureIndexes();
    console.log(`db:reembed: vector index: ${index.vectorDetail} (${index.vector})`);
    let done = 0;
    // In _id order, a batch at a time: a run that stops can simply be run again.
    let after: ObjectId | null = null;
    for (;;) {
      const todo = await memories()
        .find({ ...filter, ...(after ? { _id: { $gt: after } } : {}) }, { projection: { _id: 1, text: 1 } })
        .sort({ _id: 1 })
        .limit(batchSize)
        .toArray();
      if (!todo.length) break;
      const vectors = await ai.embed(
        todo.map((m) => m.text),
        { purpose: "document" },
      );
      await memories().bulkWrite(
        todo.map((m, i) => ({
          updateOne: { filter: { _id: m._id }, update: { $set: { embedding: vectors[i]!, embeddingModel: model } } },
        })),
      );
      after = todo[todo.length - 1]!._id;
      done += todo.length;
      console.log(`db:reembed: ${done}/${total}`);
    }
    console.log(`db:reembed: done, ${done} memories now on ${model}`);
  }
} catch (error) {
  console.error(`db:reembed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
