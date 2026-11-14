// The page for where engineering time goes (/time): the hours lost in a range, by command and product, each command
// with its weekly trend, the pain points sessions shared about its product, and a ticket to fix it, ready to copy.
//
// It only composes the read models (timeLost, timeTrends, recordsFor, listProducts), always as the viewer, so their
// rules hold here too: only products with approved work, no person anywhere in a figure, nothing for a suspended
// viewer. The formatting is pure and exported, so the tests can pin it down without a database. Everything the page
// gets back is plain data: strings and numbers, no Date or ObjectId.
import { config } from "../config.ts";
import { getProduct, listProducts } from "./products.ts";
import type { ViewerRef } from "./reader.ts";
import { type TimeItem, timeLost, timeTrends } from "./signals.ts";
import { recordsFor, type TeamRecord } from "./team-records.ts";
import { DAY_MS, normalizeText } from "./text.ts";
import { HOUR_MS, type Lost } from "./time-math.ts";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeDays = 30;
// How many commands get a row, a trend and their pain points. The rest still count in the total.
export const SHOWN_ITEMS = 20;
const PAIN_POINTS_PER_ITEM = 4;
// How many of a product's latest pain points are read to pick each command's from.
const PAIN_POINTS_READ = 50;

export interface TimeFilters {
  days: RangeDays;
  productId: string | null;
}

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
// A product's id is a slug (products.ts): anything else can't be one, and isn't looked up.
const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

// The filters from the address: ?range=7|30|90 (30 when it's missing or anything else) and ?product=<id>.
export function parseTimeFilters(params: Params): TimeFilters {
  const range = Number(one(params.range));
  const days = (RANGES as readonly number[]).includes(range) ? (range as RangeDays) : DEFAULT_RANGE;
  const product = one(params.product)?.trim() ?? "";
  return { days, productId: PRODUCT_ID.test(product) ? product : null };
}

// The page's address for some filters, leaving out the defaults.
export function timeHref(filters: TimeFilters): string {
  const params = new URLSearchParams();
  if (filters.productId) params.set("product", filters.productId);
  if (filters.days !== DEFAULT_RANGE) params.set("range", String(filters.days));
  const query = params.toString();
  return query ? `/time?${query}` : "/time";
}

// Time lost, as people read it: 12.4 h, 42 min, under 1 min.
export function formatLost(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 60) {
    const hours = ms / HOUR_MS;
    return hours >= 100 ? `${Math.round(hours).toLocaleString("en-GB")} h` : `${hours.toFixed(1)} h`;
  }
  if (minutes >= 1) return `${minutes} min`;
  return ms > 0 ? "under 1 min" : "none";
}

// How long one run takes: 420 ms, 2.4 s, 38 s, 3 min 20 s, 1 h 5 min.
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 9.95) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const restSeconds = whole % 60;
  if (minutes < 60) return restSeconds ? `${minutes} min ${restSeconds} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
}

// A day as the page writes it, in UTC like signal_daily: 3 Nov, or 3 Nov 2026.
export function formatDay(at: Date | string, withYear = false): string {
  const date = typeof at === "string" ? new Date(at.length === 10 ? `${at}T00:00:00Z` : at) : at;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

const CLASS_NOUNS: Record<string, string> = {
  test: "test runs",
  build: "builds",
  typecheck: "type checks",
  lint: "lint runs",
  format: "format runs",
  install: "installs",
  git: "git commands",
};

// What a command class's runs are called in a sentence: "time lost to type checks".
export const classNoun = (cls: string): string => CLASS_NOUNS[cls] ?? `${cls} commands`;

// The words that tie a pain point to a kind of command. Matched on normalized text (text.ts), whole words only.
const CLASS_WORDS: Record<string, string[]> = {
  test: ["test", "tests", "testing", "spec", "specs", "vitest", "jest", "pytest", "flaky", "e2e"],
  build: [
    "build",
    "builds",
    "building",
    "compile",
    "compiling",
    "bundle",
    "bundler",
    "webpack",
    "esbuild",
    "turbopack",
  ],
  typecheck: ["typecheck", "type check", "type checks", "type error", "type errors", "tsc", "typescript", "mypy"],
  lint: ["lint", "linter", "linting", "eslint", "biome"],
  format: ["format", "formatter", "formatting", "prettier", "biome"],
  install: ["install", "installs", "dependency", "dependencies", "pnpm", "npm", "yarn", "lockfile", "node modules"],
  git: ["git", "merge", "rebase", "conflict", "conflicts", "commit", "branch"],
};

// Whether a pain point talks about this kind of command.
export function mentionsClass(text: string, cls: string): boolean {
  const words = ` ${normalizeText(text)} `;
  return (CLASS_WORDS[cls] ?? [cls]).some((word) => words.includes(` ${word} `));
}

export interface PainPoint {
  id: string;
  text: string;
  sessionId: string;
  // ISO time it was shared.
  at: string;
  // It talks about this kind of command (so it's listed first).
  mentions: boolean;
}

// A command's pain points, from its product's: those about this kind of command first, then those from its own
// repository, then the newest.
export function painPointsFor(
  records: Pick<TeamRecord, "id" | "text" | "sessionId" | "at" | "repo">[],
  item: { class: string; repo: string },
  limit = PAIN_POINTS_PER_ITEM,
): PainPoint[] {
  return records
    .map((record) => ({ record, mentions: mentionsClass(record.text, item.class), here: record.repo === item.repo }))
    .sort(
      (a, b) =>
        Number(b.mentions) - Number(a.mentions) ||
        Number(b.here) - Number(a.here) ||
        b.record.at.getTime() - a.record.at.getTime(),
    )
    .slice(0, limit)
    .map(({ record, mentions }) => ({
      id: record.id,
      text: record.text,
      sessionId: record.sessionId,
      at: record.at.toISOString(),
      mentions,
    }));
}

export interface TrendPoint {
  // Monday, as an ISO time.
  weekStart: string;
  lostMs: number;
  runs: number;
  failures: number;
  reruns: number;
}

export interface TicketInput {
  class: string;
  repo: string;
  fp: string;
  productId: string | null;
  productName: string | null;
  runs: number;
  failures: number;
  reruns: number;
  medianMs: number;
  lost: Lost;
  trend: TrendPoint[];
  painPoints: PainPoint[];
  days: RangeDays;
  since: Date;
  until: Date;
  // Where the app is reached, for the links in the ticket.
  baseURL: string;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;

// A ticket for fixing one command's lost time, in Markdown: its title, the hours, runs and failures, the weekly
// trend and what sessions said, with links back.
export function ticketMarkdown(t: TicketInput): string {
  const base = t.baseURL.replace(/\/+$/, "");
  const where = t.productName ?? t.repo;
  const lines = [
    `## Cut time lost to ${classNoun(t.class)} in ${where}`,
    "",
    `**${formatLost(t.lost.totalMs)} lost** to one ${t.class} command (fingerprint \`${t.fp.slice(0, 12)}\`) in ` +
      `${t.repo} over the last ${t.days} days (${formatDay(t.since)} to ${formatDay(t.until, true)}).`,
    "",
    `- Runs: ${t.runs.toLocaleString("en-GB")}, of which ${plural(t.failures, "failed", "failed")} and ` +
      `${plural(t.reruns, "re-run")}`,
    `- Where the time went: failed runs ${formatLost(t.lost.failedMs)}, re-runs ${formatLost(t.lost.rerunMs)}, ` +
      `slow first runs ${formatLost(t.lost.slowMs)}`,
    `- Typical run: ${formatDuration(t.medianMs)}`,
  ];
  if (t.trend.length) {
    lines.push("", "### Time lost per week", "");
    for (const week of t.trend) lines.push(`- Week of ${formatDay(week.weekStart)}: ${formatLost(week.lostMs)}`);
  }
  if (t.painPoints.length) {
    lines.push("", "### What sessions said", "");
    for (const point of t.painPoints)
      lines.push(
        `- ${point.text.replace(/\s+/g, " ").trim()} ([session](${base}/sessions/${encodeURIComponent(point.sessionId)}))`,
      );
  }
  lines.push(
    "",
    `Measured by Strata on the command, never on people: ${base}${timeHref({ days: t.days, productId: t.productId })}`,
  );
  return lines.join("\n");
}

export interface TimeRow {
  // Unique on the page: the item, and its product.
  id: string;
  class: string;
  productId: string | null;
  productName: string | null;
  repo: string;
  fp: string;
  runs: number;
  failures: number;
  reruns: number;
  medianMs: number;
  lost: Lost;
  firstDay: string;
  lastDay: string;
  trend: TrendPoint[];
  painPoints: PainPoint[];
  ticket: string;
}

export interface TimePage {
  filters: TimeFilters;
  since: string;
  until: string;
  // The products the filter offers: those with approved work.
  products: { id: string; name: string }[];
  // The product the page is filtered to, after any merge.
  product: { id: string; name: string } | null;
  // The product asked for isn't listed (no such product, or no approved work yet), so every product is shown.
  missingProduct: boolean;
  // The product asked for was merged into this one: the page goes there.
  movedTo: string | null;
  // Every command's lost time added up, by where it went.
  lost: Lost;
  // How many commands lost time, and in how many repositories.
  commands: number;
  repos: number;
  // The commands that lost the most, the most first: SHOWN_ITEMS of them at most.
  rows: TimeRow[];
}

const noLoss = (): Lost => ({ failedMs: 0, rerunMs: 0, slowMs: 0, totalMs: 0 });

// Everything /time shows, read as the viewer.
export async function timePage(
  viewer: ViewerRef,
  filters: TimeFilters,
  options: { now?: Date; baseURL?: string } = {},
): Promise<TimePage> {
  const until = options.now ?? new Date();
  const since = new Date(until.getTime() - filters.days * DAY_MS);
  const [listed, asked] = await Promise.all([
    listProducts(viewer),
    filters.productId ? getProduct(filters.productId, viewer) : Promise.resolve(null),
  ]);
  const products = listed.map((p) => ({ id: p.id, name: p.name }));
  const page: TimePage = {
    filters: { days: filters.days, productId: asked?.id ?? null },
    since: since.toISOString(),
    until: until.toISOString(),
    products,
    product: asked ? { id: asked.id, name: asked.name } : null,
    missingProduct: Boolean(filters.productId && !asked),
    movedTo: asked && asked.id !== filters.productId ? asked.id : null,
    lost: noLoss(),
    commands: 0,
    repos: 0,
    rows: [],
  };
  if (page.movedTo) return page;

  const { items } = await timeLost({ productId: asked?.id, since, until }, viewer);
  for (const item of items) {
    page.lost.failedMs += item.lost.failedMs;
    page.lost.rerunMs += item.lost.rerunMs;
    page.lost.slowMs += item.lost.slowMs;
    page.lost.totalMs += item.lost.totalMs;
  }
  page.commands = items.length;
  page.repos = new Set(items.map((item) => item.repo)).size;

  const shown = items.slice(0, SHOWN_ITEMS);
  const productIds = [...new Set(shown.flatMap((item) => (item.productId ? [item.productId] : [])))];
  const [trends, painPoints] = await Promise.all([
    // Each command's trend in its own product: a monorepo split by folder runs the same command in several.
    timeTrends(shown, { since, until }, viewer),
    Promise.all(
      productIds.map(
        async (productId) =>
          [productId, await recordsFor({ productId, kind: "pain_point", limit: PAIN_POINTS_READ }, viewer)] as const,
      ),
    ).then((entries) => new Map(entries)),
  ]);
  const names = new Map(products.map((p) => [p.id, p.name]));
  const baseURL = options.baseURL ?? config().baseURL;

  page.rows = shown.map((item: TimeItem, i) => {
    const trend: TrendPoint[] = (trends[i] ?? []).map((week) => ({
      weekStart: week.weekStart.toISOString(),
      lostMs: week.lost.totalMs,
      runs: week.runs,
      failures: week.failures,
      reruns: week.reruns,
    }));
    const points = item.productId ? painPointsFor(painPoints.get(item.productId) ?? [], item) : [];
    const productName = item.productId ? (names.get(item.productId) ?? null) : null;
    return {
      id: `${item.key}-${item.productId ?? "none"}`,
      class: item.class,
      productId: item.productId,
      productName,
      repo: item.repo,
      fp: item.fp,
      runs: item.runs,
      failures: item.failures,
      reruns: item.reruns,
      medianMs: item.medianMs,
      lost: item.lost,
      firstDay: item.firstDay,
      lastDay: item.lastDay,
      trend,
      painPoints: points,
      ticket: ticketMarkdown({
        ...item,
        productName,
        trend,
        painPoints: points,
        days: filters.days,
        since,
        until,
        baseURL,
      }),
    };
  });
  return page;
}
