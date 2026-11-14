# Brief

<!-- The operator's direction, in their words: as short or as long as the project needs. The setup agent writes it
from the interview; the operator can rewrite it at any time. Whatever it leaves open, the team decides and logs. -->

## What should exist when the team is done

We need to make opencode extension, latest version, backend full stack nextjs app, MongoDB connected for agentic memory! 

# opencode-memory: OpenCode V2 plugin

GOAL
Thin V2 server plugin: capture session activity, send it to our web app API, inject recalled memory without breaking prompt cache. Only the API touches MongoDB.

RULES
1. Cache: bytes already sent in a session never change.
 - Frozen block: fetched once per session, persisted in ctx.storage, pushed as LAST system entry, byte-identical every request. Render sorted by _id, no timestamps. On fetch failure or existing history: freeze empty.
 - Per-turn recall is appended only to the new prompt text. Never edit system, old messages or tool list mid-session.
 - Re-fetch frozen block only in the compaction hook (cache rebuilds there).
2. Network only in prompt (800ms, fail open) and compaction (5s, else default). context reads ctx.storage only.
3. Writes go through a durable outbox with idempotency keys.
4. Redact secrets before enqueue and again on server. Token from env.

FILES .opencode/plugins/memory/
index.ts, api.ts, outbox.ts (ctx.storage "ob:<ulid>", batch, backoff), freeze.ts ("fz:<sessionID>"), render.ts, redact.ts, tools.ts (memory_search/save/forget)

index.ts
import { Plugin } from "@opencode/plugin"
export default Plugin.define({
 id: "memory",
 async setup(ctx) {
  const api = makeApi(ctx.options)
  const ob = makeOutbox(ctx.storage, api)
  const fz = makeFreeze(ctx.storage, api)
  await ctx.session.hook("prompt", async (e) => {
   await fz.ensure(e.sessionID)
   const hits = await api.recall(e.sessionID, e.prompt.text, 800)
   if (hits.length) e.prompt.text += "\n\n<memory>\n" + render(hits) + "\n</memory>"
  })
  await ctx.session.hook("context", async (e) => {
   const b = await fz.get(e.sessionID) // no network
   if (b) e.system.push({ type: "text", text: b })
  })
  await ctx.session.hook("compaction", async (e) => {
   ob.enqueue({ kind: "transcript", sessionID: e.sessionID, messages: e.messages })
   const s = await api.compress(e.sessionID, e.messages, 5000)
   if (s) e.result = { summary: s }
   await fz.refresh(e.sessionID)
  })
  await ctx.tool.hook("execute.after", (e) =>
   ob.enqueue({ kind: "tool", tool: e.tool, status: e.status }))
  await ctx.tool.transform((ed) => registerTools(ed, api))
  const ac = new AbortController()
  void (async () => {
   for await (const ev of ctx.event.subscribe({ types: MSG_TYPES, signal: ac.signal }))
    ob.enqueue({ kind: "event", ev })
  })()
  const t = setInterval(() => ob.flush(), 5000)
  return () => { ac.abort(); clearInterval(t) }
 },
})

API
POST /memory/events {batch:[{id,sessionID,scope,kind,payload,ts}]} -> 202, dedupe on id
POST /memory/recall {sessionID,scope,query,k} -> {memories:[{_id,kind,text}]}
GET /memory/frozen ?sessionID&scope -> {memories}
POST /memory/compress {sessionID,messages} -> {summary}
POST /memory/forget {ids|query,scope}, cascades to summaries

MONGO
memory_events: raw, unique id, TTL
memories: scope{org,project,user}, kind, text, embedding, provenance{sessionID,messageID,source}, trust, confidence, status(candidate|active|superseded|archived), supersedes, expiresAt
memory_summaries: rollups, sourceIds[]
memory_audit: actor, action, targetIds, ts
Indexes: vector on embedding filtered by scope+status; text on text

BUILD ORDER
1 schemas + API stubs 2 outbox + capture + ingest 3 freeze + context inject 4 prompt recall 5 compaction 6 tools 7 workers: extract > dedupe > embed > summarize > score > policy 8 governance UI + forget cascade

VERIFY IN SOURCE FIRST
- hook event field names (sessionID, messages)
- do prompt.text edits show in the TUI? if so use a hidden part
- event type names for MSG_TYPES; hook timeouts
- editor.add input schema, execute return shape

ACCEPTANCE
- cache-read tokens do not drop after turn 2
- system bytes identical across requests and restart
- API down: prompts proceed, outbox drains later, no dupes
- only user-turn content auto-promotes to active

## The operator's decisions, 2026-11-14

These come after everything above and win where they differ.

- **The product is called Strata.** The GitHub repository is `Erik-Koning/Strata`; the team's name and folders keep
  `agentic-memory`.
- **A Claude Code client, alongside the OpenCode plugin:** `clients/claude-code`, a Claude Code plugin (hooks, an MCP
  server for the three tools, a marketplace at the repository's root). It is built and tested; it's the reference for
  how a client keeps the cache rules. The OpenCode plugin is still to build, on the same API and contracts.
- **People have accounts** (Better Auth, email and password) and **API keys** made on the Connect page. Each person
  governs their own memory. This replaces the proposal of one admin role signing in with a token.
- **The foundation is agreed:** the operator asked for the scaffold (auth, the MongoDB connection, the API, the Claude
  Code client) and it was built to `docs/architecture.md`, which the team keeps true. There is no design check-in to
  hold (`operator.designCheckIn` is off); features start from here.
- **The operator pushes to GitHub themselves.** The team still pushes nothing (`push: null`).

## How done is proven

`.a6g/adapters/finish.sh done` (team.json `finish`), all of it together:

- the full gate (what CI runs: install, typecheck, lint, unit tests, database tests, build) passes on the integration
  branch as it is now;
- the end-to-end suite passed at the branch's head and every journey has a passing spec (`a6g e2e done`);
- every page the harness lists passes its checks at every viewport and colour scheme (`a6g pages done`);
- the acceptance list above is covered by tests the team can run without a real model provider, and they pass
  (`pnpm test:acceptance`, once it exists): the frozen block's bytes identical across requests and across a restart of
  the plugin host; with the API down, a prompt proceeds and the outbox drains later with no duplicate event; only
  user-turn content promotes to `active` on its own. "Cache-read tokens do not drop after turn 2" needs a real
  provider and real sessions: the team writes the check as a script the operator runs with their own key
  (`scripts/check-cache.ts` or similar) and records how to read its result; it isn't part of the finish line;
- nothing is open in the task graph.

The eight steps of the build order are the natural journeys; the planner lays them out as journey tasks in that
order, since each depends on the one before.

## Budget

None given here. The factory applies the budget the operator chose when they started the team (`a6g budget`); this
brief's guidance for the planner is only to spend where the acceptance list is at stake first (cache correctness, the
outbox, redaction) and polish the governance UI last.

## What the team decides itself

Anything this brief leaves open, within the team's rules: the planner works out what fits the brief and the direction
(`direction.md`) best, decides, and records why in `decisions.md`. The team works on the branch `a6g/next` on this
machine only; nothing is pushed. The operator merges it.

## Foundation

Nothing was built when the team was set up: the repository held a README with the goal above. The adapters
(`.a6g/adapters/`) and the notes were written to the proposal below; the scaffolder completes and records the design
(`docs/architecture.md`) and puts it to the operator at the design check-in before any feature is built. It may change
a proposal, with its reason recorded; it may not change what the operator fixed.

### What the operator fixed

- An OpenCode plugin on the latest plugin API, at `.opencode/plugins/memory/` with the files named above
  (`index.ts`, `api.ts`, `outbox.ts`, `freeze.ts`, `render.ts`, `redact.ts`, `tools.ts`) and the tools
  `memory_search`, `memory_save`, `memory_forget`. "Thin": capture, send, inject; no storage logic of its own.
- A full-stack Next.js web app as the backend, with the API above (`/memory/events`, `/memory/recall`,
  `/memory/frozen`, `/memory/compress`, `/memory/forget`) and a governance UI.
- MongoDB as the store, and only the API touches it: the four collections, their fields and their indexes as listed,
  including a vector index on `embedding` filtered by scope and status, and a text index on `text`.
- The four rules (the cache, the network windows, the durable outbox with idempotency keys, redaction on both sides
  with the token from the environment), the build order, the "verify in source first" list and the acceptance list.

### What the team proposes

Each line: the proposal, why, and what else was weighed. Costs are per month at a single-team scale.

- **Where it runs.** For the team: this Mac, on its own ports and its own MongoDB in Docker; the team deploys
  nothing. For production, the shape that costs least to own: one container image of the web app on any Node host
  (a small VPS at roughly $5–20, or Vercel's hobby/pro tier) and MongoDB Atlas for the database (its M0 tier is free;
  a Flex cluster is about $8 and up). Atlas because the vector and text indexes the operator named are Atlas Search
  features; weighed: self-hosting MongoDB with a separate vector store (two services to run, and a second index to
  keep consistent).
- **Its shape.** One deployable and one database. The workers (extract, dedupe, embed, summarize, score, policy) run
  inside the web app as a job pipeline over `memory_events`, triggered by a protected route (`POST /api/jobs/run`) that
  a scheduler calls (an interval in development, the host's cron in production). Weighed: a separate worker process
  (a second deployable with nothing to gain at this scale) and a queue service such as BullMQ on Redis (a third thing
  to run; the outbox and `memory_events` with idempotent ids already give the durability it would).
- **The data.** MongoDB 8 through the official `mongodb` Node driver, with `zod` schemas for every document and every
  wire shape, shared between the app and the plugin from one package. Indexes are created by one idempotent script
  (`pnpm db:indexes`) that the environment runs at start and production runs on release. Locally and in tests, the
  `mongodb/mongodb-atlas-local` image, which runs Atlas Search and `$vectorSearch` on the same engine production will
  use, so the recall path is tested as it ships. Weighed: Mongoose (hides index semantics the brief cares about) and a
  plain `mongo` image (no vector search, so recall would need a stand-in that production never runs).
- **Every edge.** The plugin reaches the API over HTTPS with a bearer token (`MEMORY_API_TOKEN`) from the
  environment, and names its scope (`org`, `project`, `user`) in each request; the API rejects a request whose scope
  the token doesn't cover. The governance UI is for the people who run the memory service: it signs in with a token
  exchanged for an httpOnly session cookie, one role (admin), no user accounts. Weighed: OAuth or an accounts
  library (identities nobody asked for; added when a second kind of user exists) and no sign-in on the UI at all
  (it shows and deletes other people's memories).
- **AI providers.** Embeddings and the compress/summarize/extract calls go through one interface
  (`lib/ai/provider.ts`) chosen by `MEMORY_AI_PROVIDER`. `stub` is the default everywhere the team runs: a
  deterministic embedder (hashing into a fixed dimension) and an extractive summarizer, so every test runs without a
  key and the same input always gives the same vector. Real providers are implemented behind the same interface
  (OpenAI `text-embedding-3-small` for embeddings; Anthropic for compress and extract were the obvious first two) and
  need the operator's keys, which stay theirs. Weighed: a local model (slow on a laptop, another thing to install).
- **The stack.** TypeScript (strict) on Node 24 LTS, which this Mac runs; pnpm 10 with a workspace: `apps/web`
  (Next.js at its current stable release, App Router, Tailwind), `.opencode/plugins/memory` (the plugin, loaded as
  TypeScript by OpenCode, so it needs no build step; typechecked and unit-tested like the rest) and
  `packages/contracts` (the shared `zod` schemas and the API client types). Vitest for unit, database and API tests;
  Biome for lint and format; Playwright for the end-to-end suite (the scaffolder's). Weighed: one package with
  everything in it (the plugin would then depend on the whole app's dependency tree) and Bun as the runtime (OpenCode
  itself runs on Bun, but the API is a Next.js app and Node is what the hosts run).
- **Keys and settings.** Settings from the environment, validated with `zod` at start, with `.env.example` naming
  every variable and holding no value. The team's own `MEMORY_API_TOKEN` is generated by the environment script into
  `.a6g/run/env/app.env` (never committed). Nothing in the repository ever holds a real key.
- **How it ships.** A multi-stage `Dockerfile` for `apps/web` (production dependencies only, not root, a health
  check on `/api/health`), `pnpm db:indexes` on release, and a GitHub Actions workflow that runs exactly what the
  gate runs plus the end-to-end suite against the Atlas-local service container. It deploys nothing; it works the
  day the operator pushes.
- **Testing the plugin without the operator's OpenCode.** A fake plugin host in the test suite drives the plugin's
  hooks directly (that's where the acceptance tests live), and `scripts/oc-sandbox.sh` runs a real `opencode` with
  `XDG_DATA_HOME` and `XDG_CONFIG_HOME` under `.a6g/run/opencode/` and a stub OpenAI-compatible provider on the
  team's port 9318, so an end-to-end run never touches the operator's sessions or keys.
- **Keeping it running.** Written down in `docs/architecture.md` by the scaffolder: `mongodump` of the database and
  the restore that proves it, the host's HTTPS, the health route and readable logs, and Dependabot for pnpm.

## Assumed in place of an answer

The operator wasn't at this machine, so each row of the setup interview was settled the way it would have been
recommended. One line each; change any of them in `team.json` or here.

- **Foundation:** proposed above; the operator fixed only what the goal names. Nothing else about the platform or the
  stack was asked.
- **Check-in:** held (`operator.designCheckIn: true`, from the form): the scaffolder builds the skeleton and the
  harness, writes `docs/architecture.md`, and the planner asks the operator to agree it before features start.
- **How it works:** a finish line (`mode: finish`, from the form), not open-ended cycles.
- **Finish line:** as "How done is proven" says. The cache-read-token acceptance item needs a real provider and is left
  to the operator's own run of the team's script.
- **Scope:** the whole repository except the factory's files.
- **Team:** planner, 2 builders, 1 reviewer, an approver, a scaffolder (the skeleton and the harness), a UX
  specialist (the governance UI) and a security reviewer (an API of its own, a bearer token, redaction, and a forget
  that deletes). No tester: the scaffolder claims test tasks, and the acceptance tests are the plugin's own.
- **Budget:** none here; the factory applies the one chosen on the form.
- **Branch:** `a6g/next` from `main`, never pushed (`push: null`). No pull request.
- **Board:** the task graph in MongoDB (from the form), where the web app reads it.
- **Data:** made-up data only, no real keys: the stub AI provider, the team's own MongoDB, and OpenCode only through
  the sandbox. The `never` rules in `team.json` hold the last three.
- **Contact:** `owner` is the account that started the team, `erik@ridenet.ca`, so the planner's messages have
  somewhere to go; the default digest (one message per 4 hours, done always at once). The working agreement
  (`a6g agreement agentic-memory`) changes how readily the team asks.
- **Taste:** `rubric.md`, written here for the governance UI; no style guide exists yet. The scaffolder's skeleton sets
  the tokens.
- **Dependencies:** the team may add packages (`dependencies` allowed, the default); `secrets` allowed (the team
  generates its own `MEMORY_API_TOKEN` into its run folder).
- **Approval:** the approver up to size M; larger proposals go to the operator (from the form).
- **Machines:** one.
- **Critical:** the plugin's cache files (`freeze`, `render`, `outbox`, `redact`, `api`), every `/api/memory` route,
  forget and governance, the schemas and indexes, the workers, anything named auth/session/token, the Dockerfile and
  the CI workflows.
- **Security:** the factory's list, plus every API route, the plugin's `api.ts` and `redact.ts`, every redaction file
  and the OpenCode sandbox script.
- **Policies:** everything outward denied: deploy, cloud, hosted-data (so no Atlas, and no connection to the Mongo
  that holds the team's own tasks), publish (the plugin isn't published to npm), github, messages, payments.
- **Docker:** two engines run on this Mac (colima and rancher-desktop). `a6g register` chooses the team's; until
  then, `a6g check --run` started the team's MongoDB container on the default context, so a stopped copy may be left
  there (`docker --context <name> rm agentic-memory-a6g-mongo` removes it).
