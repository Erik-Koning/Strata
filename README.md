# Strata

Long-term memory for coding agents. Strata captures what happens in your Claude Code sessions, keeps what's worth
remembering, and gives it back to the next session without breaking the prompt cache. Compacted summaries sit on top,
so a long history stays small.

- **The web app** (`apps/web`): the API every client talks to, the only thing that touches MongoDB, and the place you
  see what's remembered, keep or forget it, and connect your clients. Next.js 16, Better Auth, MongoDB.
- **The Claude Code plugin** (`clients/claude-code`): hooks that capture each session into a durable outbox, give
  Claude a frozen block of memory when a session starts, recall what matches each prompt, and three tools
  (`memory_search`, `memory_save`, `memory_forget`).
- **The contracts** (`packages/contracts`): every wire shape (zod), and the two pure functions both sides must agree
  on, redaction and rendering.
- **The OpenCode plugin** (`.opencode/plugins/memory`): next, on the same API. See `.a6g/brief.md`.

## The rule everything follows

**Bytes already sent in a session never change.** The frozen block is fetched once when a session starts, rendered
sorted by id with no timestamps, and kept byte for byte until the session compacts. Each prompt's recall is added to
that prompt only. Nothing already sent is edited. So the provider's prompt cache holds, turn after turn.

The other rules: a prompt never waits more than 800 ms for memory, and goes ahead without it. Every capture goes
through an outbox, keyed so a retry never stores anything twice. Secrets are redacted before anything is queued, and
again on the server. Only what you said in your own turn becomes an active memory on its own. Anything else is a
candidate until you keep it.

## Run it

You need Node 24, pnpm and Docker.

```sh
pnpm install
docker run -d --name strata-mongo -p 127.0.0.1:27017:27017 mongodb/mongodb-atlas-local:8.0
cp .env.example apps/web/.env.local   # then set MONGODB_URI=mongodb://localhost:27017/strata?directConnection=true
pnpm db:indexes
pnpm dev                              # http://localhost:9316 by default (PORT)
```

Create an account, then open **Connect**: make an API key, install the plugin, and start a Claude Code session.

```
/plugin marketplace add Erik-Koning/Strata
/plugin install strata@strata
```

Set `MEMORY_API_URL` and `MEMORY_API_TOKEN` (the key) in `~/.claude/settings.json` under `env`, or answer the
plugin's two questions when you enable it. More in [`clients/claude-code/README.md`](clients/claude-code/README.md).

## The API

Every route takes `Authorization: Bearer <key>` and answers `{ error: { code, message } }` when it fails. The scope
is `{ project }`; the organisation and the person come from the key.

| Route                       | Body                                                       | Answer                                          |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `POST /api/memory/events`   | `{ batch: [{ id, sessionID, scope, kind, payload, ts }] }` | 202 `{ accepted, duplicates }`, deduped on `id` |
| `POST /api/memory/recall`   | `{ sessionID, scope, query, k }`                           | `{ memories: [{ _id, kind, text }] }`           |
| `GET /api/memory/frozen`    | `?sessionID&project`                                       | `{ memories }`, the same for the same data      |
| `POST /api/memory/compress` | `{ sessionID, scope, messages }`                           | `{ summary }`                                   |
| `POST /api/memory/forget`   | `{ scope, ids \| query, dryRun? }`                         | what went: memories, summaries, events          |
| `POST /api/memory/save`     | `{ scope, text, kind }`                                    | 201 `{ memory }`                                |
| `GET /api/health`           |                                                            | `{ ok, db, search }`                            |

## Develop

| Command                | What it runs                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `pnpm typecheck`       | TypeScript across the workspace                                      |
| `pnpm lint`            | Biome (lint and format), read-only. `pnpm format` fixes              |
| `pnpm test`            | Unit tests: no database, no network                                  |
| `pnpm test:db`         | API and database tests on a database of their own on `MONGODB_URI`   |
| `pnpm test:acceptance` | The plugin's hooks as real processes against a fake API              |
| `pnpm build`           | The plugin's bundles (`clients/claude-code/dist`), then `next build` |
| `pnpm db:indexes`      | Every index, the vector index included, idempotently                 |
| `pnpm db:seed`         | Made-up memories for the pages                                       |

Embeddings and summaries go through one interface (`apps/web/server/ai/provider.ts`). The default, `stub`, is
deterministic and offline, so every test runs without a key. How it fits together: [`docs/architecture.md`](docs/architecture.md).

Built by an [Anything Factory](https://github.com/Erik-Koning/Anything-Factory) team; its rules and brief are in
`.a6g/`.
