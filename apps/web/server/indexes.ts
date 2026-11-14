// Every index the app relies on, created idempotently: `pnpm db:indexes` runs this at environment start and on release,
// and the database tests run it on their own database. The vector index is an Atlas Search index (the atlas-local image
// runs it), which becomes queryable a little after it's created: `wait` polls until it is.

import { provider } from "./ai/provider.ts";
import {
  apiKeys,
  audits,
  draftClaims,
  events,
  gaps,
  invites,
  memories,
  products,
  projectMembers,
  records,
  signalDaily,
  summaries,
  summaryRevisions,
  teams,
  VECTOR_INDEX,
} from "./collections.ts";
import { db } from "./db.ts";

const EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function ensureIndexes({
  wait = false,
  timeoutMs = 120_000,
} = {}): Promise<{ vector: "ready" | "pending" | "unavailable" }> {
  const existing = new Set((await db().listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of [
    "memory_events",
    "memories",
    "memory_summaries",
    "memory_audit",
    "api_keys",
    "members",
    "teams",
    "invites",
    "projects",
    "project_members",
    "summary_revisions",
    "records",
    "deviceCode",
    "products",
    "signal_daily",
    "gaps",
    "draft_claims",
  ])
    if (!existing.has(name))
      await db()
        .createCollection(name)
        .catch(() => undefined);

  await Promise.all([
    events().createIndex({ id: 1 }, { unique: true, name: "id_unique" }),
    events().createIndex({ receivedAt: 1 }, { expireAfterSeconds: EVENT_TTL_SECONDS, name: "received_ttl" }),
    events().createIndex({ "scope.user": 1, sessionID: 1, ts: 1 }, { name: "by_session" }),
    events().createIndex({ "scope.user": 1, receivedAt: -1 }, { name: "by_user_recent" }),
    memories().createIndex(
      { "scope.org": 1, "scope.user": 1, "scope.project": 1, status: 1, _id: 1 },
      { name: "by_scope" },
    ),
    memories().createIndex({ text: "text" }, { name: "text" }),
    memories().createIndex(
      { "scope.org": 1, "scope.user": 1, "scope.project": 1, textKey: 1 },
      { name: "by_text_key" },
    ),
    memories().createIndex({ "provenance.eventId": 1 }, { name: "by_event", sparse: true }),
    summaries().createIndex({ sessionID: 1 }, { name: "by_session" }),
    summaries().createIndex({ sourceIds: 1 }, { name: "by_source" }),
    audits().createIndex({ ts: -1 }, { name: "recent" }),
    audits().createIndex({ "actor.id": 1, ts: -1 }, { name: "by_actor" }),
    audits().createIndex({ targetIds: 1, ts: -1 }, { name: "by_target" }),
    audits().createIndex({ action: 1, ts: -1 }, { name: "by_action" }),
    apiKeys().createIndex({ hash: 1 }, { unique: true, name: "hash_unique" }),
    apiKeys().createIndex({ userId: 1, createdAt: -1 }, { name: "by_user" }),
    teams().createIndex({ name: 1 }, { unique: true, name: "name_unique", collation: { locale: "en", strength: 2 } }),
    teams().createIndex({ memberIds: 1 }, { name: "by_member" }),
    teams().createIndex({ managerIds: 1 }, { name: "by_manager" }),
    invites().createIndex({ hash: 1 }, { unique: true, name: "hash_unique" }),
    invites().createIndex({ email: 1, createdAt: -1 }, { name: "by_email" }),
    projectMembers().createIndex({ userId: 1, projectId: 1 }, { unique: true, name: "member_unique" }),
    projectMembers().createIndex(
      { userId: 1, isDefault: 1 },
      { unique: true, partialFilterExpression: { isDefault: true }, name: "one_default_unique" },
    ),
    projectMembers().createIndex({ projectId: 1 }, { name: "by_project" }),
    summaryRevisions().createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true, name: "idempotency_unique" }),
    summaryRevisions().createIndex({ userId: 1, sessionId: 1, revision: 1 }, { unique: true, name: "revision_unique" }),
    summaryRevisions().createIndex({ projectId: 1, updatedAt: -1 }, { name: "by_project_recent" }),
    summaryRevisions().createIndex({ userId: 1, updatedAt: -1 }, { name: "by_user_recent" }),
    summaryRevisions().createIndex({ "links.jira": 1 }, { name: "by_jira" }),
    summaryRevisions().createIndex({ "links.pr.url": 1 }, { name: "by_pr" }),
    // Drafting a session twice never makes the same record twice.
    records().createIndex(
      { "scope.org": 1, "scope.user": 1, "scope.project": 1, sessionID: 1, kind: 1, textKey: 1 },
      { unique: true, name: "record_unique" },
    ),
    records().createIndex({ "scope.user": 1, status: 1, updatedAt: -1 }, { name: "by_author_status" }),
    records().createIndex({ "scope.user": 1, sessionID: 1 }, { name: "by_session" }),
    draftClaims().createIndex({ doneAt: 1 }, { expireAfterSeconds: EVENT_TTL_SECONDS, name: "done_ttl" }),
    // The hub reads approved work team-wide (server/hub/team-records.ts): everything, one product's, one session's.
    records().createIndex({ status: 1, "scope.org": 1, approvedAt: -1 }, { name: "team_approved" }),
    records().createIndex(
      { status: 1, "scope.org": 1, "scope.project": 1, approvedAt: -1 },
      { name: "team_approved_by_project" },
    ),
    records().createIndex({ sessionID: 1, status: 1 }, { name: "by_session_status" }),
    records().createIndex({ title: "text", text: "text" }, { name: "text" }),
    summaryRevisions().createIndex({ "review.approvedAt": -1 }, { name: "by_approved" }),
    summaryRevisions().createIndex({ sessionId: 1, revision: -1 }, { name: "by_session" }),
    summaryRevisions().createIndex(
      {
        "summary.title": "text",
        "summary.built": "text",
        "summary.why": "text",
        "summary.decisions": "text",
        "summary.areas": "text",
        "summary.open": "text",
        "summary.insights": "text",
        "summary.workflow": "text",
        "summary.painPoints": "text",
        "summary.gaps": "text",
      },
      { name: "text" },
    ),
    // A repository (or a folder of one) belongs to one product; a merged product keeps none.
    products().createIndex(
      { org: 1, repoKeys: 1 },
      { unique: true, name: "repo_unique", partialFilterExpression: { "repoKeys.0": { $exists: true } } },
    ),
    products().createIndex({ repoKeys: 1 }, { name: "by_repo" }),
    signalDaily().createIndex({ item: 1, day: 1, productId: 1 }, { unique: true, name: "row_unique" }),
    signalDaily().createIndex({ day: 1, productId: 1 }, { name: "by_day" }),
    gaps().createIndex({ key: 1 }, { unique: true, name: "key_unique" }),
    gaps().createIndex({ status: 1, productId: 1, lastSeen: -1 }, { name: "by_status" }),
    gaps().createIndex({ sourceIds: 1 }, { name: "by_source" }),
    gaps().createIndex({ text: "text" }, { name: "text" }),
    // The deviceCode indexes belong to Better Auth's device-authorization schema; it creates them itself.
  ]);
  return { vector: await ensureVectorIndex(wait, timeoutMs) };
}

async function ensureVectorIndex(wait: boolean, timeoutMs: number): Promise<"ready" | "pending" | "unavailable"> {
  const definition = {
    fields: [
      { type: "vector", path: "embedding", numDimensions: provider().dimensions, similarity: "cosine" },
      { type: "filter", path: "scope.org" },
      { type: "filter", path: "scope.project" },
      { type: "filter", path: "scope.user" },
      { type: "filter", path: "status" },
    ],
  };
  let found: { queryable?: boolean } | undefined;
  try {
    found = (await memories().listSearchIndexes(VECTOR_INDEX).toArray())[0] as { queryable?: boolean } | undefined;
    if (!found) await memories().createSearchIndex({ name: VECTOR_INDEX, type: "vectorSearch", definition });
  } catch {
    // A MongoDB without Atlas Search (a plain mongod): recall falls back to the text index.
    return "unavailable";
  }
  if (found?.queryable) return "ready";
  if (!wait) return "pending";
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const [index] = (await memories().listSearchIndexes(VECTOR_INDEX).toArray()) as { queryable?: boolean }[];
    if (index?.queryable) return "ready";
    await new Promise((r) => setTimeout(r, 1000));
  }
  return "pending";
}

export async function vectorIndexState(): Promise<"ready" | "pending" | "unavailable"> {
  try {
    const [index] = (await memories().listSearchIndexes(VECTOR_INDEX).toArray()) as { queryable?: boolean }[];
    return index?.queryable ? "ready" : "pending";
  } catch {
    return "unavailable";
  }
}

// Once per process: the indexes every route relies on (the unique event id above all), for a database that was never
// set up with db:indexes (a builder's own, a test's).
let once: Promise<unknown> | null = null;
export function indexesReady(): Promise<unknown> {
  once ??= ensureIndexes().catch((error) => {
    once = null;
    throw error;
  });
  return once;
}
