# Notes for the team

<!-- What any member needs to know to work in this repository: the team's environment and ports, the commands that
matter, conventions and traps. Facts about rules (limits, lanes, policies) live in team.json, not here. -->

Nothing was built when the team was set up. `brief.md` holds the goal and the foundation (what the operator fixed,
what the team proposes); the scaffolder builds the skeleton to the contract below and records the design in
`docs/architecture.md`, which every later member reads first once it exists.

## The team's environment (`a6g env up`, planner only)

`a6g env status` shows it. Only the planner starts, resets and stops it (`a6g env up|reset|down`); anyone runs status.
State is in `.a6g/run/env/` in the team's checkout (`/Users/hubb/code/agentic-memory-a6g`).

| What                 | Where                                                            | Notes                                                                   |
| -------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The web app          | http://localhost:9316 (`A6G_APP_PORT`), health `/api/health`     | `pnpm dev` with `PORT=9316`; a placeholder until the skeleton has `dev` |
| MongoDB              | `mongodb://localhost:9317/agentic_memory?directConnection=true`  | Docker container `agentic-memory-a6g-mongo`, image `mongodb/mongodb-atlas-local:8.0` (Atlas Search and `$vectorSearch` work), volume `agentic-memory-a6g-mongo`, no auth, bound to 127.0.0.1 |
| Stub AI provider     | port 9318 is reserved for it                                      | OpenAI-compatible, for the OpenCode sandbox; the scaffolder sets it up  |
| The app's settings   | `.a6g/run/env/app.env` in the team's checkout                     | `MEMORY_API_TOKEN` generated once by `env.sh`; never committed          |

- `a6g env reset` removes the MongoDB container and its volume, starts a fresh one, recreates the indexes
  (`pnpm db:indexes`) and seeds (`pnpm db:seed`, once it exists). `a6g env restart` (what after-merge runs) restarts
  only the app; MongoDB keeps running.
- Builders preview their own branch on a port of their own (`PORT=<port> pnpm dev` in their worktree) against the same
  MongoDB, in a database of their own (`MONGODB_URI=mongodb://localhost:9317/<your-branch>?directConnection=true`).
  Never start another MongoDB.
- The environment runs with `MEMORY_AI_PROVIDER=stub`: embeddings are deterministic (a hash into a fixed dimension),
  summaries extractive. No real model key exists in the team's environment, and the guard refuses one in a command.

## The contract the adapters expect (the scaffolder keeps it)

The gate, the environment and the finish line call scripts by name from the root `package.json`; the skeleton provides
them whatever it's built on. A script that doesn't exist yet is skipped with a line, so the checks pass today and
prove the real thing as soon as it's there.

| Script            | Runs                                                                                   | Where it runs                 |
| ----------------- | -------------------------------------------------------------------------------------- | ----------------------------- |
| `typecheck`       | `tsc --noEmit` across the workspace (app, plugin, contracts)                           | gate (quick and full)         |
| `lint`            | Biome in check mode (lint and format), read-only                                       | gate (quick and full)         |
| `test`            | unit tests (Vitest): no database, no network                                           | gate (quick and full)         |
| `test:db`         | database and API tests against `MONGODB_URI`, in a database named after `A6G_NAMESPACE` (or a random one), dropped afterwards | gate (full); needs the team's MongoDB up |
| `test:acceptance` | the brief's acceptance list, driven through the fake plugin host                       | finish line                   |
| `build`           | `next build`                                                                           | gate (full)                   |
| `dev`             | serves the app on `PORT` with hot reload                                                | `env.sh up`                   |
| `db:indexes`      | creates every collection index and search index, idempotently, on `MONGODB_URI`        | `env.sh up` and `reset`       |
| `db:seed`         | made-up data for the governance UI and the harness, under a namespace                  | `env.sh reset` (optional)     |

Environment variables the app reads: `PORT`, `MONGODB_URI`, `MEMORY_API_TOKEN`, `MEMORY_AI_PROVIDER` (and the
provider's own key names, unset here). The plugin reads `MEMORY_API_URL` and `MEMORY_API_TOKEN`. Every name goes in
`.env.example` with no value.

## Commands

- The gate, as CI will run it: `a6g gate` (full) and `a6g gate --quick` (install, typecheck, lint, unit tests). Builders
  pass the quick gate before finishing; the merge queue runs the full one.
- Package manager: pnpm (`pnpm-lock.yaml` committed; the gate installs with `--frozen-lockfile`). If pnpm isn't on
  your PATH, it's in `~/Library/pnpm` or `/opt/homebrew/bin`; node is `~/.nvm/versions/node/v24.*/bin/node`.
- OpenCode: never bare `opencode run|serve|…` (the guard refuses it: that's the operator's own OpenCode, keys and
  sessions). Use `scripts/oc-sandbox.sh <opencode args>` once the scaffolder has written it: it sets `XDG_DATA_HOME`
  and `XDG_CONFIG_HOME` to `.a6g/run/opencode/{data,config}` in your worktree, points the provider at the stub on
  9318, and loads the plugin from this repository's `.opencode/plugins/`. Reading OpenCode's source to verify the
  plugin API means the `opencode` and `@opencode-ai/plugin` packages in `node_modules`, or a clone under
  `.a6g/run/`, never `~/.config/opencode` or `~/.local/share/opencode`.
- Docker: only the team's own containers (`agentic-memory-a6g-*`), normally only through `a6g env`. Other teams'
  containers run on this Mac; `docker … prune` and `docker stop|rm` of anything else are refused.

## Conventions (until `docs/architecture.md` and `CLAUDE.md` say more)

- Workspace: `apps/web` (Next.js, App Router), `.opencode/plugins/memory` (the plugin), `packages/contracts`
  (`zod` schemas for every document and every wire shape; both sides import from it, nothing is typed twice).
- Modules by what they do (`memory/ingest`, `memory/recall`, `memory/forget`, `jobs/…`), not by layer.
- Every API route validates its body with the contract's schema at the edge, answers in one envelope shape, and
  returns 401 for a missing or wrong token before it reads anything. Idempotency: `POST /memory/events` dedupes on
  each event's `id` (a unique index), and answers 202 whether or not the id was new.
- Rendering of the frozen block is a pure function of the memories sorted by `_id`, with no timestamps and no
  counters, so the same memories give the same bytes on every request and after a restart. Test it by bytes.
- Redaction is one shared function (`redact.ts` in the contracts, used by the plugin before enqueue and by the API on
  ingest); its patterns and tests live together.

## Traps

- **The prompt cache is the product.** Anything in the plugin that changes bytes already sent (system, old messages,
  the tool list) mid-session breaks it, however small. Per-turn recall goes only into the new prompt's text; the frozen
  block changes only in the compaction hook. The reviewer checks every plugin change against this first.
- **The brief's plugin sketch is a target, not the API.** `Plugin.define`, `ctx.storage`, `ctx.session.hook(...)` and
  the hook names are the operator's shorthand for what the plugin does; the real plugin API is whatever the pinned
  `@opencode-ai/plugin` exports (`npm view @opencode-ai/plugin version`, then its types and OpenCode's source).
  Map each piece (a last system entry, a prompt-text append, the compaction hook, tools, the event stream, per-plugin
  storage) onto what exists, verify the event field names, hook timeouts and whether prompt edits show in the TUI as
  the brief asks, and write the mapping in `docs/architecture.md`. Where OpenCode has no per-plugin storage, the
  plugin keeps `ob:*` and `fz:*` in a file under OpenCode's data directory (XDG) for the project.
- **Atlas-local search indexes are eventually consistent.** `createSearchIndex` returns before the index is
  queryable; `db:indexes` and the database tests poll `$listSearchIndexes` for `queryable: true` before searching, or
  the first `$vectorSearch` returns nothing and a test flakes. The container takes 15–30 s after start before search
  is ready; `env.sh` waits for its health check.
- **Two Docker engines run on this Mac.** After `a6g register`, the factory sets `DOCKER_HOST` to the team's engine for
  everything it runs; a `docker` you run yourself without it may land on the other engine and not see the team's
  container. Prefer `a6g env status`.
- **Vitest and Next.js in one workspace:** keep Vitest's config per package, and never let the app's tests import from
  the plugin's package (it targets OpenCode's runtime) except through `packages/contracts`.
- **No real provider anywhere in the team's runs.** A test that needs an embedding uses the stub; a feature that only
  a real model can prove (the cache-read-token acceptance item) gets a script the operator runs, documented, not a
  test that's skipped.
