// Every index the app relies on, created idempotently: `pnpm db:indexes` runs this at environment start and on release,
// and the database tests run it on their own database. The vector index is an Atlas Search index (the atlas-local image
// runs it), which becomes queryable a little after it's created: `wait` polls until it is.

import { provider } from "./ai/provider.ts";
import { apiKeys, audits, events, invites, memories, summaries, teams, VECTOR_INDEX } from "./collections.ts";
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
