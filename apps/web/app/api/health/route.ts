// The health check the environment and the container poll: 200 when the database answers, with the vector index's state
// and the contract versions the API accepts. It also says, plainly, what recall runs on: which embeddings (and whether
// they are semantic at all: the stub's are hashed words), the vector index against the provider's dimensions, and
// whether the database is Atlas or a local one.
import { CONTRACT_VERSION, MIN_CONTRACT_VERSION } from "@strata/contracts";
import { embeddingModelId, provider } from "../../../server/ai/provider.ts";
import { db } from "../../../server/db.ts";
import { clusterInfo, indexesReady, vectorIndexInfo } from "../../../server/indexes.ts";

export const dynamic = "force-dynamic";

function embeddings() {
  try {
    const p = provider();
    return {
      provider: p.name,
      model: p.model,
      dimensions: p.dimensions,
      id: embeddingModelId(p),
      semantic: p.semantic,
      summarizer: p.summarizer,
      note: p.semantic
        ? "real embedding model: vector search is semantic"
        : "hash embeddings, lexical only: vector search matches shared words, not meaning",
    };
  } catch (error) {
    return { provider: null, semantic: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(): Promise<Response> {
  try {
    await db().command({ ping: 1 });
  } catch {
    return Response.json(
      { ok: false, service: "strata", db: "down" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const ai = embeddings();
  try {
    await indexesReady();
    const [index, cluster] = await Promise.all([vectorIndexInfo(), clusterInfo()]);
    return Response.json(
      {
        ok: true,
        service: "strata",
        db: "up",
        search: index.state,
        contract: { min: MIN_CONTRACT_VERSION, max: CONTRACT_VERSION },
        embeddings: ai,
        vectorIndex: {
          state: index.state,
          status: index.status,
          numDimensions: index.numDimensions,
          expectedDimensions: index.expectedDimensions,
          matchesProvider: index.matches,
        },
        cluster,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    // The database answers, but the indexes couldn't be made: most often an embeddings provider that isn't set up.
    return Response.json(
      { ok: false, service: "strata", db: "up", embeddings: ai, error: "indexes not ready" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
