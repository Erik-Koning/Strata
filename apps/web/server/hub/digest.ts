// The weekly digest (/digest): one week of approved work, product by product (What's new and In progress), the hours
// lost to tools that week, and the gaps opened and resolved in it; and the same digest as an email, ready for a
// scheduled send later. Nothing sends it yet.
//
// A week runs Monday to Sunday in UTC, as everywhere else in the hub (text.ts's weekStart), which makes it an ISO week:
// ?week= takes the Monday (2026-11-09, or any day of that week) or the ISO week (2026-W46).
//
// It only composes the read models (recordsFor, timeLost, listGaps, listProducts), always as the viewer, so their rules
// hold here too: approved work only, never a draft, nothing for a suspended viewer. Counts here are of things
// (sessions, gaps, hours on tools), never of people; people appear by name only where the digest says who worked on a
// piece of work. Everything it returns is plain data: strings and numbers, no Date or ObjectId.
import type { Mail } from "../mail.ts";
import { type Gap, listGaps } from "./gaps.ts";
import {
  durationLabel,
  type RefLink,
  refLinks,
  type SessionWork,
  sessionsOfWeek,
  type WorkLine,
  type WorkView,
  weekLabel,
} from "./product-page.ts";
import { getProduct, listProducts } from "./products.ts";
import { reader, type ViewerRef } from "./reader.ts";
import { timeLost } from "./signals.ts";
import { recordsFor, type TeamRecord } from "./team-records.ts";
import { DAY_MS, dayKey, WEEK_MS, weekStart } from "./text.ts";

// What each product's part shows before it points to the product's page.
export const SESSIONS_SHOWN = 6;
export const WORK_SHOWN = 6;
const SESSIONS_PER_WORK = 3;
// The commands that lost the most, and the gaps of each list.
export const TIME_SHOWN = 5;
export const GAPS_SHOWN = 8;
// How many products one address can pick.
export const MAX_PICKED = 20;
// A week's approved work is read in one go; this is far more than a team shares in a week.
const RECORDS_READ = 1000;

// A product's id is a slug (products.ts): anything else can't be one, and isn't looked up.
const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

export interface DigestWeek {
  // Monday, 00:00 UTC.
  start: string;
  // The next Monday, 00:00 UTC: the week runs up to it.
  end: string;
  // The ?week= value: the Monday, 2026-11-09.
  key: string;
  // The ISO week, 2026-W46.
  isoWeek: string;
  // "This week", "Last week", "Week of 2 November".
  label: string;
  // "9 to 15 November 2026".
  range: string;
  // The week now is in: it isn't over, so its figures are so far.
  current: boolean;
  // 0 for this week, 1 for last week, and so on.
  weeksAgo: number;
  previous: string;
  next: string | null;
}

export interface DigestProduct {
  id: string;
  name: string;
  // What's new: the week's sessions, newest first, each with its summary and the findings shared with it.
  sessions: SessionWork[];
  moreSessions: number;
  // In progress: the week's work by ticket, else pull request, else session, with the questions it left open.
  work: WorkView[];
  moreWork: number;
}

export interface DigestTimeItem {
  key: string;
  class: string;
  fp: string;
  repo: string;
  productId: string | null;
  productName: string | null;
  lostMs: number;
  failedMs: number;
  rerunMs: number;
  slowMs: number;
}

export interface DigestGap {
  id: string;
  text: string;
  productId: string | null;
  productName: string | null;
  // Coding sessions it has come up in, and questions Ask Strata couldn't answer about it: never people.
  sessions: number;
  asked: number;
  owner: string | null;
  // When it was first seen (opened) or resolved, as the list says.
  at: string;
  resolution: { url: string | null; note: string } | null;
}

export interface Digest {
  week: DigestWeek;
  // The products the digest is limited to, after merges; [] for every product.
  picked: { id: string; name: string }[];
  // ?product= values that aren't a product people can see.
  unknown: string[];
  // The products with approved work this week, by name.
  products: DigestProduct[];
  time: { top: DigestTimeItem[]; totalMs: number; commands: number };
  gaps: { opened: DigestGap[]; resolved: DigestGap[]; moreOpened: number; moreResolved: number };
  // The digest's own address, for this week and these products: always with its week, so it stays this week's.
  href: string;
}

export interface DigestQuery {
  // Any moment in the week: the digest is of the Monday-to-Sunday (UTC) week it falls in.
  weekStart: Date;
  // Product ids (a merged product's old id works too); none for every product.
  productIds?: string[];
}

// The ISO week a Monday starts: the week holding the year's first Thursday is week 1.
export function isoWeekOf(at: Date): string {
  const monday = weekStart(at);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const first = weekStart(new Date(Date.UTC(year, 0, 4)));
  const week = Math.round((monday.getTime() - first.getTime()) / WEEK_MS) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

// The week ?week= asks for, as its Monday: a day (2026-11-11 is the week of Monday 9 November) or an ISO week
// (2026-W46). This week when it's missing, unreadable, or later than this week.
export function parseWeek(value: string | string[] | undefined, now = new Date()): Date {
  const raw = one(value);
  const thisWeek = weekStart(now);
  let start: Date | null = null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const iso = /^(\d{4})-?W(\d{1,2})$/i.exec(raw);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) start = weekStart(date);
  } else if (iso) {
    const year = Number(iso[1]);
    const week = Number(iso[2]);
    const monday = new Date(weekStart(new Date(Date.UTC(year, 0, 4))).getTime() + (week - 1) * WEEK_MS);
    if (week >= 1 && isoWeekOf(monday) === `${year}-W${String(week).padStart(2, "0")}`) start = monday;
  }
  if (!start || start.getTime() > thisWeek.getTime() || start.getUTCFullYear() < 2000) return thisWeek;
  return start;
}

// ?product=, as many as given, each once.
export function parseProducts(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, MAX_PICKED);
}

const dateText = (at: Date, options: Intl.DateTimeFormatOptions): string =>
  at.toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });

// "9 to 15 November 2026", "27 October to 2 November 2026", "29 December 2025 to 4 January 2026".
export function rangeLabel(start: Date): string {
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const full = dateText(end, { day: "numeric", month: "long", year: "numeric" });
  if (start.getUTCFullYear() !== end.getUTCFullYear())
    return `${dateText(start, { day: "numeric", month: "long", year: "numeric" })} to ${full}`;
  if (start.getUTCMonth() !== end.getUTCMonth())
    return `${dateText(start, { day: "numeric", month: "long" })} to ${full}`;
  return `${start.getUTCDate()} to ${full}`;
}

// A day in the week, as a digest says it: "Tue 10 Nov".
export const dayLabel = (iso: string): string =>
  dateText(new Date(iso), { weekday: "short", day: "numeric", month: "short" });

export function digestWeek(at: Date, now = new Date()): DigestWeek {
  const start = weekStart(at);
  const thisWeek = weekStart(now).getTime();
  const current = start.getTime() >= thisWeek;
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + WEEK_MS).toISOString(),
    key: dayKey(start),
    isoWeek: isoWeekOf(start),
    label: weekLabel(start, now),
    range: rangeLabel(start),
    current,
    weeksAgo: Math.max(0, Math.round((thisWeek - start.getTime()) / WEEK_MS)),
    previous: dayKey(new Date(start.getTime() - WEEK_MS)),
    next: current ? null : dayKey(new Date(start.getTime() + WEEK_MS)),
  };
}

// The digest's address: a week (none for this week) and the products picked (none for every product).
export function digestHref({ week, productIds = [] }: { week?: string | null; productIds?: string[] }): string {
  const params = new URLSearchParams();
  if (week) params.set("week", week);
  for (const id of productIds) params.append("product", id);
  const query = params.toString();
  return query ? `/digest?${query}` : "/digest";
}

const openLine = (record: TeamRecord): WorkLine => ({
  id: record.id,
  kind: record.kind,
  kindLabel: "Open question",
  title: record.title,
  text: record.text,
  refs: refLinks(record.refs),
  sessionId: record.sessionId,
  at: record.at.toISOString(),
});

// In progress for a week: its work grouped by ticket, else pull request, else session, as the product page groups it
// (team-records.ts's inProgress, which reads up to now and so can't be cut to a past week), the latest first, with the
// questions it left open and who worked on it, by name, alphabetically.
export function workOfWeek(records: TeamRecord[]): WorkView[] {
  const sessions = new Map<string, TeamRecord[]>();
  for (const record of records) sessions.set(record.sessionId, [...(sessions.get(record.sessionId) ?? []), record]);

  const groups = new Map<string, { kind: WorkView["kind"]; key: string; items: TeamRecord[]; sessionIds: string[] }>();
  for (const [sessionId, items] of sessions) {
    const refs = items.flatMap((r) => r.refs);
    const ticket = refs.find((r) => r.type === "ticket");
    const pr = refs.find((r) => r.type === "pr");
    const [kind, key]: [WorkView["kind"], string] = ticket
      ? ["ticket", ticket.id]
      : pr
        ? ["pr", typeof pr.url === "string" ? pr.url : pr.id]
        : ["session", sessionId];
    const id = `${kind}:${key}`;
    const group = groups.get(id) ?? { kind, key, items: [], sessionIds: [] };
    group.items.push(...items);
    group.sessionIds.push(sessionId);
    groups.set(id, group);
  }

  return [...groups.entries()]
    .map(([id, group]): WorkView => {
      const newest = [...group.items].sort((a, b) => b.at.getTime() - a.at.getTime());
      const first = newest[0];
      const summary = newest.find((r) => r.kind === "summary" && r.title);
      const people = new Map(newest.flatMap((r) => (r.author ? [[r.author.id, r.author.name] as const] : [])));
      const sessionIds = [...new Set(newest.map((r) => r.sessionId))];
      return {
        key: id,
        kind: group.kind,
        title:
          summary?.title ??
          (group.kind === "ticket" ? group.key : (first?.title ?? first?.text.slice(0, 100) ?? group.key)),
        refs: refLinks(newest.flatMap((r) => r.refs)),
        sessionIds: sessionIds.slice(0, SESSIONS_PER_WORK),
        moreSessions: Math.max(0, sessionIds.length - SESSIONS_PER_WORK),
        people: [...people.values()].sort((a, b) => a.localeCompare(b)),
        lastAt: first?.at.toISOString() ?? "",
        open: newest.filter((r) => r.kind === "open").map(openLine),
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

const isDate = (value: unknown): value is Date => value instanceof Date && !Number.isNaN(value.getTime());

function gapView(gap: Gap, at: Date, names: Map<string, string>): DigestGap {
  const productName = gap.productId ? (names.get(gap.productId) ?? null) : null;
  return {
    id: gap.id,
    text: gap.text,
    productId: productName ? gap.productId : null,
    productName,
    sessions: gap.sessions,
    asked: gap.fromPeople,
    owner: gap.owner?.name ?? null,
    at: at.toISOString(),
    resolution: gap.resolution ? { url: gap.resolution.url, note: gap.resolution.note } : null,
  };
}

// One week's digest, for the viewer: empty (but for its week) for a viewer who may read nothing.
export async function buildDigest(query: DigestQuery, viewer: ViewerRef, now = new Date()): Promise<Digest> {
  const start = weekStart(query.weekStart);
  const end = new Date(start.getTime() + WEEK_MS);
  const week = digestWeek(start, now);
  const requested = parseProducts(query.productIds);
  const digest: Digest = {
    week,
    picked: [],
    unknown: [],
    products: [],
    time: { top: [], totalMs: 0, commands: 0 },
    gaps: { opened: [], resolved: [], moreOpened: 0, moreResolved: 0 },
    href: digestHref({ week: week.key }),
  };
  if (!(await reader(viewer))) return { ...digest, unknown: requested };

  const [listed, found] = await Promise.all([
    listProducts(viewer),
    Promise.all(requested.map((id) => (PRODUCT_ID.test(id) ? getProduct(id, viewer) : null))),
  ]);
  const names = new Map(listed.map((p) => [p.id, p.name]));
  const picked = new Map<string, string>();
  for (const product of found) if (product) picked.set(product.id, product.name);
  digest.picked = [...picked.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  digest.unknown = requested.filter((_, i) => !found[i]);
  digest.href = digestHref({ week: week.key, productIds: digest.picked.map((p) => p.id) });
  // Only products people can see, and of those the ones picked (every one when none of the picks is a product).
  const shown = (productId: string | null): productId is string =>
    productId !== null && names.has(productId) && (!picked.size || picked.has(productId));

  const [records, time, gaps] = await Promise.all([
    recordsFor({ since: start, until: end, limit: RECORDS_READ }, viewer),
    // Whole UTC days: Monday through Sunday.
    timeLost({ since: start, until: new Date(end.getTime() - 1) }, viewer),
    listGaps({}, viewer),
  ]);

  const byProduct = new Map<string, TeamRecord[]>();
  for (const record of records)
    if (shown(record.productId)) byProduct.set(record.productId, [...(byProduct.get(record.productId) ?? []), record]);
  digest.products = [...byProduct.entries()]
    .map(([id, items]): DigestProduct => {
      const shared = items.filter((r) => r.kind !== "open");
      const sessions = sessionsOfWeek(
        shared.filter((r) => r.kind === "summary"),
        shared.filter((r) => r.kind !== "summary"),
      );
      const work = workOfWeek(items);
      return {
        id,
        name: names.get(id) ?? id,
        sessions: sessions.slice(0, SESSIONS_SHOWN),
        moreSessions: Math.max(0, sessions.length - SESSIONS_SHOWN),
        work: work.slice(0, WORK_SHOWN),
        moreWork: Math.max(0, work.length - WORK_SHOWN),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const items = time.items.filter((item) => shown(item.productId));
  digest.time = {
    top: items.slice(0, TIME_SHOWN).map((item) => ({
      key: item.key,
      class: item.class,
      fp: item.fp,
      repo: item.repo,
      productId: item.productId,
      productName: item.productId ? (names.get(item.productId) ?? null) : null,
      lostMs: item.lost.totalMs,
      failedMs: item.lost.failedMs,
      rerunMs: item.lost.rerunMs,
      slowMs: item.lost.slowMs,
    })),
    totalMs: items.reduce((sum, item) => sum + item.lost.totalMs, 0),
    commands: items.length,
  };

  // Gaps are listed whatever their product's state, as on the gaps page; a pick keeps those of the products picked.
  const scoped = picked.size ? gaps.filter((g) => g.productId !== null && picked.has(g.productId)) : gaps;
  const inWeek = (at: unknown): at is Date => isDate(at) && at >= start && at < end;
  const opened = scoped.filter((g) => inWeek(g.firstSeen)).map((g) => gapView(g, g.firstSeen, names));
  const resolved = scoped.flatMap((g) =>
    g.status === "resolved" && g.resolution && inWeek(g.resolution.at) ? [gapView(g, g.resolution.at, names)] : [],
  );
  resolved.sort((a, b) => b.at.localeCompare(a.at));
  digest.gaps = {
    opened: opened.slice(0, GAPS_SHOWN),
    resolved: resolved.slice(0, GAPS_SHOWN),
    moreOpened: Math.max(0, opened.length - GAPS_SHOWN),
    moreResolved: Math.max(0, resolved.length - GAPS_SHOWN),
  };
  return digest;
}

// How many things, in words: "1 session", "3 sessions".
const count = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

// "billing", "billing and shop", "billing, shop and search", else "4 products".
function productList(names: string[]): string {
  if (names.length > 3) return count(names.length, "product");
  return new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" }).format(names);
}

// What the digest holds, in one line: "3 sessions in 2 products, 4.5 h lost to tools, 1 gap opened and 1 resolved".
export function digestSummary(digest: Digest): string {
  const sessions = digest.products.reduce((sum, p) => sum + p.sessions.length + p.moreSessions, 0);
  const gaps = digest.gaps.opened.length + digest.gaps.moreOpened;
  const answered = digest.gaps.resolved.length + digest.gaps.moreResolved;
  const gapPart =
    gaps && answered
      ? `${count(gaps, "gap")} opened and ${answered.toLocaleString("en-GB")} resolved`
      : gaps
        ? `${count(gaps, "gap")} opened`
        : answered
          ? `${count(answered, "gap")} resolved`
          : "no gaps opened or resolved";
  return [
    sessions
      ? `${count(sessions, "session")} shared in ${count(digest.products.length, "product")}`
      : "No sessions shared",
    digest.time.totalMs > 0 ? `${durationLabel(digest.time.totalMs)} lost to tools` : "no time lost to tools",
    gapPart,
  ].join(", ");
}

// The email, with the subject, a whole text part and an HTML part that says the same (mail.ts).
export type DigestEmail = Required<Omit<Mail, "to">>;

// The address everything links from: an absolute http(s) address, without a trailing slash.
function absoluteBase(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`The digest needs the app's absolute address, not "${baseUrl}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(`The digest needs an http or https address, not "${baseUrl}"`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const names = (people: string[]): string =>
  new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" }).format(people);

const lostParts = (t: { failedMs: number; rerunMs: number; slowMs: number }): string =>
  [
    t.failedMs ? `failed ${durationLabel(t.failedMs)}` : null,
    t.rerunMs ? `re-runs ${durationLabel(t.rerunMs)}` : null,
    t.slowMs ? `slow ${durationLabel(t.slowMs)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

// One piece of the email, written once and rendered twice: as text and as HTML.
type Inline = string | { text: string; href: string | null };
type Block =
  | { kind: "h1" | "h2" | "h3" | "p" | "muted"; parts: Inline[] }
  | { kind: "list"; items: { parts: Inline[]; sub: Inline[][] }[] };

const refInline = (ref: RefLink): Inline => ({ text: ref.label, href: ref.url });

function joinInline(groups: Inline[][], separator: string): Inline[] {
  return groups.flatMap((group, i) => (i ? [separator, ...group] : group));
}

// The digest as blocks of the email, every link absolute.
function emailBlocks(digest: Digest, base: string): Block[] {
  const link = (path: string) => `${base}${path}`;
  const session = (id: string): Inline => ({
    text: `session ${id.slice(0, 8)}`,
    href: link(`/sessions/${encodeURIComponent(id)}`),
  });
  const blocks: Block[] = [
    { kind: "h1", parts: [`Weekly digest: ${digest.week.range}`] },
    {
      kind: "muted",
      parts: [
        `Week ${Number(digest.week.isoWeek.slice(6))} of ${digest.week.isoWeek.slice(0, 4)}, Monday to Sunday (UTC)`,
        digest.week.current ? ", so far. " : ". ",
        digest.picked.length ? `For ${productList(digest.picked.map((p) => p.name))}. ` : "Every product. ",
        "Only work its authors approved.",
      ],
    },
    { kind: "p", parts: [`${digestSummary(digest)}.`] },
  ];

  if (!digest.products.length)
    blocks.push({
      kind: "p",
      parts: [
        digest.week.current
          ? "Nothing has been approved this week yet. Summaries and findings show up here once their authors approve them."
          : "Nothing was approved this week.",
      ],
    });

  for (const product of digest.products) {
    const productHref = link(`/products/${encodeURIComponent(product.id)}`);
    blocks.push({ kind: "h2", parts: [{ text: product.name, href: productHref }] });
    if (product.sessions.length) {
      blocks.push({ kind: "h3", parts: ["What's new"] });
      blocks.push({
        kind: "list",
        items: product.sessions.map((s) => {
          const title = s.summary?.title ?? null;
          const body = s.summary ? oneLine(s.summary.text, 400) : "Findings from this session";
          const parts: Inline[] = title ? [`${oneLine(title, 160)}: ${body}`] : [body];
          const sub: Inline[][] = s.findings.map((f) => [`${f.kindLabel}: ${oneLine(f.text, 240)}`]);
          if (s.moreFindings) sub.push([`${count(s.moreFindings, "more finding")} on the session's page`]);
          sub.push(joinInline([...s.refs.map((r) => [refInline(r)]), [session(s.sessionId)]], ", "));
          return { parts, sub };
        }),
      });
      if (product.moreSessions)
        blocks.push({
          kind: "muted",
          parts: [
            `${count(product.moreSessions, "more session")}: `,
            { text: `${product.name} in Strata`, href: productHref },
          ],
        });
    }
    if (product.work.length) {
      blocks.push({ kind: "h3", parts: ["In progress"] });
      blocks.push({
        kind: "list",
        items: product.work.map((w) => {
          const sub: Inline[][] = w.open.map((q) => [`Open question: ${oneLine(q.text, 240)}`]);
          const links = [...w.refs.map((r) => [refInline(r)]), ...w.sessionIds.map((id) => [session(id)])];
          if (links.length) sub.push(joinInline(links, ", "));
          return {
            parts: [`${oneLine(w.title, 160)}${w.people.length ? `, with ${names(w.people)}` : ""}`],
            sub,
          };
        }),
      });
      if (product.moreWork)
        blocks.push({
          kind: "muted",
          parts: [
            `${count(product.moreWork, "more piece")} of work: `,
            { text: `${product.name} in Strata`, href: productHref },
          ],
        });
    }
  }

  blocks.push({ kind: "h2", parts: ["Time lost on tools"] });
  if (digest.time.top.length) {
    blocks.push({
      kind: "p",
      parts: [
        `${durationLabel(digest.time.totalMs)} lost to failed runs, re-runs and slow runs${digest.week.current ? " so far" : ""}. The biggest:`,
      ],
    });
    blocks.push({
      kind: "list",
      items: digest.time.top.map((t) => ({
        parts: [
          `${t.class} ${t.fp.slice(0, 8)}${t.productName ? ` in ${t.productName}` : ""}: ${durationLabel(t.lostMs)} (${lostParts(t)})`,
        ],
        sub: [],
      })),
    });
  } else blocks.push({ kind: "p", parts: ["No time lost to tools this week."] });
  blocks.push({ kind: "muted", parts: [{ text: "Where engineering time goes", href: link("/time") }] });

  blocks.push({ kind: "h2", parts: ["Context gaps"] });
  const gapItem = (g: DigestGap, resolved: boolean) => {
    const about = [
      g.productName,
      g.sessions ? `came up in ${count(g.sessions, "session")}` : null,
      g.asked ? "asked in Ask Strata" : null,
      g.owner ? `${g.owner} is on it` : null,
    ].filter(Boolean);
    const sub: Inline[][] = [];
    if (resolved && g.resolution?.url) sub.push(["Answered by ", { text: g.resolution.url, href: g.resolution.url }]);
    else if (resolved && g.resolution?.note) sub.push([`Answer: ${oneLine(g.resolution.note, 240)}`]);
    sub.push([{ text: "The gap in Strata", href: link(`/gaps/${encodeURIComponent(g.id)}`) }]);
    return { parts: [`${oneLine(g.text, 240)}${about.length ? ` (${about.join(", ")})` : ""}`], sub };
  };
  if (digest.gaps.opened.length) {
    blocks.push({ kind: "h3", parts: ["Opened this week"] });
    blocks.push({ kind: "list", items: digest.gaps.opened.map((g) => gapItem(g, false)) });
    if (digest.gaps.moreOpened)
      blocks.push({ kind: "muted", parts: [`And ${count(digest.gaps.moreOpened, "more")}.`] });
  }
  if (digest.gaps.resolved.length) {
    blocks.push({ kind: "h3", parts: ["Resolved this week"] });
    blocks.push({ kind: "list", items: digest.gaps.resolved.map((g) => gapItem(g, true)) });
    if (digest.gaps.moreResolved)
      blocks.push({ kind: "muted", parts: [`And ${count(digest.gaps.moreResolved, "more")}.`] });
  }
  if (!digest.gaps.opened.length && !digest.gaps.resolved.length)
    blocks.push({ kind: "p", parts: ["No gap was opened or resolved this week."] });
  blocks.push({ kind: "muted", parts: [{ text: "Every open gap", href: link("/gaps") }] });

  blocks.push({
    kind: "muted",
    parts: ["Open this digest in Strata: ", { text: link(digest.href), href: link(digest.href) }],
  });
  return blocks;
}

const inlineText = (parts: Inline[]): string =>
  parts
    .map((p) => (typeof p === "string" ? p : p.href && p.href !== p.text ? `${p.text} (${p.href})` : p.text))
    .join("");

function textOf(blocks: Block[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === "list") {
      for (const item of block.items) {
        out.push(`- ${inlineText(item.parts)}`);
        for (const sub of item.sub) out.push(`  ${inlineText(sub)}`);
      }
      out.push("");
      continue;
    }
    const line = inlineText(block.parts);
    if (block.kind === "h1") out.push(line, "=".repeat(Math.min(line.length, 72)), "");
    else if (block.kind === "h2") out.push("", line, "-".repeat(Math.min(line.length, 72)), "");
    else if (block.kind === "h3") out.push(`${line}:`, "");
    else out.push(line, "");
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

// Email clients ignore stylesheets, so the HTML part is styled inline, in the app's light colours.
const STYLE = {
  body: "margin:0;padding:24px 16px;background:#eeebf7;color:#15121f;font:15px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  wrap: "max-width:640px;margin:0 auto;background:#f6f4fc;border-radius:16px;padding:24px",
  h1: "margin:0 0 6px;font-size:22px;line-height:1.3",
  h2: "margin:28px 0 8px;padding-top:16px;border-top:1px solid #dcd6ec;font-size:17px",
  h3: "margin:16px 0 6px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5e5a76",
  p: "margin:0 0 10px",
  muted: "margin:0 0 10px;font-size:13px;color:#5e5a76",
  ul: "margin:0 0 12px;padding-left:20px",
  li: "margin:0 0 10px",
  sub: "margin:2px 0 0;font-size:13.5px;color:#3b3750",
  a: "color:#5b21b6",
} as const;

const inlineHtml = (parts: Inline[]): string =>
  parts
    .map((p) =>
      typeof p === "string"
        ? escapeHtml(p)
        : p.href
          ? `<a href="${escapeHtml(p.href)}" style="${STYLE.a}">${escapeHtml(p.text)}</a>`
          : escapeHtml(p.text),
    )
    .join("");

function htmlOf(blocks: Block[], subject: string): string {
  const body = blocks
    .map((block) => {
      if (block.kind === "list")
        return `<ul style="${STYLE.ul}">${block.items
          .map(
            (item) =>
              `<li style="${STYLE.li}">${inlineHtml(item.parts)}${item.sub
                .map((sub) => `<div style="${STYLE.sub}">${inlineHtml(sub)}</div>`)
                .join("")}</li>`,
          )
          .join("")}</ul>`;
      const tag = block.kind === "muted" ? "p" : block.kind;
      return `<${tag} style="${STYLE[block.kind]}">${inlineHtml(block.parts)}</${tag}>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="${STYLE.body}">
<div style="${STYLE.wrap}">
${body}
</div>
</body>
</html>
`;
}

// The digest as an email: a subject, a whole text part and an HTML part saying the same, every link absolute from
// baseUrl (the app's address). Ready for a scheduled send; nothing here sends it.
export function renderDigestEmail(digest: Digest, { baseUrl }: { baseUrl: string }): DigestEmail {
  const base = absoluteBase(baseUrl);
  const scope = digest.picked.length ? ` for ${productList(digest.picked.map((p) => p.name))}` : "";
  const subject = `Strata weekly digest${scope}: ${digest.week.range}`;
  const blocks = emailBlocks(digest, base);
  return { subject, text: textOf(blocks), html: htmlOf(blocks, subject) };
}
