// The frozen block's memories for a session: the scope's most trusted live memories (active, not expired), chosen the
// same way every time (confidence, then _id), so the same data gives the same block. The client renders them sorted by
// _id and keeps the bytes for the whole session.
import type { MemoryHit, Scope } from "@strata/contracts";
import { memories } from "../collections.ts";
import { scopeFilter } from "./scope.ts";
import { hit, liveFilter } from "./store.ts";

export const FROZEN_LIMIT = 30;

export async function frozen(scope: Scope): Promise<MemoryHit[]> {
  const chosen = await memories()
    .find({ ...scopeFilter(scope), ...liveFilter() }, { projection: { kind: 1, text: 1 } })
    .sort({ confidence: -1, _id: 1 })
    .limit(FROZEN_LIMIT)
    .toArray();
  return chosen.map(hit).sort((a, b) => (a._id < b._id ? -1 : 1));
}
