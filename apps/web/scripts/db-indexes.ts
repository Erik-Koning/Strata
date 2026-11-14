// pnpm db:indexes: every index on MONGODB_URI's database, and the vector index queryable before it returns.
import { closeMongo } from "../server/db.ts";
import { ensureIndexes } from "../server/indexes.ts";

const started = Date.now();
const { vector } = await ensureIndexes({ wait: true, timeoutMs: 180_000 });
console.log(
  `db:indexes: collection indexes ready; vector index ${vector} (${Math.round((Date.now() - started) / 1000)}s)`,
);
await closeMongo();
if (vector === "pending") process.exitCode = 1;
