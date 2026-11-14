// The overview (/), put together for the person looking. Everyone first sees what's waiting for their own review:
// their drafts (for My Day) and the memories their sessions suggested. Then what their role leads with (HOME_FOCUS in
// access.ts):
//
//   - An engineer: the products they work on (those they've shared approved work in, else every product), each with
//     what's new this week; the open gaps on those products; and their own recent sessions.
//   - A manager, an executive or an admin: across every product, what shipped this week, the hours lost on tools this
//     month, the open gaps that come back most, and what's in progress. A manager's teams can't narrow it yet: no team
//     says which products it works on, so the page says so. An admin also gets a way to people and invitations.
//
// It only composes the hub's read models and the person's own stats, always as the viewer, so their rules hold here:
// approved work for everyone who isn't suspended, a draft counted for its author alone, time measured on tools, and no
// count, ranking or comparison of people (people appear by name only, on the work they did). Everything it returns is
// plain data, strings and numbers, so any of it can go to a client component as it is.
import { can, type Focus, HOME_FOCUS, type Role } from "../access.ts";
import { overview, recentSessions, usesPlugin, waitingOn } from "../stats.ts";
import { type Gap, listGaps } from "./gaps.ts";
import { type RefLink, refLinks, type SessionWork, sessionsOfWeek } from "./product-page.ts";
import { listProducts, type Product } from "./products.ts";
import { reader, type ViewerRef, viewerIdOf } from "./reader.ts";
import { timeLost } from "./signals.ts";
import { inProgress, recordsFor, type TeamRecord, type WorkInProgress, whatsNew } from "./team-records.ts";
import { DAY_MS } from "./text.ts";
import { DEFAULT_RANGE } from "./time-page.ts";

// How far back each part looks. Time matches /time's default range, so its link shows the same figure.
export const NEWS_DAYS = 7;
export const TIME_DAYS = DEFAULT_RANGE;
// How much of each part the overview shows before it points to the page with the rest.
export const PRODUCTS_SHOWN = 6;
export const SESSIONS_SHOWN = 3;
export const GAPS_SHOWN = 5;
export const TIME_SHOWN = 3;
export const WORK_SHOWN = 6;
const OPEN_SHOWN = 2;
const WORK_SESSIONS_SHOWN = 3;
const OWN_SESSIONS_SHOWN = 6;
// A client heard from this recently is connected.
const LIVE_MS = 5 * 60 * 1000;

export type HomeView = "engineer" | "lead";

export interface HomeLayout {
  role: Role;
  focus: Focus;
  // What the page leads with after the review queue: an engineer's own products, or every product for the rest.
  view: HomeView;
  // A manager's home can't be narrowed to their teams yet, since no team says which products it works on.
  teamsHint: boolean;
  // An admin also runs the install: people, roles, teams and invitations.
  admin: boolean;
}

// What a role's home view shows. A suspended person gets no home at all (homeFor).
export function homeLayout(role: Role, suspended = false): HomeLayout {
  const focus = HOME_FOCUS[role];
  return {
    role,
    focus,
    view: focus === "friction" ? "engineer" : "lead",
    teamsHint: focus === "teams",
    admin: can.administer({ userId: "", role, suspended, manages: [] }),
  };
}

export interface Waiting {
  // Their own drafts, approved or discarded on My Day. Null when they don't use the plugin: there's no My Day for them.
  drafts: number | null;
  // Memories their sessions suggested, kept or dropped on Memories.
  candidates: number;
}

export interface ProductNews {
  // Null for work outside any product (a session outside a repository).
  id: string | null;
  name: string;
  // Its repositories, as people read them: github.com/acme/app, or github.com/acme/mono / billing for a folder.
  repos: string[];
  // This week's sessions in it, newest first.
  sessions: SessionWork[];
  moreSessions: number;
  // When the newest of them was shared; null when nothing was this week.
  latestAt: string | null;
}

export interface GapItem {
  id: string;
  text: string;
  productId: string | null;
  productName: string | null;
  // Coding sessions it came up in, and questions Ask Strata couldn't answer about it.
  sessions: number;
  asked: number;
  // Who has taken it on, by name.
  owner: string | null;
  lastSeen: string | null;
}

export interface TimeLine {
  // The command's row on /time, to link to.
  anchor: string;
  class: string;
  fp: string;
  repo: string;
  productId: string | null;
  productName: string | null;
  runs: number;
  lostMs: number;
}

export interface WorkItem {
  key: string;
  kind: WorkInProgress["kind"];
  title: string;
  productId: string | null;
  productName: string | null;
  refs: RefLink[];
  sessionIds: string[];
  moreSessions: number;
  // Who worked on it, by name, alphabetical.
  people: string[];
  lastAt: string;
  // The questions its sessions left open.
  open: { id: string; text: string }[];
  moreOpen: number;
}

export interface OwnSession {
  id: string;
  project: string;
  prompts: number;
  last: string;
  // Whether they've shared approved work from it yet.
  shared: boolean;
}

export interface EngineerHome {
  // The products they've shared approved work in, newest news first; every product when they haven't shared any yet.
  products: ProductNews[];
  moreProducts: number;
  mine: boolean;
  // Open gaps on those products, the ones that come back most first.
  gaps: GapItem[];
  openGaps: number;
  sessions: OwnSession[];
}

export interface LeadHome {
  // Products with approved work shared this week, the newest first.
  shipped: ProductNews[];
  moreShipped: number;
  time: { totalMs: number; commands: number; top: TimeLine[] };
  gaps: GapItem[];
  openGaps: number;
  work: WorkItem[];
  moreWork: number;
}

export interface AgentHome {
  keys: number;
  lastSeen: { at: string; client: string | null; key: string } | null;
  live: boolean;
  // The project whose start-of-session block is shown: their first, when they have memories or events at all.
  project: string | null;
}

export interface Home {
  layout: HomeLayout;
  usesPlugin: boolean;
  waiting: Waiting;
  engineer: EngineerHome | null;
  lead: LeadHome | null;
  agent: AgentHome;
}

const repoLabels = (product: Product): string[] =>
  product.repos.map((r) => (r.path ? `${r.repo} / ${r.path}` : r.repo));

// Approved work, by the product it belongs to (null for none).
function byProduct(records: TeamRecord[]): Map<string | null, TeamRecord[]> {
  const out = new Map<string | null, TeamRecord[]>();
  for (const record of records) out.set(record.productId, [...(out.get(record.productId) ?? []), record]);
  return out;
}

// One product's news: its sessions this week, each with its summary and what was shared alongside it.
function newsOf(id: string | null, name: string, repos: string[], records: TeamRecord[]): ProductNews {
  const sessions = sessionsOfWeek(
    records.filter((r) => r.kind === "summary"),
    records.filter((r) => r.kind !== "summary"),
  );
  return {
    id,
    name,
    repos,
    sessions: sessions.slice(0, SESSIONS_SHOWN),
    moreSessions: Math.max(0, sessions.length - SESSIONS_SHOWN),
    latestAt: sessions[0]?.at ?? null,
  };
}

const newestFirst = (a: ProductNews, b: ProductNews): number =>
  (b.latestAt ?? "").localeCompare(a.latestAt ?? "") || a.name.localeCompare(b.name);

const gapItem =
  (names: Map<string, string>) =>
  (gap: Gap): GapItem => ({
    id: gap.id,
    text: gap.text,
    productId: gap.productId,
    productName: gap.productId ? (names.get(gap.productId) ?? null) : null,
    sessions: gap.sessions,
    asked: gap.fromPeople,
    owner: gap.owner?.name ?? null,
    // A gap kept for its owner after the work that named it went has no occurrences, so no date.
    lastSeen: gap.lastSeen ? new Date(gap.lastSeen).toISOString() : null,
  });

const workItem =
  (names: Map<string, string>) =>
  (work: WorkInProgress): WorkItem => ({
    key: `${work.kind}:${work.key}`,
    kind: work.kind,
    title: work.title,
    productId: work.productId,
    productName: work.productId ? (names.get(work.productId) ?? null) : null,
    refs: refLinks([
      ...work.tickets.map((id) => ({ type: "ticket" as const, id })),
      ...(work.pr ? [{ type: "pr" as const, id: work.pr.id, ...(work.pr.url ? { url: work.pr.url } : {}) }] : []),
    ]),
    sessionIds: work.sessionIds.slice(0, WORK_SESSIONS_SHOWN),
    moreSessions: Math.max(0, work.sessionIds.length - WORK_SESSIONS_SHOWN),
    people: work.people.map((p) => p.name),
    lastAt: work.lastAt.toISOString(),
    open: work.open.slice(0, OPEN_SHOWN).map((r) => ({ id: r.id, text: r.text })),
    moreOpen: Math.max(0, work.open.length - OPEN_SHOWN),
  });

// This week's approved work, every line of it, newest first.
async function thisWeek(viewer: ViewerRef, now: Date): Promise<TeamRecord[]> {
  const weeks = await whatsNew({ since: new Date(now.getTime() - NEWS_DAYS * DAY_MS), until: now }, viewer);
  return weeks.flatMap((w) => [...w.summaries, ...w.findings]);
}

async function engineerHome(
  viewer: ViewerRef,
  userId: string,
  listed: Product[],
  names: Map<string, string>,
  now: Date,
): Promise<EngineerHome> {
  const [approved, news, open, sessions] = await Promise.all([
    recordsFor({ limit: 1000 }, viewer),
    thisWeek(viewer, now),
    listGaps({ status: "open" }, viewer),
    recentSessions(userId, OWN_SESSIONS_SHOWN),
  ]);
  // Their own approved work says which products are theirs, and which of their sessions they've shared.
  const own = approved.filter((r) => r.author?.id === userId);
  const ownProducts = new Set(own.flatMap((r) => (r.productId && names.has(r.productId) ? [r.productId] : [])));
  const sharedSessions = new Set(own.map((r) => r.sessionId));
  const mine = ownProducts.size > 0;
  const theirs = mine ? listed.filter((p) => ownProducts.has(p.id)) : listed;
  const ids = new Set(theirs.map((p) => p.id));

  const grouped = byProduct(news);
  const products = theirs.map((p) => newsOf(p.id, p.name, repoLabels(p), grouped.get(p.id) ?? [])).sort(newestFirst);
  const gaps = open.filter((g) => g.productId !== null && ids.has(g.productId));

  return {
    products: products.slice(0, PRODUCTS_SHOWN),
    moreProducts: Math.max(0, products.length - PRODUCTS_SHOWN),
    mine,
    gaps: gaps.slice(0, GAPS_SHOWN).map(gapItem(names)),
    openGaps: gaps.length,
    sessions: sessions.map((s) => ({
      id: s.sessionID,
      project: s.project,
      prompts: s.prompts,
      last: new Date(s.last).toISOString(),
      shared: sharedSessions.has(s.sessionID),
    })),
  };
}

async function leadHome(
  viewer: ViewerRef,
  listed: Product[],
  names: Map<string, string>,
  now: Date,
): Promise<LeadHome> {
  const [news, time, open, progress] = await Promise.all([
    thisWeek(viewer, now),
    timeLost({ since: new Date(now.getTime() - TIME_DAYS * DAY_MS), until: now }, viewer),
    listGaps({ status: "open" }, viewer),
    inProgress({}, viewer),
  ]);
  const byId = new Map(listed.map((p) => [p.id, p]));
  const shipped = [...byProduct(news).entries()]
    .map(([id, records]) => {
      const product = id ? byId.get(id) : undefined;
      return newsOf(id, product?.name ?? id ?? "No product", product ? repoLabels(product) : [], records);
    })
    .filter((p) => p.sessions.length)
    .sort(newestFirst);

  return {
    shipped: shipped.slice(0, PRODUCTS_SHOWN),
    moreShipped: Math.max(0, shipped.length - PRODUCTS_SHOWN),
    time: {
      totalMs: time.items.reduce((sum, item) => sum + item.lost.totalMs, 0),
      commands: time.items.length,
      top: time.items.slice(0, TIME_SHOWN).map((item) => ({
        anchor: `item-${item.key}-${item.productId ?? "none"}`,
        class: item.class,
        fp: item.fp,
        repo: item.repo,
        productId: item.productId,
        productName: item.productId ? (names.get(item.productId) ?? null) : null,
        runs: item.runs,
        lostMs: item.lost.totalMs,
      })),
    },
    gaps: open.slice(0, GAPS_SHOWN).map(gapItem(names)),
    openGaps: open.length,
    work: progress.work.slice(0, WORK_SHOWN).map(workItem(names)),
    moreWork: Math.max(0, progress.work.length - WORK_SHOWN),
  };
}

// Everything the overview shows, read as the viewer. Null for someone who may read nothing (suspended).
export async function homeFor(viewer: ViewerRef, now = new Date()): Promise<Home | null> {
  const access = await reader(viewer);
  if (!access) return null;
  const userId = viewerIdOf(viewer);
  const layout = homeLayout(access.role, access.suspended);

  const [stats, waiting, plugin, listed] = await Promise.all([
    overview(userId),
    waitingOn(userId),
    usesPlugin(userId),
    listProducts(viewer),
  ]);
  const names = new Map(listed.map((p) => [p.id, p.name]));
  const [engineer, lead] = await Promise.all([
    layout.view === "engineer" ? engineerHome(viewer, userId, listed, names, now) : null,
    layout.view === "lead" ? leadHome(viewer, listed, names, now) : null,
  ]);

  return {
    layout,
    usesPlugin: plugin,
    waiting: {
      // waitingOn counts their drafts and their candidate memories together; the candidates are counted on their own.
      drafts: plugin ? Math.max(0, waiting - stats.candidates) : null,
      candidates: stats.candidates,
    },
    engineer,
    lead,
    agent: {
      keys: stats.keys,
      lastSeen: stats.lastSeen
        ? { at: stats.lastSeen.at.toISOString(), client: stats.lastSeen.client, key: stats.lastSeen.key }
        : null,
      live: stats.lastSeen ? now.getTime() - stats.lastSeen.at.getTime() < LIVE_MS : false,
      project: stats.projects[0] ?? null,
    },
  };
}
