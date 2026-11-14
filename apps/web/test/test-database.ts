// The database tests run on MONGODB_URI's server (the team's cluster, from .env.local) in a database of their own,
// named here and emptied afterwards, so they never touch the app's data.
import { randomBytes } from "node:crypto";
import type { Db } from "mongodb";

// Points MONGODB_URI at a fresh database named `<prefix>_<tag>` and returns its name. Call it before importing the app.
export function testDatabase(prefix: string): string {
  const base = process.env.MONGODB_URI;
  if (!base) throw new Error("MONGODB_URI isn't set: put it in .env.local at the repository root (README, Run it)");
  const tag = process.env.A6G_NAMESPACE?.replace(/[^a-z0-9]/gi, "_") ?? randomBytes(4).toString("hex");
  const name = `${prefix}_${tag}`;
  process.env.MONGODB_URI = withDatabase(base, name);
  return name;
}

// Removes the test's database, and only that: collection by collection, since the cluster's users may write but not
// drop a database, and a database with no collections is gone.
export async function dropTestDatabase(db: Db, name: string): Promise<void> {
  if (db.databaseName !== name) throw new Error(`not dropping ${db.databaseName}: it isn't this test's database`);
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  await Promise.all(collections.map((c) => db.dropCollection(c.name)));
}

// The same address with its database replaced: after the hosts, before the options.
export function withDatabase(uri: string, name: string): string {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error("MONGODB_URI isn't a mongodb:// or mongodb+srv:// address");
  return `${match[1]}/${name}${match[2] ?? ""}`;
}
