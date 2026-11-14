# Strata on MongoDB Atlas

How to point Strata at an Atlas cluster (the hackathon sandbox, or any Atlas project), turn on real embeddings, and
prove that retrieval works end to end. Everything below also runs on Atlas Local
(`mongodb/mongodb-atlas-local:8.0`), which has the same `$vectorSearch`.

## 1. The connection string

In Atlas: **Database → Connect → Drivers**. Copy the `mongodb+srv://` string and put a database name in its path:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.<id>.mongodb.net/strata?retryWrites=true&w=majority&appName=strata
```

- The path (`/strata`) is the database Strata uses. With no path it uses `strata`.
- URL-encode special characters in the password (`@` is `%40`, `/` is `%2F`).
- **Network access.** Atlas refuses connections from addresses that aren't on the project's IP access list:
  **Security → Network Access → Add IP Address**. Add your current address (or `0.0.0.0/0` for a throwaway hackathon
  sandbox only). A timeout of about 5 s on `pnpm db:indexes` almost always means the address isn't on the list.
- The database user needs `readWrite` on the database, and permission to manage Atlas Search indexes (the built-in
  `Atlas admin`, or `readWriteAnyDatabase` on a sandbox, covers it).

Put it in `apps/web/.env.local` (git-ignored). Never in a committed file.

## 2. Embeddings

`MEMORY_AI_PROVIDER` picks the embeddings. Set it in `apps/web/.env.local` next to the key:

| Provider | Model (default)          | Dimensions | Semantic | Key              |
| -------- | ------------------------ | ---------- | -------- | ---------------- |
| `stub`   | `fnv1a-hash`             | 256        | **no**   | none             |
| `voyage` | `voyage-3.5`             | 1024       | yes      | `VOYAGE_API_KEY` |
| `openai` | `text-embedding-3-small` | 1536       | yes      | `OPENAI_API_KEY` |

```
MEMORY_AI_PROVIDER=voyage
VOYAGE_API_KEY=...            # from dash.voyageai.com; never commit it
# optional: MEMORY_EMBED_MODEL=voyage-3.5-lite   MEMORY_EMBED_DIMENSIONS=512
```

- `stub` is the default so tests run offline. Its vectors are hashed words: its "vector search" matches shared words,
  not meaning. `/api/health` and `atlas:check` say so (`semantic: false`).
- Voyage embeds a stored memory with `input_type: "document"` and a recall query with `input_type: "query"`.
- Summaries stay extractive for every provider for now (`summarizer: "extractive-stub"` in `/api/health`).
- Every memory is stamped with `embeddingModel` (`provider:model:dimensions`), and recall's `$vectorSearch` filters on
  the active one, so vectors from two models are never compared. Until memories are re-embedded, recall finds them by
  the text index only.

## 3. Indexes, re-embedding, and the check

From the repository root, with `apps/web/.env.local` in place:

```sh
pnpm db:indexes                          # every collection index, and the vector index at the provider's dimensions
pnpm --filter @strata/web db:reembed     # memories on another model (or none recorded): embedded again; --dry-run to count
pnpm --filter @strata/web atlas:check    # what the database is, and a real round trip through $vectorSearch
```

`db:indexes` makes the vector index (`memories_embedding`) with the provider's `numDimensions` and the filter fields
recall uses (`scope.org`, `scope.project`, `scope.user`, `status`, `expiresAt`, `embeddingModel`). If one already exists
with other dimensions or filters, it updates it in place (Atlas) or, where the server refuses an in-place update of a
vector index (Atlas Local does), drops and recreates it. It prints which it did, and waits until the index is queryable.

`atlas:check` prints:

- the server: Atlas cloud or local, its version, the database and its collections;
- every regular index on `memories` and `handoffs`;
- the embeddings provider, model and dimensions, and whether it's semantic;
- the vector index definition and status, its dimensions against the provider's, and how many memories are on another
  model;
- an end-to-end run: three probe memories in a throwaway scope, embedded by the provider, waited on until searchable,
  searched with the provider's query embedding (results ranked with scores), recalled through the app's own `recall()`,
  then deleted.

It exits non-zero on any failure. With a real provider it also checks a paraphrase ("which tool adds JavaScript
libraries to a project?" must find "Use pnpm to install dependencies"), which only a semantic model passes; with the stub
it skips that check and says why.

## 4. What retrieval may return

Recall and the frozen block read only the scope's **live** memories: the same organisation and person, this project or
every project (`*`), `status: "active"`, and `expiresAt` empty or in the future. The rule is applied inside the
`$vectorSearch` pre-filter (so excluded memories never take a slot in the results), again in a `$match` after it, and in
the text-index fallback. `apps/web/test/vector.db.test.ts` proves it on Atlas Local with memories that are the nearest
vectors there are: expired, superseded, archived, candidate, another person's, another project's, another
organisation's, and another model's memories never come back.

## Proven, and pending

Proven on Atlas Local (`mongodb/mongodb-atlas-local:8.0`, server 8.0.34):

- the vector index is created at the provider's dimensions with every filter field; a wrong-dimension index is detected
  and replaced (drop and recreate, since Atlas Local refuses `updateSearchIndex` on a vector index);
- the `$vectorSearch` pre-filter with `$or` on `expiresAt: null` / `$gt: now` and the `embeddingModel` filter;
- the governance rules above, for both recall and frozen;
- `atlas:check` end to end with the stub provider, and `db:reembed` (dry run, and `--all`);
- the Voyage and OpenAI request shapes, batching, retries, timeouts and errors, against a mocked fetch.

Pending the operator's credentials:

- **Atlas cloud.** Set the `mongodb+srv://` URI, run `pnpm db:indexes` and `atlas:check`. Not yet run against Atlas
  cloud; the in-place `updateSearchIndex` path is only exercised there.
- **A real embeddings key.** Set `MEMORY_AI_PROVIDER=voyage` and `VOYAGE_API_KEY`, then `db:indexes`, `db:reembed`,
  `atlas:check`. No real Voyage or OpenAI request has been made yet: until then, retrieval is the stub's, which is
  lexical, not semantic.
