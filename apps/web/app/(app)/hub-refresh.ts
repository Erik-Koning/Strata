// The hub's derived rows (a product per repository, gaps named by approved work) are made by an idempotent backfill.
// Pages call this before they list, at most once a minute per server process, so new work shows up without a cron job.
import { syncGaps } from "../../server/hub/gaps.ts";
import { ensureProducts } from "../../server/hub/products.ts";

let last = 0;

export async function refreshHub(): Promise<void> {
  if (Date.now() - last < 60_000) return;
  last = Date.now();
  try {
    await ensureProducts();
    await syncGaps();
  } catch (error) {
    last = 0;
    console.error("hub: refresh failed", error);
  }
}
