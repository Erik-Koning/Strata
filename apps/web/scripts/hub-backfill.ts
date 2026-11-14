// pnpm hub:backfill: fills the hub's derived collections (products, signal_daily, gaps) on MONGODB_URI's database from
// what's already there: events still stored, approved records and summaries. Idempotent: a second run only does what's
// left. Run it against the team's database only when the operator says so (docs/hub-build-plan.md, D1).
import { closeMongo } from "../server/db.ts";
import { runHubBackfill } from "../server/hub/backfill.ts";
import { ensureIndexes } from "../server/indexes.ts";

const started = Date.now();
try {
  await ensureIndexes();
  await runHubBackfill((line) => console.log(`hub:backfill: ${line}`));
  console.log(`hub:backfill: done (${Math.round((Date.now() - started) / 1000)}s)`);
} catch (error) {
  console.error("hub:backfill: failed", error);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
