// A product's history page: its commits, the diff between two of them, and what Strata knows about that change.
//
// Git comes from git-history.ts (a clone the operator configured, nothing else). Strata's side is attached only by an
// exact commit: a handoff whose recorded commit, claim, finish or test run is one of the commits being compared, and
// the sessions those handoffs name or that reported one of those commits as their HEAD. Nothing is matched by text or
// guessed. Every piece is read as the viewer may read it: a handoff only by its sender or recipient (the Relay rules,
// handoffs/lifecycle.ts), its shared memories only while they're still shared, a session only through sessionDetail
// (approved work for everyone, drafts for their author alone).
import { DEFAULT_ORG } from "../api-auth.ts";
import { events, type HandoffDoc, handoffs, memories } from "../collections.ts";
import { config } from "../config.ts";
import { canRead, exclusionFor, partyOf } from "../handoffs/lifecycle.ts";
import { RECORD_LABELS } from "../records/routes.ts";
import {
  type Commit,
  cloneFor,
  commitsBetween,
  type Diff,
  diffCommits,
  GitUnavailable,
  listCommits,
  pickCommit,
} from "./git-history.ts";
import { getProduct, type Product } from "./products.ts";
import { reader, type ViewerRef, viewerIdOf } from "./reader.ts";
import { sessionDetail } from "./team-records.ts";
import { normalizeRepo } from "./text.ts";

export interface TestRunView {
  command: string;
  status: "pass" | "fail";
  exitCode: number | null;
  // Strata's client ran it and captured the exit code; false is someone's say-so.
  verified: boolean;
  by: string;
  role: "sender" | "recipient";
  commit: string | null;
  at: string;
}

export interface HandoffContext {
  id: string;
  title: string;
  status: HandoffDoc["status"];
  sender: string;
  recipient: string | null;
  // The viewer's part in it.
  viewerIs: "sender" | "recipient";
  // The commits it recorded: where it was handed off, where the recipient picked it up, where they finished.
  startCommit: string | null;
  claimCommit: string | null;
  finishCommit: string | null;
  finishPushed: boolean | null;
  summary: string;
  outcome: string;
  decisions: string[];
  failedApproaches: string[];
  changedFiles: string[];
  tests: TestRunView[];
  testCommands: string[];
  verified: boolean;
  memories: { id: string; text: string; kind: string; source: string | null }[];
  // Shared memories that no longer reach the recipient (forgotten, archived, expired), counted, never shown.
  memoriesWithdrawn: number;
  sessions: string[];
  completedAt: string | null;
}

export interface SessionContext {
  id: string;
  title: string | null;
  author: string | null;
  // How it's tied to this change, in a few words.
  link: string;
  findings: { id: string; kind: string; label: string; text: string; draft: boolean }[];
}

export interface HistoryCommit extends Commit {
  // Strata has something tied to this exact commit that the viewer can see.
  linked: boolean;
}

export interface HistoryPage {
  product: Product;
  repo: string;
  commits: HistoryCommit[];
  before: Commit | null;
  after: Commit;
  // The commits the comparison brings in (after's, not before's), newest first.
  range: string[];
  diff: Diff;
  context: { handoffs: HandoffContext[]; sessions: SessionContext[] };
  gitAuthors: { name: string; email: string; commits: number }[];
  // What the URL asked for that isn't a commit here, so the page can say it showed the default instead.
  ignored: string[];
}

export type HistoryResult =
  | { status: "missing" }
  | { status: "moved"; id: string }
  | { status: "no-clone"; product: Product }
  | { status: "empty"; product: Product; repo: string }
  | { status: "error"; product: Product; repo: string; message: string }
  | { status: "ok"; page: HistoryPage };

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// Whether a recorded sha (7 to 40 hex) names a full one.
const same = (recorded: string | null | undefined, full: string): boolean =>
  Boolean(recorded && recorded.length >= 7 && full.startsWith(recorded.toLowerCase()));

const commitsOf = (h: HandoffDoc): (string | null | undefined)[] => [
  h.repo?.commit,
  h.continuation?.claimRepo?.commit,
  h.continuation?.repo?.commit,
  ...h.tests.map((t) => t.commit),
];

export async function productHistory(
  id: string,
  viewer: ViewerRef,
  query: { before?: string | null; after?: string | null },
): Promise<HistoryResult> {
  if (!(await reader(viewer))) return { status: "missing" };
  const product = await getProduct(id, viewer);
  if (!product) return { status: "missing" };
  if (product.id !== id) return { status: "moved", id: product.id };

  const clones = config().localRepos;
  const repo = product.repos.map((r) => r.repo).find((r) => cloneFor(clones, r));
  const dir = repo ? cloneFor(clones, repo) : null;
  if (!repo || !dir) return { status: "no-clone", product };

  let commits: Commit[];
  try {
    commits = await listCommits(dir);
  } catch (error) {
    const message = error instanceof GitUnavailable ? error.message : "git couldn't read the repository";
    return { status: "error", product, repo, message };
  }
  if (!commits.length) return { status: "empty", product, repo };

  // The comparison: what the URL names when it's a listed commit; else the newest commit against its parent.
  const ignored: string[] = [];
  const asked = (value: string | null | undefined, label: string): Commit | null => {
    if (!value) return null;
    const found = pickCommit(commits, value);
    if (!found) ignored.push(label);
    return found;
  };
  const after = asked(query.after, "after") ?? (commits[0] as Commit);
  const parentOf = (c: Commit) => commits.find((x) => x.sha === c.parents[0]) ?? null;
  const before = query.before === "root" ? null : (asked(query.before, "before") ?? parentOf(after));

  let range: string[];
  let diff: Diff;
  try {
    [range, diff] = await Promise.all([
      commitsBetween(dir, before, after),
      before?.sha === after.sha
        ? Promise.resolve({ files: [], added: 0, removed: 0, truncated: false, omittedFiles: 0 })
        : diffCommits(dir, before, after),
    ]);
  } catch (error) {
    const message = error instanceof GitUnavailable ? error.message : "git couldn't compare those commits";
    return { status: "error", product, repo, message };
  }

  const inView = new Set([...range, after.sha, ...(before ? [before.sha] : [])]);
  const viewerId = viewerIdOf(viewer);
  const productRepos = new Set(product.repos.map((r) => r.repo));

  // The handoffs this person is a party to, in this product's repositories: the only ones they could open anyway.
  const visible = (
    await handoffs()
      .find({ org: DEFAULT_ORG, $or: [{ "sender.id": viewerId }, { "recipient.id": viewerId }] })
      .sort({ updatedAt: -1 })
      .limit(500)
      .toArray()
  ).filter((h) => canRead(h, viewerId) && productRepos.has(normalizeRepo(h.project) ?? ""));

  const linkedShas = new Set<string>();
  for (const h of visible)
    for (const recorded of commitsOf(h)) for (const c of commits) if (same(recorded, c.sha)) linkedShas.add(c.sha);

  const tied = visible.filter((h) => commitsOf(h).some((recorded) => [...inView].some((sha) => same(recorded, sha))));
  // Finished work first, a revoked handoff last; newest first within each.
  const RANK: Record<HandoffDoc["status"], number> = { completed: 0, claimed: 1, approved: 2, draft: 3, revoked: 4 };
  tied.sort((a, b) => RANK[a.status] - RANK[b.status] || b.updatedAt.getTime() - a.updatedAt.getTime());
  const handoffViews = await Promise.all(tied.map((h) => handoffView(h, viewerId)));

  // Sessions: the ones those handoffs name, and any whose start or context event reported one of these commits as HEAD.
  const sessionLinks = new Map<string, string>();
  for (const h of tied) {
    if (h.sourceSessionID) sessionLinks.set(h.sourceSessionID, `Wrote the handoff "${h.title}"`);
    if (h.continuation?.sessionID) sessionLinks.set(h.continuation.sessionID, `Picked up "${h.title}"`);
  }
  const headEvents = await events()
    .find(
      { kind: "session", "payload.git.head": { $in: [...inView] } },
      { projection: { sessionID: 1, scope: 1, payload: 1 } },
    )
    .limit(100)
    .toArray();
  for (const e of headEvents) {
    const git = (e.payload?.git ?? {}) as { remote?: string; head?: string };
    const eventRepo = normalizeRepo(git.remote ?? e.scope.project);
    if (!eventRepo || !productRepos.has(eventRepo) || sessionLinks.has(e.sessionID)) continue;
    sessionLinks.set(e.sessionID, `Started at ${String(git.head).slice(0, 7)}`);
  }
  const sessionViews = (
    await Promise.all(
      [...sessionLinks].slice(0, 12).map(async ([sessionId, link]): Promise<SessionContext | null> => {
        const detail = await sessionDetail(sessionId, viewer);
        if (!detail) return null;
        // Shared work only: someone's drafts stay on their own session page.
        const approved = detail.records.filter((r) => r.status === "approved");
        if (!approved.length) return null;
        return {
          id: sessionId,
          title: detail.summary ? detail.title : null,
          author: detail.author?.name ?? null,
          link,
          findings: approved
            .filter((r) => r.kind !== "summary")
            .slice(0, 6)
            .map((r) => ({
              id: r.id,
              kind: r.kind,
              label: RECORD_LABELS[r.kind] ?? r.kind.replace(/_/g, " "),
              text: r.text,
              draft: r.status === "draft",
            })),
        };
      }),
    )
  ).filter((s): s is SessionContext => s !== null);

  const authors = new Map<string, { name: string; email: string; commits: number }>();
  for (const sha of range) {
    const c = commits.find((x) => x.sha === sha);
    if (!c) continue;
    const key = `${c.author.name}\n${c.author.email}`;
    const seen = authors.get(key) ?? { ...c.author, commits: 0 };
    seen.commits++;
    authors.set(key, seen);
  }

  return {
    status: "ok",
    page: {
      product,
      repo,
      commits: commits.map((c) => ({ ...c, linked: linkedShas.has(c.sha) })),
      before,
      after,
      range,
      diff,
      context: { handoffs: handoffViews, sessions: sessionViews },
      gitAuthors: [...authors.values()],
      ignored,
    },
  };
}

async function handoffView(h: HandoffDoc, viewerId: string): Promise<HandoffContext> {
  const owner = { org: h.org, user: h.sender.id };
  const now = new Date();
  const docs = h.memoryIds.length
    ? await memories()
        .find({ _id: { $in: h.memoryIds } }, { projection: { embedding: 0 } })
        .toArray()
    : [];
  const shared = docs.filter((m) => exclusionFor(m, owner, now) === null);
  const nameOf = (role: "sender" | "recipient") =>
    role === "sender" ? h.sender.name : (h.recipient?.name ?? "Recipient");
  return {
    id: h._id.toHexString(),
    title: h.title,
    status: h.status,
    sender: h.sender.name,
    recipient: h.recipient?.name ?? null,
    viewerIs: partyOf(h, viewerId) ?? "sender",
    startCommit: h.repo?.commit ?? null,
    claimCommit: h.continuation?.claimRepo?.commit ?? null,
    finishCommit: h.continuation?.repo?.commit ?? null,
    finishPushed: h.continuation?.repo?.pushed ?? null,
    summary: h.summary,
    outcome: h.continuation?.summary ?? "",
    decisions: h.decisions,
    failedApproaches: h.failedApproaches,
    changedFiles: h.continuation?.changedFiles?.length ? h.continuation.changedFiles : h.changedFiles,
    tests: [...h.tests]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((t) => ({
        command: t.command,
        status: t.status,
        exitCode: t.exitCode,
        verified: t.verified,
        by: nameOf(t.by),
        role: t.by,
        commit: t.commit,
        at: t.at.toISOString(),
      })),
    testCommands: h.testCommands,
    verified: h.continuation?.verified === true,
    memories: shared.map((m) => ({
      id: m._id.toHexString(),
      text: m.text,
      kind: m.kind,
      source: m.provenance?.source ?? null,
    })),
    memoriesWithdrawn: h.memoryIds.length - shared.length,
    sessions: [h.sourceSessionID, h.continuation?.sessionID].filter((s): s is string => Boolean(s)),
    completedAt: iso(h.completedAt),
  };
}
