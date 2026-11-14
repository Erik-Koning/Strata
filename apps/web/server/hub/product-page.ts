// The products pages, put together from the hub's read models: the list (each product with its latest work, its open
// gaps and the time lost on its tools) and one product's page (What's new by week, In progress, and a side column of
// time lost, open gaps, code areas and who has worked on them). The modules it reads check the viewer; this shapes
// what they return for the page, every date as an ISO string so any of it can go to a client component as it is.
//
// Counts here are of things (sessions, gaps, findings, hours on tools), never of people. People appear only by name,
// in alphabetical order, with nothing that says how much or when each of them worked.
import type { Ref } from "@strata/contracts";
import { listGaps } from "./gaps.ts";
import { getProduct, listProducts, type Product } from "./products.ts";
import { reader, type ViewerRef } from "./reader.ts";
import { timeLost } from "./signals.ts";
import {
  contributorsFor,
  inProgress,
  recordsFor,
  type TeamRecord,
  type TeamRecordKind,
  type WorkInProgress,
  whatsNew,
} from "./team-records.ts";
import { DAY_MS, WEEK_MS, weekStart } from "./text.ts";
import { HOUR_MS } from "./time-math.ts";

// How far back each part of the pages looks.
export const WHATS_NEW_WEEKS = 6;
export const TIME_DAYS = 30;
// What one product's page shows before it says there's more.
const FINDINGS_SHOWN = 4;
const WORK_SHOWN = 15;
const SESSIONS_SHOWN = 3;
const SIDE_SHOWN = 3;

// A ticket or a pull request, as a chip; a link only when it has a web address.
export interface RefLink {
  key: string;
  kind: "ticket" | "pr";
  label: string;
  url: string | null;
}

export interface RepoView {
  repo: string;
  // The folder of the repository this product covers; "" for all of it.
  path: string;
  url: string | null;
}

// One approved line: a session's summary, or one of its findings.
export interface WorkLine {
  id: string;
  kind: TeamRecordKind;
  kindLabel: string;
  title: string | null;
  text: string;
  refs: RefLink[];
  sessionId: string;
  at: string;
}

// A session's work in one week: its summary, and the findings shared with it.
export interface SessionWork {
  sessionId: string;
  at: string;
  summary: WorkLine | null;
  findings: WorkLine[];
  // Findings not shown here: they're on the session's page.
  moreFindings: number;
  refs: RefLink[];
}

export interface WeekView {
  weekStart: string;
  label: string;
  sessions: SessionWork[];
}

export interface WorkView {
  key: string;
  kind: WorkInProgress["kind"];
  title: string;
  refs: RefLink[];
  sessionIds: string[];
  moreSessions: number;
  // Who worked on it, by name, alphabetical.
  people: string[];
  lastAt: string;
  open: WorkLine[];
}

export interface TimeSink {
  key: string;
  class: string;
  fp: string;
  repo: string;
  runs: number;
  lostMs: number;
  failedMs: number;
  rerunMs: number;
  slowMs: number;
}

export interface GapLine {
  id: string;
  text: string;
  // Coding sessions it came up in, and questions Ask Strata couldn't answer about it.
  sessions: number;
  asked: number;
  owner: string | null;
  lastSeen: string | null;
}

export interface AreaView {
  area: string;
  people: string[];
}

export interface ProductCard {
  id: string;
  name: string;
  repos: RepoView[];
  // The summaries of its two latest sessions.
  latest: { title: string; at: string; sessionId: string }[];
  openGaps: number;
  // Lost on tools in the last TIME_DAYS days.
  lostMs: number;
}

export interface ProductPage {
  product: { id: string; name: string; repos: RepoView[] };
  weeks: WeekView[];
  work: WorkView[];
  moreWork: number;
  time: { top: TimeSink[]; totalMs: number };
  gaps: { top: GapLine[]; open: number };
  areas: AreaView[];
  // Who worked on the product recently, by name, alphabetical: shown when no summary names an area.
  people: string[];
  // Tickets and pull requests in its recent work, newest first.
  refs: RefLink[];
}

export type ProductPageResult =
  | { status: "missing" }
  | { status: "moved"; id: string }
  | { status: "ok"; page: ProductPage };

const KIND_LABELS: Record<TeamRecordKind, string> = {
  summary: "Summary",
  decision: "Decision",
  insight: "Insight",
  workflow: "Workflow",
  pain_point: "Pain point",
  context_gap: "Context gap",
  open: "Open question",
};

// The order a session's findings are listed in.
const FINDING_ORDER: TeamRecordKind[] = ["decision", "insight", "workflow", "pain_point", "context_gap", "open"];

// A web address that's safe to link to: http or https only, so a stored "javascript:" never becomes a link.
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const prLabel = (id: string, url: string | null): string => {
  if (/^\d+$/.test(id)) return `PR #${id}`;
  const number = url ? /\/(?:pull|pulls|merge_requests)\/(\d+)/.exec(url)?.[1] : undefined;
  return number ? `PR #${number}` : "Pull request";
};

// The tickets and pull requests among some refs, each once, in the order given.
export function refLinks(refs: readonly Ref[]): RefLink[] {
  const out = new Map<string, RefLink>();
  for (const ref of refs) {
    if (ref.type !== "ticket" && ref.type !== "pr") continue;
    const id = String(ref.id ?? "").trim();
    if (!id) continue;
    const url = webUrl(ref.url);
    if (ref.type === "ticket") {
      const key = `ticket:${id.toUpperCase()}`;
      if (!out.has(key)) out.set(key, { key, kind: "ticket", label: id, url });
      continue;
    }
    const key = `pr:${url ?? id}`;
    if (!out.has(key)) out.set(key, { key, kind: "pr", label: prLabel(id, url), url });
  }
  return [...out.values()];
}

// A repository's web page, for the hosts whose page is the repository's name: github.com/acme/app.
export function repoUrl(repo: string): string | null {
  const host = repo.split("/")[0] ?? "";
  return ["github.com", "gitlab.com", "bitbucket.org"].includes(host) ? `https://${repo}` : null;
}

const repoViews = (product: Product): RepoView[] =>
  product.repos.map((r) => ({ repo: r.repo, path: r.path, url: repoUrl(r.repo) }));

// How long, as people say it: "40 min", "2.5 h", "14 h".
export function durationLabel(ms: number): string {
  if (ms < 60_000) return ms > 0 ? "under a minute" : "none";
  if (ms < HOUR_MS) return `${Math.round(ms / 60_000)} min`;
  const hours = ms / HOUR_MS;
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} h`;
}

// A week's heading, from the Monday it starts on (UTC, as weeks are cut).
export function weekLabel(start: Date, now: Date): string {
  const thisWeek = weekStart(now).getTime();
  if (start.getTime() === thisWeek) return "This week";
  if (start.getTime() === thisWeek - WEEK_MS) return "Last week";
  return `Week of ${start.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}`;
}

const line = (record: TeamRecord): WorkLine => ({
  id: record.id,
  kind: record.kind,
  kindLabel: KIND_LABELS[record.kind] ?? record.kind,
  title: record.title,
  text: record.text,
  refs: refLinks(record.refs),
  sessionId: record.sessionId,
  at: record.at.toISOString(),
});

const byFindingOrder = (a: TeamRecord, b: TeamRecord): number =>
  FINDING_ORDER.indexOf(a.kind) - FINDING_ORDER.indexOf(b.kind) || b.at.getTime() - a.at.getTime();

// One week's summaries and findings, by session: the session's summary with what was shared alongside it, newest
// session first. Findings from a session whose summary isn't in this week stand as a session of their own.
export function sessionsOfWeek(summaries: TeamRecord[], findings: TeamRecord[]): SessionWork[] {
  const sessions = new Map<string, { summaries: TeamRecord[]; findings: TeamRecord[] }>();
  const entry = (id: string) => {
    const found = sessions.get(id) ?? { summaries: [], findings: [] };
    sessions.set(id, found);
    return found;
  };
  for (const record of summaries) entry(record.sessionId).summaries.push(record);
  for (const record of findings) entry(record.sessionId).findings.push(record);
  return [...sessions.entries()]
    .map(([sessionId, group]) => {
      const summary = [...group.summaries].sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
      const ordered = [...group.findings].sort(byFindingOrder);
      const all = [...group.summaries, ...group.findings];
      const at = new Date(Math.max(...all.map((r) => r.at.getTime())));
      return {
        sessionId,
        at: at.toISOString(),
        summary: summary ? line(summary) : null,
        findings: ordered.slice(0, FINDINGS_SHOWN).map(line),
        moreFindings: Math.max(0, ordered.length - FINDINGS_SHOWN),
        refs: refLinks((summary ? [summary] : all).flatMap((r) => r.refs)),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

const workView = (work: WorkInProgress): WorkView => ({
  key: `${work.kind}:${work.key}`,
  kind: work.kind,
  title: work.title,
  refs: refLinks([
    ...work.tickets.map((id): Ref => ({ type: "ticket", id })),
    ...(work.pr ? [{ type: "pr", id: work.pr.id, ...(work.pr.url ? { url: work.pr.url } : {}) } satisfies Ref] : []),
  ]),
  sessionIds: work.sessionIds.slice(0, SESSIONS_SHOWN),
  moreSessions: Math.max(0, work.sessionIds.length - SESSIONS_SHOWN),
  people: work.people.map((p) => p.name),
  lastAt: work.lastAt.toISOString(),
  open: work.open.map(line),
});

// Every product people can see, by name, with its two latest summaries, its open gaps and the time lost on its tools
// in the last TIME_DAYS days. Empty for a viewer who may read nothing.
export async function productCards(viewer: ViewerRef, now = new Date()): Promise<ProductCard[]> {
  if (!(await reader(viewer))) return [];
  const [list, summaries, gaps, time] = await Promise.all([
    listProducts(viewer),
    recordsFor({ kind: "summary", limit: 1000 }, viewer),
    listGaps({ status: "open" }, viewer),
    timeLost({ since: new Date(now.getTime() - TIME_DAYS * DAY_MS), until: now }, viewer),
  ]);
  // The newest summary of each of the two latest sessions (a session can have one in each store).
  const latest = new Map<string, { title: string; at: string; sessionId: string }[]>();
  for (const record of summaries) {
    if (!record.productId) continue;
    const shown = latest.get(record.productId) ?? [];
    if (shown.length >= 2 || shown.some((s) => s.sessionId === record.sessionId)) continue;
    shown.push({
      title: record.title ?? record.text.slice(0, 140),
      at: record.at.toISOString(),
      sessionId: record.sessionId,
    });
    latest.set(record.productId, shown);
  }
  const openGaps = new Map<string, number>();
  for (const gap of gaps) if (gap.productId) openGaps.set(gap.productId, (openGaps.get(gap.productId) ?? 0) + 1);
  const lost = new Map<string, number>();
  for (const item of time.items)
    if (item.productId) lost.set(item.productId, (lost.get(item.productId) ?? 0) + item.lost.totalMs);
  return list.map((product) => ({
    id: product.id,
    name: product.name,
    repos: repoViews(product),
    latest: latest.get(product.id) ?? [],
    openGaps: openGaps.get(product.id) ?? 0,
    lostMs: lost.get(product.id) ?? 0,
  }));
}

// One product's page. "moved" when the id was merged into another product (link there instead); "missing" when there's
// no such product, it has no approved work yet, or the viewer may read nothing.
export async function productPage(id: string, viewer: ViewerRef, now = new Date()): Promise<ProductPageResult> {
  const product = id ? await getProduct(id, viewer) : null;
  if (!product) return { status: "missing" };
  if (product.id !== id) return { status: "moved", id: product.id };

  const since = new Date(weekStart(now).getTime() - (WHATS_NEW_WEEKS - 1) * WEEK_MS);
  const [weeks, progress, time, gaps, contributors] = await Promise.all([
    whatsNew({ productId: product.id, since }, viewer),
    inProgress({ productId: product.id }, viewer),
    timeLost({ productId: product.id, since: new Date(now.getTime() - TIME_DAYS * DAY_MS), until: now }, viewer),
    listGaps({ productId: product.id, status: "open" }, viewer),
    contributorsFor(product.id, viewer),
  ]);

  // In progress looks back two weeks, inside What's new's six, so these two hold every ticket and PR either shows.
  const refs = refLinks(
    [...weeks.flatMap((w) => [...w.summaries, ...w.findings]), ...progress.open]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .flatMap((r) => r.refs),
  );

  return {
    status: "ok",
    page: {
      product: { id: product.id, name: product.name, repos: repoViews(product) },
      weeks: weeks.map((week) => ({
        weekStart: week.weekStart.toISOString(),
        label: weekLabel(week.weekStart, now),
        sessions: sessionsOfWeek(week.summaries, week.findings),
      })),
      work: progress.work.slice(0, WORK_SHOWN).map(workView),
      moreWork: Math.max(0, progress.work.length - WORK_SHOWN),
      time: {
        top: time.items.slice(0, SIDE_SHOWN).map((item) => ({
          key: item.key,
          class: item.class,
          fp: item.fp,
          repo: item.repo,
          runs: item.runs,
          lostMs: item.lost.totalMs,
          failedMs: item.lost.failedMs,
          rerunMs: item.lost.rerunMs,
          slowMs: item.lost.slowMs,
        })),
        totalMs: time.items.reduce((sum, item) => sum + item.lost.totalMs, 0),
      },
      gaps: {
        top: gaps.slice(0, SIDE_SHOWN).map((gap) => ({
          id: gap.id,
          text: gap.text,
          sessions: gap.sessions,
          asked: gap.fromPeople,
          owner: gap.owner?.name ?? null,
          // A gap kept for its owner after the work that named it went has no occurrences, so no date.
          lastSeen: gap.lastSeen ? new Date(gap.lastSeen).toISOString() : null,
        })),
        open: gaps.length,
      },
      areas: contributors.areas.map((a) => ({ area: a.area, people: a.people.map((p) => p.name) })),
      people: contributors.people.map((p) => p.name),
      refs,
    },
  };
}
