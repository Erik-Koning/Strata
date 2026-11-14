// signal_daily: where engineering time goes. Each shell command a client reports (a tool event with a command signal:
// class, exit, fingerprint, duration; never the command) is counted into one row per UTC day, product, repository,
// command class and fingerprint, as the events arrive (ingest calls recordSignals) and, for events stored before that
// or missed, by backfillSignals. An event is counted once: signaledAt marks it.
//
// No row names a person, and none can be traced to one: time is measured on tools, never on people. Rows outlive the
// events' 30 days, which is the point. The pages read them through timeLost and timeTrend (how hours lost are worked
// out is in time-math.ts), and only for products people can see (those with approved work).
import { createHash } from "node:crypto";
import type { AnyBulkWriteOperation } from "mongodb";
import { type EventDoc, events, type SignalDailyDoc, signalDaily } from "../collections.ts";
import { ensureProducts, ensureProductsFor, type ProductIndex, productIndex, sharedRepos } from "./products.ts";
import { reader, type ViewerRef } from "./reader.ts";
import { dayKey, normalizeRepo, WEEK_MS, weekStart } from "./text.ts";
import {
  addRun,
  emptyCounters,
  type Lost,
  lostTime,
  medianMs,
  mergeCounters,
  type SignalCounters,
  toHours,
} from "./time-math.ts";

// The stable key of one item: a command (by class and fingerprint) in one repository.
export const itemKeyOf = (repo: string, cls: string, fp: string): string =>
  createHash("sha1").update(`${repo}\u001f${cls}\u001f${fp}`).digest("hex").slice(0, 20);

const CLASS = /^[a-z][a-z0-9_.-]{0,39}$/;
const FP = /^[0-9a-f]{16,64}$/;

export interface CommandRun {
  cls: string;
  fp: string;
  ms: number | null;
  failed: boolean;
  background: boolean;
}

// The command a tool event reports, if it reports one.
export function commandOf(event: Pick<EventDoc, "kind" | "known" | "payload">): CommandRun | null {
  if (event.known === false || event.kind !== "tool") return null;
  const payload = event.payload as { status?: unknown; ms?: unknown; command?: unknown };
  const command = payload.command as { class?: unknown; exit?: unknown; fp?: unknown; background?: unknown } | null;
  if (!command || typeof command !== "object" || typeof command.class !== "string" || !CLASS.test(command.class))
    return null;
  const exit = typeof command.exit === "number" ? command.exit : 0;
  return {
    cls: command.class,
    fp: typeof command.fp === "string" && FP.test(command.fp) ? command.fp : "",
    ms: typeof payload.ms === "number" && Number.isFinite(payload.ms) && payload.ms >= 0 ? payload.ms : null,
    failed: payload.status === "error" || payload.status === "interrupted" || exit > 0,
    background: command.background === true,
  };
}

interface Row {
  day: string;
  productId: string | null;
  repo: string;
  cls: string;
  fp: string;
  item: string;
  counters: SignalCounters;
}

// Adds runs up into rows, in memory, before one write.
class Rows {
  readonly rows = new Map<string, Row>();
  readonly ids: string[] = [];

  add(event: EventDoc, run: CommandRun, repo: string, productId: string | null, rerun: boolean): void {
    const day = dayKey(event.ts);
    const item = itemKeyOf(repo, run.cls, run.fp);
    const key = `${item}\u001f${day}\u001f${productId ?? ""}`;
    const row = this.rows.get(key) ?? {
      day,
      productId,
      repo,
      cls: run.cls,
      fp: run.fp,
      item,
      counters: emptyCounters(),
    };
    addRun(row.counters, { ms: run.ms, failed: run.failed, rerun: rerun && run.fp !== "", background: run.background });
    this.rows.set(key, row);
    this.ids.push(event.id);
  }

  // The rows' counts added in, then the events marked as counted.
  async write(): Promise<number> {
    if (!this.rows.size) return 0;
    const now = new Date();
    const ops: AnyBulkWriteOperation<SignalDailyDoc>[] = [...this.rows.values()].map((row) => {
      const c = row.counters;
      const inc: Record<string, number> = {
        runs: c.runs,
        failures: c.failures,
        reruns: c.reruns,
        timedRuns: c.timedRuns,
        totalMs: c.totalMs,
        failedMs: c.failedMs,
        rerunMs: c.rerunMs,
      };
      for (const [bucket, count] of Object.entries(c.hist)) inc[`hist.${bucket}`] = count;
      for (const [bucket, count] of Object.entries(c.okHist)) inc[`okHist.${bucket}`] = count;
      return {
        updateOne: {
          filter: { item: row.item, day: row.day, productId: row.productId },
          update: {
            $inc: inc,
            $set: { updatedAt: now },
            $setOnInsert: { repo: row.repo, class: row.cls, fp: row.fp },
          },
          upsert: true,
        },
      };
    });
    await signalDaily().bulkWrite(ops, { ordered: false });
    await events().updateMany({ id: { $in: this.ids } }, { $set: { signaledAt: now } });
    const counted = this.ids.length;
    this.rows.clear();
    this.ids.length = 0;
    return counted;
  }
}

const sessionKey = (event: Pick<EventDoc, "scope" | "sessionID">): string =>
  `${event.scope.user}\u001f${event.sessionID}`;

// Orders a session's events as they happened; the id breaks a tie the same way everywhere.
const byTime = (a: EventDoc, b: EventDoc): number => a.ts.getTime() - b.ts.getTime() || a.id.localeCompare(b.id);

const folderOf = (event: EventDoc): string | null => {
  if (event.kind !== "session") return null;
  const git = event.payload.git as { path?: unknown } | undefined;
  return typeof git?.path === "string" ? git.path : null;
};

// Counts freshly stored events. Called by ingest with the events it just inserted; makes a product for each repository
// they name. Only re-run detection reads back: the earlier runs of the same commands in the same sessions.
export async function recordSignals(docs: EventDoc[]): Promise<{ counted: number }> {
  if (!docs.length) return { counted: 0 };
  await ensureProductsFor(
    docs.flatMap((doc) => [doc.scope.project, (doc.payload.git as { remote?: string } | undefined)?.remote]),
  );
  const runs = docs.flatMap((event) => {
    const run = commandOf(event);
    const repo = normalizeRepo(event.scope.project);
    return run && repo && !event.signaledAt ? [{ event, run, repo }] : [];
  });
  if (!runs.length) return { counted: 0 };
  const index = await productIndex({ cache: true });

  const sessions = new Map<string, typeof runs>();
  for (const entry of runs)
    sessions.set(sessionKey(entry.event), [...(sessions.get(sessionKey(entry.event)) ?? []), entry]);

  const rows = new Rows();
  await Promise.all(
    [...sessions.values()].map(async (entries) => {
      const first = entries[0]!.event;
      const fps = [...new Set(entries.map((e) => e.run.fp).filter(Boolean))];
      const needsFolder = entries.some((e) => index.hasFolders(e.repo));
      const [earlier, folders] = await Promise.all([
        fps.length
          ? events()
              .find(
                {
                  "scope.user": first.scope.user,
                  sessionID: first.sessionID,
                  kind: "tool",
                  "payload.command.fp": { $in: fps },
                },
                { projection: { id: 1, ts: 1, "payload.command.fp": 1 } },
              )
              .toArray()
          : Promise.resolve([]),
        needsFolder
          ? events()
              .find({ "scope.user": first.scope.user, sessionID: first.sessionID, kind: "session" })
              .sort({ ts: 1 })
              .toArray()
          : Promise.resolve([]),
      ]);
      for (const { event, run, repo } of entries) {
        const rerun =
          run.fp !== "" &&
          earlier.some(
            (other) =>
              other.id !== event.id &&
              (other.payload.command as { fp?: string } | undefined)?.fp === run.fp &&
              byTime(other as EventDoc, event) < 0,
          );
        const folder = folders.filter((f) => f.ts <= event.ts).reduce<string>((path, f) => folderOf(f) ?? path, "");
        rows.add(event, run, repo, index.resolve(repo, folder), rerun);
      }
    }),
  );
  return { counted: await rows.write() };
}

// Counts every stored tool event not counted yet, session by session, in order, so re-runs are found exactly. Leaves
// the last few minutes' events to ingest, which is counting them as they arrive. Idempotent.
export async function backfillSignals({ settleMs = 5 * 60_000 } = {}): Promise<{ counted: number; sessions: number }> {
  const before = new Date(Date.now() - settleMs);
  await ensureProducts();
  const index: ProductIndex = await productIndex();
  const rows = new Rows();
  let counted = 0;
  let sessions = 0;

  const flushSession = async (buffer: EventDoc[]) => {
    if (!buffer.length) return;
    sessions++;
    const seen = new Set<string>();
    let folder = "";
    for (const event of buffer.sort(byTime)) {
      folder = folderOf(event) ?? folder;
      const run = commandOf(event);
      const repo = normalizeRepo(event.scope.project);
      if (!run || !repo) continue;
      const rerun = run.fp !== "" && seen.has(run.fp);
      if (run.fp) seen.add(run.fp);
      if (event.signaledAt || event.receivedAt >= before) continue;
      rows.add(event, run, repo, index.resolve(repo, folder), rerun);
    }
    if (rows.ids.length >= 2000) counted += await rows.write();
  };

  const cursor = events()
    .find({ kind: { $in: ["tool", "session"] } })
    .sort({ "scope.user": 1, sessionID: 1, ts: 1 });
  let buffer: EventDoc[] = [];
  let current = "";
  for await (const event of cursor) {
    const key = sessionKey(event);
    if (key !== current) {
      await flushSession(buffer);
      buffer = [];
      current = key;
    }
    buffer.push(event);
  }
  await flushSession(buffer);
  counted += await rows.write();
  return { counted, sessions };
}

export interface TimeItem {
  // For timeTrend.
  key: string;
  productId: string | null;
  repo: string;
  class: string;
  // The command's fingerprint: the command itself never reaches the server.
  fp: string;
  runs: number;
  failures: number;
  reruns: number;
  totalMs: number;
  // The typical run, successful or not.
  medianMs: number;
  lost: Lost;
  hours: number;
  firstDay: string;
  lastDay: string;
}

export interface TimeLost {
  items: TimeItem[];
  totalHours: number;
}

const rowCounters = (row: SignalDailyDoc): SignalCounters =>
  mergeCounters(emptyCounters(), { ...row, hist: row.hist ?? {}, okHist: row.okHist ?? {} });

// Whole UTC days, from since's day through until's.
const dayRange = (since: Date, until: Date) => ({ $gte: dayKey(since), $lte: dayKey(until) });

// Rows people may see: products with approved work, live after merges.
async function visibleRows(
  filter: Record<string, unknown>,
  productId?: string,
): Promise<{ rows: SignalDailyDoc[]; index: ProductIndex }> {
  const [index, shared] = await Promise.all([productIndex(), sharedRepos()]);
  const query: Record<string, unknown> = { ...filter };
  if (productId) {
    const ids = index.aliases(productId);
    if (!ids.length) return { rows: [], index };
    query.productId = { $in: ids };
  }
  const rows = await signalDaily().find(query).limit(50_000).toArray();
  return {
    rows: rows.filter((row) => row.productId !== null && index.live(row.productId) && shared.has(row.repo)),
    index,
  };
}

// Hours lost in a range, by item (a command in a repository), the most first. Commands of class other have no
// fingerprint and aren't items; neither is anything that lost no time.
export async function timeLost(
  query: { productId?: string; since: Date; until: Date },
  viewer: ViewerRef,
): Promise<TimeLost> {
  if (!(await reader(viewer))) return { items: [], totalHours: 0 };
  const { rows, index } = await visibleRows(
    { day: dayRange(query.since, query.until), fp: { $ne: "" } },
    query.productId,
  );
  const items = new Map<
    string,
    { row: SignalDailyDoc; productId: string | null; counters: SignalCounters; days: string[] }
  >();
  for (const row of rows) {
    const productId = row.productId ? (index.live(row.productId)?._id ?? null) : null;
    const key = `${row.item}\u001f${productId ?? ""}`;
    const entry = items.get(key) ?? { row, productId, counters: emptyCounters(), days: [] };
    mergeCounters(entry.counters, rowCounters(row));
    entry.days.push(row.day);
    items.set(key, entry);
  }
  const out: TimeItem[] = [...items.values()].map(({ row, productId, counters, days }) => {
    const lost = lostTime(counters);
    days.sort();
    return {
      key: row.item,
      productId,
      repo: row.repo,
      class: row.class,
      fp: row.fp,
      runs: counters.runs,
      failures: counters.failures,
      reruns: counters.reruns,
      totalMs: counters.totalMs,
      medianMs: Math.round(medianMs(counters.hist)),
      lost,
      hours: toHours(lost.totalMs),
      firstDay: days[0] ?? "",
      lastDay: days.at(-1) ?? "",
    };
  });
  const ranked = out.filter((item) => item.lost.totalMs > 0).sort((a, b) => b.lost.totalMs - a.lost.totalMs);
  return { items: ranked, totalHours: toHours(ranked.reduce((sum, item) => sum + item.lost.totalMs, 0)) };
}

export interface TrendWeek {
  // Monday, 00:00 UTC.
  weekStart: Date;
  runs: number;
  failures: number;
  reruns: number;
  totalMs: number;
  lost: Lost;
  hours: number;
}

// One item's weeks, oldest first, every week in the range (an empty one is zeros), its slowness measured against
// the whole range's typical run so the weeks compare. Empty for an item people can't see.
export async function timeTrend(
  itemKey: string,
  query: { since: Date; until?: Date },
  viewer: ViewerRef,
): Promise<TrendWeek[]> {
  if (!(await reader(viewer))) return [];
  const until = query.until ?? new Date();
  const { rows } = await visibleRows({ item: itemKey, day: dayRange(query.since, until) });
  if (!rows.length) return [];
  const whole = rows.reduce((all, row) => mergeCounters(all, rowCounters(row)), emptyCounters());
  const typical = medianMs(whole.okHist);
  const weeks = new Map<number, SignalCounters>();
  for (let t = weekStart(query.since).getTime(); t <= until.getTime(); t += WEEK_MS) weeks.set(t, emptyCounters());
  for (const row of rows) {
    const t = weekStart(new Date(`${row.day}T00:00:00Z`)).getTime();
    weeks.set(t, mergeCounters(weeks.get(t) ?? emptyCounters(), rowCounters(row)));
  }
  return [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, counters]) => {
      const lost = lostTime(counters, typical);
      return {
        weekStart: new Date(t),
        runs: counters.runs,
        failures: counters.failures,
        reruns: counters.reruns,
        totalMs: counters.totalMs,
        lost,
        hours: toHours(lost.totalMs),
      };
    });
}
