// One MongoClient for the app, kept across hot reloads. The database is the one MONGODB_URI names (agentic_memory for
// the team's environment; a database of its own per builder and per test run).
import { type Db, MongoClient } from "mongodb";
import { config } from "./config.ts";

const cache = globalThis as typeof globalThis & { strataMongo?: MongoClient };

export function mongo(): MongoClient {
  cache.strataMongo ??= new MongoClient(config().mongoUri, {
    appName: "strata",
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
  return cache.strataMongo;
}

// The URI's database, or strata when it names none.
export function db(): Db {
  const name = new URL(config().mongoUri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.replace(/^\//, "");
  return mongo().db(name || "strata");
}

export async function closeMongo(): Promise<void> {
  const client = cache.strataMongo;
  delete cache.strataMongo;
  await client?.close();
}
