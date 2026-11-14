// Every index the app relies on, created idempotently: `pnpm db:indexes` runs this at environment start and on release,
// and the database tests run it on their own database. The vector index is an Atlas Search index (the atlas-local image
// runs it), which becomes queryable a little after it's created: `wait` polls until it is.

import { embeddingModelId, provider, STUB_DIMENSIONS, STUB_MODEL } from "./ai/provider.ts";
import {
  apiKeys,
  audits,
  draftClaims,
  events,
  gaps,
  handoffs,
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
import { config } from "./config.ts";
import { db } from "./db.ts";

const EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function ensureIndexes({
  wait = false,
  timeoutMs = 120_000,
} = {}): Promise<{ vector: VectorState; vectorAction: VectorAction; vectorDetail: string }> {
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
    "handoffs",
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
    handoffs().createIndex({ "sender.id": 1, updatedAt: -1 }, { name: "by_sender" }),
    handoffs().createIndex({ "recipient.id": 1, status: 1, updatedAt: -1 }, { name: "by_recipient" }),
    handoffs().createIndex({ org: 1, project: 1, updatedAt: -1 }, { name: "by_project" }),
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
    records().createIndex({ "scope.user": 1, status: 1, createdAt: -1 }, { name: "by_author" }),
    records().createIndex({ status: 1, approvedAt: -1 }, { name: "approved" }),
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
  const vector = await ensureVectorIndex(wait, timeoutMs);
  return { vector: vector.state, vectorAction: vector.action, vectorDetail: vector.detail };
}

export type VectorState = "ready" | "pending" | "unavailable";
export type VectorAction = "created" | "updated" | "unchanged" | "unavailable";

// The vector index the active provider needs: its dimensions, and every field recall filters on before the search.
export function vectorIndexDefinition(dimensions = provider().dimensions) {
  return {
    fields: [
      { type: "vector", path: "embedding", numDimensions: dimensions, similarity: "cosine" },
      { type: "filter", path: "scope.org" },
      { type: "filter", path: "scope.project" },
      { type: "filter", path: "scope.user" },
      { type: "filter", path: "status" },
      { type: "filter", path: "expiresAt" },
      { type: "filter", path: "embeddingModel" },
    ],
  };
}

interface SearchIndexInfo {
  name?: string;
  status?: string;
  queryable?: boolean;
  latestDefinition?: { fields?: { type: string; path: string; numDimensions?: number; similarity?: string }[] };
}

export interface VectorIndexInfo {
  state: VectorState;
  // The index's own status (READY, PENDING, BUILDING, FAILED, ...), or null with no index.
  status: string | null;
  queryable: boolean;
  numDimensions: number | null;
  expectedDimensions: number;
  filters: string[];
  // Whether its definition is the one the active provider needs (dimensions and filters).
  matches: boolean;
  definition: SearchIndexInfo["latestDefinition"] | null;
}

function sameDefinition(found: SearchIndexInfo | undefined, wanted: ReturnType<typeof vectorIndexDefinition>): boolean {
  const have = found?.latestDefinition?.fields ?? [];
  const key = (f: { type: string; path: string; numDimensions?: number; similarity?: string }) =>
    `${f.type}|${f.path}|${f.numDimensions ?? ""}|${f.similarity ?? ""}`;
  const a = new Set(have.map(key));
  return wanted.fields.length === a.size && wanted.fields.every((f) => a.has(key(f)));
}

async function findVectorIndex(): Promise<SearchIndexInfo | undefined> {
  return (await memories().listSearchIndexes(VECTOR_INDEX).toArray())[0] as SearchIndexInfo | undefined;
}

// Memories from before `embeddingModel` was kept were all embedded by the stub (the only provider there was): say so,
// so recall's model filter keeps finding them while the stub is active, and re-embed knows what to bring over.
async function stampLegacyEmbeddings(): Promise<number> {
  const { modifiedCount } = await memories().updateMany(
    {
      embeddingModel: { $exists: false },
      $expr: { $eq: [{ $size: { $ifNull: ["$embedding", []] } }, STUB_DIMENSIONS] },
    },
    { $set: { embeddingModel: embeddingModelId({ name: "stub", model: STUB_MODEL, dimensions: STUB_DIMENSIONS }) } },
  );
  return modifiedCount;
}

async function replaceVectorIndex(definition: ReturnType<typeof vectorIndexDefinition>): Promise<string> {
  try {
    await memories().updateSearchIndex(VECTOR_INDEX, definition);
    return "updated";
  } catch {
    await memories().dropSearchIndex(VECTOR_INDEX);
    const until = Date.now() + 120_000;
    while ((await findVectorIndex()) && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
    await memories().createSearchIndex({ name: VECTOR_INDEX, type: "vectorSearch", definition });
    return "dropped and recreated";
  }
}

async function ensureVectorIndex(
  wait: boolean,
  timeoutMs: number,
): Promise<{ state: VectorState; action: VectorAction; detail: string }> {
  const dims = provider().dimensions;
  const definition = vectorIndexDefinition(dims);
  await stampLegacyEmbeddings();
  let action: VectorAction;
  let detail: string;
  try {
    const found = await findVectorIndex();
    if (!found) {
      await memories().createSearchIndex({ name: VECTOR_INDEX, type: "vectorSearch", definition });
      action = "created";
      detail = `created ${VECTOR_INDEX} (${dims} dimensions)`;
    } else if (!sameDefinition(found, definition)) {
      const was = found.latestDefinition?.fields?.find((f) => f.type === "vector")?.numDimensions;
      // Atlas updates a vector index in place, and keeps the old definition answering until the new one is built.
      // atlas-local refuses that ("mappings" is required): there, the index is dropped and made again.
      const how = await replaceVectorIndex(definition);
      action = "updated";
      detail =
        was === dims
          ? `${how} ${VECTOR_INDEX} for its filter fields (${dims} dimensions)`
          : `${how} ${VECTOR_INDEX} from ${was ?? "?"} to ${dims} dimensions for the active provider; run pnpm db:reembed for memories embedded by another model`;
    } else {
      action = "unchanged";
      detail = `${VECTOR_INDEX} already matches (${dims} dimensions)`;
    }
  } catch {
    // A MongoDB without Atlas Search (a plain mongod): recall falls back to the text index.
    return { state: "unavailable", action: "unavailable", detail: "this server has no Atlas Search" };
  }
  if (!wait) return { state: await vectorIndexState(), action, detail };
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await vectorIndexState()) === "ready") return { state: "ready", action, detail };
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { state: "pending", action, detail };
}

// Ready: queryable, built from the definition the active provider needs. Pending: being built, or (re)defined for
// another provider and waiting on `pnpm db:indexes`.
export async function vectorIndexState(): Promise<VectorState> {
  return (await vectorIndexInfo()).state;
}

export async function vectorIndexInfo(): Promise<VectorIndexInfo> {
  const expectedDimensions = provider().dimensions;
  const wanted = vectorIndexDefinition(expectedDimensions);
  let found: SearchIndexInfo | undefined;
  try {
    found = await findVectorIndex();
  } catch {
    return {
      state: "unavailable",
      status: null,
      queryable: false,
      numDimensions: null,
      expectedDimensions,
      filters: [],
      matches: false,
      definition: null,
    };
  }
  const fields = found?.latestDefinition?.fields ?? [];
  const matches = sameDefinition(found, wanted);
  const queryable = found?.queryable === true;
  return {
    state: queryable && matches && (found?.status ?? "READY") === "READY" ? "ready" : "pending",
    status: found?.status ?? null,
    queryable,
    numDimensions: fields.find((f) => f.type === "vector")?.numDimensions ?? null,
    expectedDimensions,
    filters: fields.filter((f) => f.type === "filter").map((f) => f.path),
    matches,
    definition: found?.latestDefinition ?? null,
  };
}

// Where MONGODB_URI points, without saying its host: Atlas (a mongodb+srv URI or an Atlas host name), or a MongoDB of
// one's own (atlas-local, a plain mongod), with the server's version.
export async function clusterInfo(): Promise<{ kind: "atlas" | "local"; version: string | null }> {
  const uri = config().mongoUri;
  const atlas = /^mongodb\+srv:/.test(uri) || /\.mongodb\.net\b/i.test(uri);
  const version = await db()
    .admin()
    .command({ buildInfo: 1 })
    .then((b) => String(b.version))
    .catch(() => null);
  return { kind: atlas ? "atlas" : "local", version };
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
