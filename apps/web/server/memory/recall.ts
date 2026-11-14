// What to remember for one message: the scope's live memories (active, not expired) nearest the message, by vector
// search where the index is ready, topped up by the text index. Fast: the client gives this 800 ms and carries on
// without it. The vector search compares only memories embedded by the active model (`embeddingModel`), so vectors
// from two models never meet; the text index has no such limit, since it reads words, not vectors.
import type { MemoryHit, Scope } from "@strata/contracts";
import type { Filter } from "mongodb";
import { embeddingModelId, provider } from "../ai/provider.ts";
import { type MemoryDoc, memories, VECTOR_INDEX } from "../collections.ts";
import { scopeFilter } from "./scope.ts";
import { hit, liveFilter } from "./store.ts";

// Atlas reports cosine similarity as (1 + cos) / 2: 0.6 is a cosine of 0.2, the least that's worth a token.
const MIN_VECTOR_SCORE = 0.6;

// What a recall may read: the scope's live memories.
export const recallFilter = (scope: Scope, now = new Date()) =>
  ({ ...scopeFilter(scope), ...liveFilter(now) }) as Filter<MemoryDoc>;

export async function recall(scope: Scope, query: string, k: number): Promise<MemoryHit[]> {
  const filter = recallFilter(scope);
  const found = new Map<string, MemoryHit>();
  try {
    const ai = provider();
    const [vector] = await ai.embed([query], { purpose: "query" });
    const near = await memories()
      .aggregate<Pick<MemoryDoc, "_id" | "kind" | "text"> & { score: number }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "embedding",
            queryVector: vector,
            numCandidates: Math.max(k * 20, 100),
            limit: k,
            filter: { ...filter, embeddingModel: embeddingModelId(ai) },
          },
        },
        // The same rules again, after the search: a guard against an index defined before expiry was a filter.
        { $match: filter },
        { $project: { kind: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    for (const m of near) if (m.score >= MIN_VECTOR_SCORE) found.set(m._id.toHexString(), hit(m));
  } catch {
    // No vector index (yet), one for another model, or the embeddings API didn't answer in time: the text index alone.
  }
  if (found.size < k) {
    const terms = query.replace(/["\\]/g, " ").slice(0, 500);
    const text = await memories()
      .find(
        { ...filter, $text: { $search: terms } },
        { projection: { kind: 1, text: 1, score: { $meta: "textScore" } } },
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(k)
      .toArray();
    for (const m of text) if (found.size < k) found.set(m._id.toHexString(), hit(m));
  }
  return [...found.values()];
}
