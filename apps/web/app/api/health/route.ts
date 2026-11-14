// The health check the environment and the container poll: 200 when the database answers, with the vector index's state.
import { db } from "../../../server/db.ts";
import { indexesReady, vectorIndexState } from "../../../server/indexes.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await db().command({ ping: 1 });
    await indexesReady();
    const search = await vectorIndexState();
    return Response.json(
      { ok: true, service: "strata", db: "up", search },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, service: "strata", db: "down" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
