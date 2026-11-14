// The hub's backfill, in the order each step needs the last: a product for every repository seen, tool time counted
// from every stored tool event not counted yet, and gaps reconciled with approved work. Each step is idempotent, so
// running it again only does what's left. `pnpm hub:backfill` runs it (scripts/hub-backfill.ts).
import { syncGaps } from "./gaps.ts";
import { ensureProducts } from "./products.ts";
import { backfillSignals } from "./signals.ts";

export interface BackfillReport {
  products: { created: string[]; total: number };
  signals: { counted: number; sessions: number };
  gaps: { gaps: number; created: number; updated: number; removed: number };
}

export async function runHubBackfill(log: (line: string) => void = () => undefined): Promise<BackfillReport> {
  const made = await ensureProducts();
  const products = { created: made.created.map((p) => p.id), total: made.total };
  log(
    `products: ${products.created.length} made${products.created.length ? ` (${products.created.join(", ")})` : ""}, ${products.total} in all`,
  );
  const signals = await backfillSignals();
  log(`signal_daily: ${signals.counted} tool runs counted, from ${signals.sessions} sessions read`);
  const gaps = await syncGaps();
  log(
    `gaps: ${gaps.gaps} named by approved work; ${gaps.created} new, ${gaps.updated} updated, ${gaps.removed} removed`,
  );
  return { products, signals, gaps };
}
