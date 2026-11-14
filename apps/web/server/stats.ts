// What the pages show: one person's memory, their sessions and their clients.
import { MEMORY_KINDS, MEMORY_STATUSES, type MemoryKind, type MemoryStatus } from "@strata/contracts";
import { ObjectId } from "mongodb";
import { DEFAULT_ORG } from "./api-auth.ts";
import { type AuditDoc, apiKeys, audits, events, type MemoryDoc, memories } from "./collections.ts";

const DAY = 24 * 60 * 60 * 1000;

export interface Overview {
  active: number;
  candidates: number;
  events24h: number;
  sessions7d: number;
  projects: string[];
  lastSeen: { at: Date; client: string | null; key: string } | null;
  keys: number;
}

export async function overview(userId: string): Promise<Overview> {
  const own = { "scope.org": DEFAULT_ORG, "scope.user": userId };
  const since = new Date(Date.now() - DAY);
  const [active, candidates, events24h, sessions, projectsA, projectsB, lastKey, keys] = await Promise.all([
    memories().countDocuments({ ...own, status: "active" }),
    memories().countDocuments({ ...own, status: "candidate" }),
    events().countDocuments({ "scope.user": userId, receivedAt: { $gte: since } }),
    events().distinct("sessionID", { "scope.user": userId, receivedAt: { $gte: new Date(Date.now() - 7 * DAY) } }),
    memories().distinct("scope.project", own),
    events().distinct("scope.project", { "scope.user": userId }),
    apiKeys()
      .find({ userId, revokedAt: null, lastUsedAt: { $ne: null } })
      .sort({ lastUsedAt: -1 })
      .limit(1)
      .next(),
    apiKeys().countDocuments({ userId, revokedAt: null }),
  ]);
  const projects = [...new Set([...projectsA, ...projectsB])].filter((p) => p !== "*").sort();
  return {
    active,
    candidates,
    events24h,
    sessions7d: sessions.length,
    projects,
    lastSeen: lastKey?.lastUsedAt ? { at: lastKey.lastUsedAt, client: lastKey.lastClient, key: lastKey.name } : null,
    keys,
  };
}

export interface SessionRow {
  sessionID: string;
  project: string;
  client: string | null;
  first: Date;
  last: Date;
  events: number;
  prompts: number;
}

export async function recentSessions(userId: string, limit = 6): Promise<SessionRow[]> {
  return events()
    .aggregate<SessionRow>([
      { $match: { "scope.user": userId } },
      { $sort: { receivedAt: -1 } },
      { $limit: 5000 },
      {
        $group: {
          _id: "$sessionID",
          project: { $first: "$scope.project" },
          client: { $first: "$client" },
          first: { $min: "$ts" },
          last: { $max: "$ts" },
          events: { $sum: 1 },
          prompts: { $sum: { $cond: [{ $eq: ["$kind", "prompt"] }, 1, 0] } },
        },
      },
      { $sort: { last: -1 } },
      { $limit: limit },
      { $project: { _id: 0, sessionID: "$_id", project: 1, client: 1, first: 1, last: 1, events: 1, prompts: 1 } },
    ])
    .toArray();
}

export interface MemoryQuery {
  q?: string;
  status?: MemoryStatus | "all";
  kind?: MemoryKind | "all";
  project?: string;
  page?: number;
}

export const PAGE_SIZE = 20;

export async function listMemories(
  userId: string,
  query: MemoryQuery,
): Promise<{ rows: MemoryDoc[]; total: number; page: number; pages: number }> {
  const filter: Record<string, unknown> = { "scope.org": DEFAULT_ORG, "scope.user": userId };
  if (query.status && query.status !== "all" && MEMORY_STATUSES.includes(query.status)) filter.status = query.status;
  else filter.status = { $in: ["active", "candidate"] };
  if (query.kind && query.kind !== "all" && MEMORY_KINDS.includes(query.kind)) filter.kind = query.kind;
  if (query.project) filter["scope.project"] = query.project;
  if (query.q?.trim()) filter.$text = { $search: query.q.trim().slice(0, 200) };
  const total = await memories().countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const rows = await memories()
    .find(filter, { projection: { embedding: 0 } })
    .sort({ _id: -1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();
  return { rows, total, page, pages };
}

export async function recentMemories(userId: string, limit = 5): Promise<MemoryDoc[]> {
  return memories()
    .find(
      { "scope.org": DEFAULT_ORG, "scope.user": userId, status: { $in: ["active", "candidate"] } },
      { projection: { embedding: 0 } },
    )
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();
}

export async function auditTrail(userId: string, limit = 100): Promise<AuditDoc[]> {
  const keyIds = (
    await apiKeys()
      .find({ userId }, { projection: { _id: 1 } })
      .toArray()
  ).map((k) => k._id.toHexString());
  return audits()
    .find({ $or: [{ "scope.user": userId }, { "actor.id": userId }, { "actor.id": { $in: keyIds } }] })
    .sort({ ts: -1 })
    .limit(limit)
    .toArray();
}

export async function setStatus(userId: string, id: string, status: "active" | "archived"): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const result = await memories().updateOne(
    { _id: new ObjectId(id), "scope.org": DEFAULT_ORG, "scope.user": userId },
    { $set: { status, ...(status === "active" ? { trust: "explicit" } : {}), updatedAt: new Date() } },
  );
  return result.modifiedCount === 1;
}
