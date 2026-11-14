// pnpm db:indexes: every index on MONGODB_URI's database, and the vector index queryable before it returns. Ask Strata's
// two search indexes are made here and nowhere else (Atlas embeds what they index, billed); they build in the background.
import { closeMongo } from "../server/db.ts";
import { ensureIndexes, ensureTeamSearchIndexes } from "../server/indexes.ts";

const started = Date.now();
const { vector } = await ensureIndexes({ wait: true, timeoutMs: 180_000 });
console.log(
  `db:indexes: collection indexes ready; vector index ${vector} (${Math.round((Date.now() - started) / 1000)}s)`,
);
const search = await ensureTeamSearchIndexes();
console.log(
  `db:indexes: Ask Strata's search indexes: ${search.map((s) => `${s.name} ${s.action}${s.status ? ` (${s.status})` : ""}`).join(", ")}`,
);
await closeMongo();
if (vector === "pending") process.exitCode = 1;
