// Products: what the team pages are organised by. A product is one or more repositories, each whole or one folder of
// it, so a monorepo can hold several. Products are made automatically, one per repository and named after it, the
// first time the repository is seen (in events as they arrive, or by the backfill from events, approved records and
// summaries); an admin can rename and merge them later, which is why a product has a slug id that never changes and a
// mergedInto that sends old links on.
//
// A product is listed for people only once it has approved work: a repository that so far appears only in someone's
// own events stays theirs, so its name isn't shown to anyone else.
import { MongoServerError } from "mongodb";
import { cache as perRequest } from "react";
import { DEFAULT_ORG } from "../api-auth.ts";
import { events, type ProductDoc, type ProductRepo, products, records, summaryRevisions } from "../collections.ts";
import { reader, type ViewerRef } from "./reader.ts";
import { normalizePath, normalizeRepo, pathWithin, slugCandidates } from "./text.ts";

export interface Product {
  id: string;
  name: string;
  repos: ProductRepo[];
  createdAt: Date;
}

const view = (doc: ProductDoc): Product => ({
  id: doc._id,
  name: doc.name,
  repos: doc.repos.map((r) => ({ repo: r.repo, path: r.path })),
  createdAt: doc.createdAt,
});

export const repoKeyOf = (repo: string, path = ""): string => `${repo}#${normalizePath(path)}`;

// Which product a repository (and a folder in it) belongs to, worked out from the product list in memory.
export interface ProductIndex {
  docs: ProductDoc[];
  // The live product for a repository and folder: the one whose folder is the longest that holds it, or null.
  resolve(repo: string, path?: string | null): string | null;
  // Whether any product of the repository covers only a folder of it (then the folder matters).
  hasFolders(repo: string): boolean;
  // Every repository some product covers.
  repos(): Set<string>;
  // A product, after any merges.
  live(id: string): ProductDoc | null;
  // A live product's id and every id merged into it, for reading rows written under the old ids.
  aliases(id: string): string[];
}

export function indexProducts(docs: ProductDoc[]): ProductIndex {
  const byId = new Map(docs.map((d) => [d._id, d]));
  const byRepo = new Map<string, { path: string; id: string }[]>();
  for (const doc of docs) {
    if (doc.mergedInto) continue;
    for (const r of doc.repos) byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), { path: r.path, id: doc._id }]);
  }
  const live = (id: string): ProductDoc | null => {
    let doc = byId.get(id) ?? null;
    for (let hops = 0; doc?.mergedInto && hops < 10; hops++) doc = byId.get(doc.mergedInto) ?? null;
    return doc && !doc.mergedInto ? doc : null;
  };
  return {
    docs,
    resolve(repo, path) {
      const folder = normalizePath(path);
      let best: { path: string; id: string } | null = null;
      for (const entry of byRepo.get(repo) ?? [])
        if (pathWithin(folder, entry.path) && (!best || entry.path.length > best.path.length)) best = entry;
      return best?.id ?? null;
    },
    hasFolders: (repo) => (byRepo.get(repo) ?? []).some((entry) => entry.path !== ""),
    repos: () => new Set(byRepo.keys()),
    live,
    aliases(id) {
      const target = live(id);
      if (!target) return [];
      return docs.filter((d) => d._id === target._id || live(d._id)?._id === target._id).map((d) => d._id);
    },
  };
}

// The ingest path asks on every batch, so it keeps the list for a minute; a new repository refreshes it at once.
let cached: { at: number; index: ProductIndex } | null = null;
const CACHE_MS = 60_000;

// The products, read once per request (a page asks for them from several hub functions).
const loadIndex = perRequest(async () => indexProducts(await products().find({ org: DEFAULT_ORG }).toArray()));

export async function productIndex({ cache = false } = {}): Promise<ProductIndex> {
  if (cache && cached && Date.now() - cached.at < CACHE_MS) return cached.index;
  const index = await loadIndex();
  cached = { at: Date.now(), index };
  return index;
}

const isDuplicate = (error: unknown): boolean => error instanceof MongoServerError && error.code === 11000;

// One product for a repository no product covers yet, named after it. Safe to race: the repository's key is unique
// across products, so the loser finds the winner's.
async function createProduct(repo: string): Promise<ProductDoc | null> {
  const key = repoKeyOf(repo);
  const candidates = slugCandidates(repo);
  const taken = new Set(
    (
      await products()
        .find({ _id: { $in: candidates } }, { projection: { _id: 1 } })
        .toArray()
    ).map((d) => d._id),
  );
  const name = repo.split("/").at(-1) || repo;
  for (const id of candidates) {
    if (taken.has(id)) continue;
    const now = new Date();
    const doc: ProductDoc = {
      _id: id,
      org: DEFAULT_ORG,
      name,
      repos: [{ repo, path: "" }],
      repoKeys: [key],
      mergedInto: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await products().insertOne(doc);
      return doc;
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      if (await products().findOne({ repoKeys: key })) return null;
      // Someone took the slug in the meantime: try the next.
    }
  }
  return null;
}

// A product for each of these repositories that no product covers yet. Names that aren't repositories are skipped.
// Returns the products it made.
export async function ensureProductsFor(names: Iterable<string | null | undefined>): Promise<Product[]> {
  const repos = new Set<string>();
  for (const name of names) {
    const repo = normalizeRepo(name);
    if (repo) repos.add(repo);
  }
  if (!repos.size) return [];
  let index = await productIndex({ cache: true });
  let missing = [...repos].filter((repo) => !index.repos().has(repo));
  if (!missing.length) return [];
  index = await productIndex();
  missing = missing.filter((repo) => !index.repos().has(repo));
  const made: Product[] = [];
  for (const repo of missing.sort()) {
    const doc = await createProduct(repo);
    if (doc) made.push(view(doc));
  }
  if (missing.length) await productIndex();
  return made;
}

// Every repository seen so far, in events still stored, approved records and summaries, gets its product. Idempotent.
export async function ensureProducts(): Promise<{ created: Product[]; total: number }> {
  const [eventRepos, eventRemotes, recordRepos, summaryRemotes] = await Promise.all([
    events().distinct("scope.project"),
    events().distinct("payload.git.remote", { kind: "session" }),
    records().distinct("scope.project", { status: "approved", "scope.org": DEFAULT_ORG }),
    summaryRevisions().distinct("repo.remote"),
  ]);
  const created = await ensureProductsFor(
    [...eventRepos, ...eventRemotes, ...recordRepos, ...summaryRemotes].map((v) => (typeof v === "string" ? v : null)),
  );
  return { created, total: await products().countDocuments({ org: DEFAULT_ORG, mergedInto: null }) };
}

// The repositories with approved work in them: only their products are shown to people.
export const sharedRepos = perRequest(loadSharedRepos);

async function loadSharedRepos(): Promise<Set<string>> {
  const [recordRepos, summaryRemotes] = await Promise.all([
    records().distinct("scope.project", { status: "approved", "scope.org": DEFAULT_ORG }),
    summaryRevisions().distinct("repo.remote"),
  ]);
  const shared = new Set<string>();
  for (const name of [...recordRepos, ...summaryRemotes]) {
    const repo = normalizeRepo(typeof name === "string" ? name : null);
    if (repo) shared.add(repo);
  }
  return shared;
}

const isShared = (doc: ProductDoc, shared: Set<string>): boolean => doc.repos.some((r) => shared.has(r.repo));

// The products people can see (those with approved work), by name.
export async function listProducts(viewer?: ViewerRef): Promise<Product[]> {
  if (viewer !== undefined && !(await reader(viewer))) return [];
  const [index, shared] = await Promise.all([productIndex(), sharedRepos()]);
  return index.docs
    .filter((doc) => !doc.mergedInto && isShared(doc, shared))
    .map(view)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// One product by its id, after any merge (the product returned may have another id: link there). Null when there's no
// such product, or it has no approved work yet.
export async function getProduct(id: string, viewer?: ViewerRef): Promise<Product | null> {
  if (viewer !== undefined && !(await reader(viewer))) return null;
  const [index, shared] = await Promise.all([productIndex(), sharedRepos()]);
  const doc = index.live(id);
  return doc && isShared(doc, shared) ? view(doc) : null;
}

// The product a repository (any form of its remote) and a folder in it belong to, whether or not it's listed yet.
export async function productFor(repo: string, path?: string | null): Promise<Product | null> {
  const normalized = normalizeRepo(repo);
  if (!normalized) return null;
  const index = await productIndex();
  const id = index.resolve(normalized, path);
  const doc = id ? index.live(id) : null;
  return doc ? view(doc) : null;
}
