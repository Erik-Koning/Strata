// Projects, memberships and the approved summary store. Only approved revisions are written here;
// the highest revision for (userId, sessionId) is the current summary.
import type { Rollup, SearchResult, SummaryLinks, SummarySummary } from "@strata/contracts";
import { MongoServerError, ObjectId } from "mongodb";
import { audit } from "../audit.ts";
import {
  type ProjectDoc,
  type ProjectMemberDoc,
  projectMembers,
  projects,
  type SummaryRevisionDoc,
  summaryRevisions,
} from "../collections.ts";
import { db } from "../db.ts";
import { syncGaps } from "../hub/gaps.ts";
import { ensureProductsFor } from "../hub/products.ts";
import { indexSessionsLater, searchSyncPending } from "../hub/search.ts";
import { V1Error } from "../v1.ts";

const isDuplicate = (error: unknown): boolean =>
  (error instanceof MongoServerError && error.code === 11000) ||
  (typeof error === "object" && error !== null && (error as { code?: number }).code === 11000);

export interface UserIdentity {
  id: string;
  name: string;
  email: string;
}

// Better Auth stores user ids as ObjectId strings (the Mongo adapter maps id <-> _id).
export async function findUser(userId: string): Promise<UserIdentity | null> {
  if (!userId) return null;
  const users = db().collection("user");
  const id = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
  const doc = (await users.findOne({ _id: id as never })) ?? (await users.findOne({ id: userId } as never));
  if (!doc) return null;
  return {
    id: userId,
    name: typeof doc.name === "string" ? doc.name : "",
    email: typeof doc.email === "string" ? doc.email : "",
  };
}

// One project per person, made the first time they ask. Teams and shared projects can be added
// later; without this the plugin has nothing to choose and nothing could ever be sent.
export async function ensureDefaultProject(userId: string, name: string): Promise<ProjectDoc> {
  const claim = await projectMembers().findOne({ userId, isDefault: true });
  if (claim) {
    const existing = await projects().findOne({ _id: claim.projectId });
    if (existing) return existing;
  }
  const displayName = name.trim().split(/\s+/)[0];
  const project: ProjectDoc = {
    _id: new ObjectId(),
    name: displayName ? `${displayName}'s work` : "My work",
    teamName: "Personal",
    description: "Created automatically for this account.",
    createdAt: new Date(),
  };
  try {
    await projects().insertOne(project);
    await projectMembers().insertOne({
      _id: new ObjectId(),
      projectId: project._id,
      userId,
      role: "owner",
      isDefault: true,
      createdAt: new Date(),
    });
  } catch (error) {
    if (isDuplicate(error)) {
      const raced = await projectMembers().findOne({ userId, isDefault: true });
      const existing = raced && (await projects().findOne({ _id: raced.projectId }));
      if (existing) return existing;
    }
    throw error;
  }
  return project;
}

export interface ProjectView {
  id: string;
  name: string;
  teamName: string;
  description: string;
}

export async function projectsFor(userId: string): Promise<ProjectView[]> {
  const memberships = await projectMembers().find({ userId }).toArray();
  if (!memberships.length) return [];
  const docs = await projects()
    .find({ _id: { $in: memberships.map((member) => member.projectId) } })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map((project) => ({
    id: project._id.toHexString(),
    name: project.name,
    teamName: project.teamName,
    description: project.description,
  }));
}

export async function assertMember(userId: string, projectId: string): Promise<void> {
  if (!ObjectId.isValid(projectId)) throw new V1Error(422, "unknown_project");
  const member = await projectMembers().findOne({ projectId: new ObjectId(projectId), userId });
  if (!member) throw new V1Error(422, "unknown_project");
}

// The projects a request may read: the one named (membership checked), else every project the caller belongs to.
export async function resolveProjectIds(userId: string, projectId: string | null): Promise<string[]> {
  if (projectId) {
    await assertMember(userId, projectId);
    return [projectId];
  }
  const memberships = await projectMembers().find({ userId }).toArray();
  return memberships.map((member) => member.projectId.toHexString());
}

export interface NewRevision {
  v: number;
  userId: string;
  sessionId: string;
  projectId: string;
  revision: number;
  idempotencyKey: string;
  updatedAt: Date;
  client: { plugin: string; platform: string } | null;
  repo: { remote: string; branch: string; head: string };
  links: SummaryLinks;
  summary: SummarySummary;
  files: string[];
  review: { approved: true; approvedAt: Date; edited: boolean };
}

export async function storeRevision(input: NewRevision): Promise<{ duplicate: boolean; authorName: string | null }> {
  const author = await findUser(input.userId);
  const doc: SummaryRevisionDoc = {
    ...input,
    authorName: author?.name || null,
    receivedAt: new Date(),
  };
  try {
    await summaryRevisions().insertOne(doc);
  } catch (error) {
    if (isDuplicate(error)) return { duplicate: true, authorName: doc.authorName };
    throw error;
  }
  await audit({
    actor: { kind: "key", id: input.userId, label: "plugin" },
    action: "summary.receive",
    targetIds: [input.sessionId],
    scope: { project: input.projectId },
    detail: { revision: input.revision, jira: input.links.jira, noTicket: input.links.noTicket },
  });
  await shareWithHub(input.repo.remote, input.sessionId);
  return { duplicate: false, authorName: doc.authorName };
}

// A newly approved summary reaches the hub without a backfill: its repository becomes a product before the answer, so
// the product's page is there at once, and the gaps and Ask Strata's search copy of the session are brought in line with
// approved work after it. None of it ever fails the request; whatever it misses, `pnpm hub:backfill` catches up on.
async function shareWithHub(remote: string | null, sessionId: string): Promise<void> {
  try {
    if (remote) await ensureProductsFor([remote]);
  } catch (error) {
    console.error("hub: making a product for an approved summary failed", error);
  }
  syncGapsLater();
  indexSessionsLater([sessionId]);
}

// One gap sync at a time: a summary that arrives during one asks for one more run after it, however many arrive.
let gapSync: Promise<void> | null = null;
let gapSyncAgain = false;

function syncGapsLater(): void {
  if (gapSync) {
    gapSyncAgain = true;
    return;
  }
  gapSync = (async () => {
    do {
      gapSyncAgain = false;
      try {
        await syncGaps();
      } catch (error) {
        console.error("hub: syncing gaps after a summary changed failed", error);
      }
    } while (gapSyncAgain);
    gapSync = null;
  })();
}

// Resolves once the gap syncs started here have finished, including any asked for meanwhile, and the search copy's
// syncs with them: for tests.
export async function gapSyncPending(): Promise<void> {
  while (gapSync) await gapSync;
  await searchSyncPending();
}

export async function deleteSession(userId: string, sessionId: string): Promise<number> {
  const result = await summaryRevisions().deleteMany({ userId, sessionId });
  if (!result.deletedCount) return 0;
  await audit({
    actor: { kind: "key", id: userId, label: "plugin" },
    action: "summary.retract",
    targetIds: [sessionId],
    scope: null,
    detail: { revisions: result.deletedCount },
  });
  // The gaps only this session named go with it, and so does its search copy.
  syncGapsLater();
  indexSessionsLater([sessionId]);
  return result.deletedCount;
}

// The current summary per session, for the projects the caller can read.
export async function latestRevisions(projectIds: string[]): Promise<SummaryRevisionDoc[]> {
  if (!projectIds.length) return [];
  return summaryRevisions()
    .aggregate<SummaryRevisionDoc>([
      { $match: { projectId: { $in: projectIds } } },
      { $sort: { revision: -1, updatedAt: -1 } },
      { $group: { _id: { userId: "$userId", sessionId: "$sessionId" }, doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
      { $sort: { updatedAt: -1 } },
    ])
    .toArray();
}

const FINDINGS: { kind: SearchResult["kind"]; pick: (summary: SummarySummary) => string[] }[] = [
  { kind: "built", pick: (summary) => [summary.built] },
  { kind: "decision", pick: (summary) => summary.decisions },
  { kind: "insight", pick: (summary) => summary.insights },
  { kind: "workflow", pick: (summary) => summary.workflow },
  { kind: "pain-point", pick: (summary) => summary.painPoints },
  { kind: "gap", pick: (summary) => summary.gaps },
];

export function searchRevisions(docs: SummaryRevisionDoc[], query: string): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
  const results: SearchResult[] = [];
  for (const doc of docs) {
    for (const { kind, pick } of FINDINGS) {
      for (const item of pick(doc.summary ?? emptySummary())) {
        if (!item) continue;
        const haystack = `${item} ${doc.summary.title}`.toLowerCase();
        if (!words.every((word) => haystack.includes(word))) continue;
        results.push({
          kind,
          text: item,
          title: doc.summary.title,
          projectId: doc.projectId,
          jira: doc.links?.jira ?? [],
          pr: doc.links?.pr?.url ?? null,
          sessionId: doc.sessionId,
          author: doc.authorName,
          updatedAt: doc.updatedAt.toISOString(),
        });
        if (results.length >= 20) return results;
      }
    }
  }
  return results;
}

const emptySummary = (): SummarySummary => ({
  title: "",
  built: "",
  why: "",
  decisions: [],
  areas: [],
  open: [],
  insights: [],
  workflow: [],
  painPoints: [],
  gaps: [],
});

export function rollupsFor(docs: SummaryRevisionDoc[]): Rollup[] {
  const groups = new Map<string, Rollup & { updatedAt: Date }>();
  for (const doc of docs) {
    const jira = doc.links?.jira?.[0];
    const pr = doc.links?.pr?.url;
    const key = jira ?? pr ?? "(no ticket)";
    const kind: Rollup["kind"] = jira ? "ticket" : pr ? "pr" : "none";
    const id = `${doc.projectId}\0${key}`;
    const group =
      groups.get(id) ??
      ({
        key,
        kind,
        authors: [],
        sessions: [],
        decisions: [],
        insights: [],
        workflow: [],
        painPoints: [],
        gaps: [],
        updatedAt: doc.updatedAt,
      } satisfies Rollup & { updatedAt: Date });
    if (doc.authorName && !group.authors.includes(doc.authorName)) group.authors.push(doc.authorName);
    group.sessions.push({
      sessionId: doc.sessionId,
      title: doc.summary.title,
      built: doc.summary.built,
      updatedAt: doc.updatedAt.toISOString(),
    });
    for (const [keyName, field] of [
      ["decisions", "decisions"],
      ["insights", "insights"],
      ["workflow", "workflow"],
      ["painPoints", "painPoints"],
      ["gaps", "gaps"],
    ] as const) {
      for (const item of doc.summary[field] ?? []) {
        if (!group[keyName].includes(item)) group[keyName].push(item);
      }
    }
    if (doc.updatedAt > group.updatedAt) group.updatedAt = doc.updatedAt;
    groups.set(id, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(({ updatedAt: _, ...group }) => group);
}
