// What to remember for one message: the scope's active memories nearest the message, by vector search where the index
// is ready, topped up by the text index. Fast: the client gives this 800 ms and carries on without it.
import type { MemoryHit, Scope } from "@strata/contracts";
import type { Filter } from "mongodb";
import { provider } from "../ai/provider.ts";
import { type MemoryDoc, memories, VECTOR_INDEX } from "../collections.ts";
import { scopeFilter } from "./scope.ts";
import { hit } from "./store.ts";

// Atlas reports cosine similarity as (1 + cos) / 2: 0.6 is a cosine of 0.2, the least that's worth a token.
const MIN_VECTOR_SCORE = 0.6;

export async function recall(scope: Scope, query: string, k: number): Promise<MemoryHit[]> {
  const filter = { ...scopeFilter(scope), status: "active" } as Filter<MemoryDoc>;
  const found = new Map<string, MemoryHit>();
  const [vector] = await provider().embed([query]);
  try {
    const near = await memories()
      .aggregate<Pick<MemoryDoc, "_id" | "kind" | "text"> & { score: number }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "embedding",
            queryVector: vector,
            numCandidates: k * 20,
            limit: k,
            filter,
          },
        },
        { $project: { kind: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    for (const m of near) if (m.score >= MIN_VECTOR_SCORE) found.set(m._id.toHexString(), hit(m));
  } catch {
    // No vector index (yet): the text index alone.
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
