# Strata: architecture

What exists, how the parts talk, and what's next. Every later change reads this first and keeps it true.

## The shape

```
Claude Code ──hooks──▶ clients/claude-code ──HTTPS + bearer key──▶ apps/web (API) ──▶ MongoDB (atlas-local / Atlas)
OpenCode    ──plugin─▶ .opencode/plugins/memory (next) ──────────▶        │
                                                                          └──▶ the web pages (Better Auth sessions)
```

One deployable (`apps/web`) and one database. Only the API touches MongoDB. Both clients share
`packages/contracts`: the zod schemas for every wire shape, `redact` and `renderFrozen`/`renderRecall`.

## The data

| Collection                                   | What                                                                                    | Key indexes                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `memory_events`                              | Raw capture, redacted on the way in; expires after 30 days                              | `id` unique (the idempotency key), TTL          |
| `memories`                                   | `scope{org,project,user}`, kind, text, embedding, provenance, trust, confidence, status | scope+status, text index, vector index, textKey |
| `memory_summaries`                           | Rollups made at a compaction, with the `sourceIds` they came from                       | sessionID, sourceIds                            |
| `memory_audit`                               | Who saved, forgot, compressed, made or revoked what                                     | ts                                              |
| `api_keys`                                   | A person's keys: name, prefix, SHA-256 only, last used, last client                     | hash unique                                     |
| `user`, `session`, `account`, `verification` | Better Auth                                                                             | Better Auth's own                               |

The vector index (`memories_embedding`) is an Atlas Search index filtered on `scope.org`, `scope.project`,
`scope.user` and `status`. `pnpm db:indexes` creates everything and waits until the vector index is queryable.
Recall uses it where it's ready and the text index otherwise.

`scope.project` is the project a memory belongs to, or `*` for every project of that person.

## Who's who

- **People** sign up with an email and a password (Better Auth). A session cookie, `strata.session_token`. Each
  person sees and governs only their own memory.
- **Clients** send an API key made on the Connect page (`am_…`, shown once, kept as a SHA-256). A key covers its own
  person in the one organisation (`default`) and any project; naming another person or organisation is a 403.
- **The service token** (`MEMORY_API_TOKEN` in the app's environment) covers every scope: tests, scripts, the
  OpenCode sandbox.

## How memory is made

1. A client sends events (`prompt`, `assistant`, `tool`, `transcript`, `session`, `event`). The API stores each once
   and redacts it again.
2. **Extract** (`server/memory/extract.ts`, inline after ingest for now): a sentence that states a preference, a
   convention, a decision or a fact to remember becomes a memory. What the user said in their own turn is `active`
   and `explicit`. Anything else is a `candidate` (`inferred`) until a person keeps it.
3. Duplicates are caught by `textKey`, a hash of the normalized text within a scope.
4. `memory_save` and "Add a memory" make `active`, `explicit` memories directly.

Still to build, in the brief's order: dedupe beyond identical text, real embeddings, summarize, score and policy as
scheduled jobs (`POST /api/jobs/run`), and the real AI providers behind `server/ai/provider.ts`.

## The Claude Code client, and the cache

| Hook                            | What it does                                                             | Network                    |
| ------------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| `SessionStart` (startup, clear) | Fetches the frozen block once, keeps it per session, sends it as context | 800 ms, else freezes empty |
| `SessionStart` (resume, fork)   | Sends the kept block byte for byte; none kept means none sent            | none                       |
| `SessionStart` (compact)        | Fetches again: the cache rebuilds at a compaction anyway                 | 800 ms                     |
| `UserPromptSubmit`              | Captures the prompt; adds what recall finds to this prompt only          | 800 ms, fails open         |
| `PostToolUse(Failure)`          | Captures the tool's name and whether it worked, never its content        | none (async)               |
| `PreCompact`                    | Captures the transcript; asks the API to summarize                       | 5 s                        |
| `Stop`, `SessionEnd`            | Captures Claude's last reply; starts the outbox flush in the background  | none                       |

The outbox is one file per event under the plugin's data folder, sent in batches by a detached flusher that holds a
lock, deletes only what the API acknowledged, and backs off on failure. Proven by `pnpm test:acceptance` (the hooks as
real processes), and by a real `claude -p` session on 2026-11-14: the block arrived, the prompt and tools were
captured, `memory_save` worked, and the next session answered from memory.

## The OpenCode plugin (next)

The brief fixes its files and rules. Its sketch (`Plugin.define`, `ctx.session.hook`, `ctx.storage`) is shorthand:
map each piece onto the real `@opencode-ai/plugin` API and record the mapping here before building. The Claude Code
client is the reference for behaviour; the contracts are shared.

## Running it

The team's environment (`.a6g/adapters/env.sh`): the app on 9316, MongoDB (`mongodb/mongodb-atlas-local:8.0`) on 9317,
the stub provider (`MEMORY_AI_PROVIDER=stub`). Production: one container of `apps/web` and MongoDB Atlas (vector and
text search are Atlas features). A Dockerfile and CI are still to write.
