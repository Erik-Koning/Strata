# Strata: architecture

What exists, how the parts talk, and what's next. Every later change reads this first and keeps it true.

## The shape

```
Claude Code ──hooks──▶ clients/claude-code ──▶ local store (queue, summaries, drafts, overview)
                          │  └─ claude -p ──▶ one session summary, written locally
                          └──HTTPS + device token──▶ apps/web /v1 (next) ──▶ MongoDB
OpenCode    ──adapter─▶ clients/claude-code/adapters/opencode (unverified) ─┘
apps/web today: /api/memory/*, Better Auth, the web pages
```

One deployable (`apps/web`) and one database. Only the API touches MongoDB. The web app still serves the memory API
described below; the client was replaced with a summary-first plugin that targets `/v1`. Until those routes exist, the
client runs entirely locally, and `packages/contracts` still describes the memory API, not the summary event.

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
- **Memory clients** send an API key made on the Connect page (`am_…`, shown once, kept as a SHA-256). A key covers
  its own person in the one organisation (`default`) and any project; naming another person or organisation is a 403.
  The summary client uses a device-code sign-in and a bearer token from `/v1/auth/*` once that backend exists.
- **The service token** (`MEMORY_API_TOKEN` in the app's environment) covers every scope: tests, scripts, the
  OpenCode sandbox.

## How memory is made (the memory API)

1. A client sends events (`prompt`, `assistant`, `tool`, `transcript`, `session`, `event`). The API stores each once
   and redacts it again.
2. **Extract** (`server/memory/extract.ts`, inline after ingest for now): a sentence that states a preference, a
   convention, a decision or a fact to remember becomes a memory. What the user said in their own turn is `active`
   and `explicit`. Anything else is a `candidate` (`inferred`) until a person keeps it.
3. Duplicates are caught by `textKey`, a hash of the normalized text within a scope.
4. `memory_save` and "Add a memory" make `active`, `explicit` memories directly.

Still to build, in the brief's order: dedupe beyond identical text, real embeddings, summarize, score and policy as
scheduled jobs (`POST /api/jobs/run`), and the real AI providers behind `server/ai/provider.ts`.

## The Claude Code client

The client is summary-first: it never uploads a prompt or a reply. It keeps a short-lived, redacted queue of turn text,
asks the engineer's own Claude to fold that text into one session summary, deletes the raw text, and sends only the
summary the engineer approved.

| Hook               | What it does                                                                   | Network              |
| ------------------ | ------------------------------------------------------------------------------ | -------------------- |
| `SessionStart`     | Marks the session active; builds the repo overview from local summaries        | none                 |
| `UserPromptSubmit` | Redacts the prompt and keeps it for `Stop`; private and internal payloads skip | none                 |
| `Stop`             | Queues the redacted turn and changed file paths; starts the summarizer         | none                 |
| `PreCompact`       | Summarizes whatever is still queued before the conversation is dropped         | none                 |
| `SessionEnd`       | Summarizes the last queue, then flushes approved summaries                     | upload, if signed in |

**How a summary is made.** `summarize.mjs` runs `claude -p` with a small model, no tools, no MCP, no slash commands,
no session persistence, its own empty working directory and a budget cap. The new work is fenced between random
`BEGIN`/`END` lines so prompt text cannot instruct the model. The reply must be one JSON object; `schema.mjs` then
enforces the field limits and strips tags, code fences, long inline code and secrets no matter what the model said.
Raw queue files are deleted on success, after three attempts, or after three days. A daily cap stops runaway cost.

**The approval gate.** `records.mjs` keeps `session.json`, `summary.json`, `review.json` and `upload.json` per session;
one writer per file and short locks keep the hooks, summarizer, syncer and dashboard from overwriting each other.
Status moves `summarizing → needs-link → draft/updated → ready → synced`, with `rejected` and `local` beside it. A
summary needs a Jira key, a PR, or an explicit "no ticket", and an approval of the exact revision, before it is sent.

**What the client needs from the backend.** The contract is in `clients/claude-code/docs/api-contract.md`: device-code
auth, projects and membership, `POST /v1/events` for approved `session_summary` revisions, `DELETE /v1/sessions/:id`
to retract, and `GET /v1/search` / `GET /v1/rollups` for teammates' approved summaries. The mock server implements it
for tests; `apps/web` does not yet.

## The OpenCode adapter

`clients/claude-code/adapters/opencode/strata.js` maps opencode events (`session.created`, `message.updated`,
`session.idle`, `session.compacted`, `session.deleted`) onto the same hook entrypoint, so capture, redaction,
summarizing, review and sync are shared. The event names are unverified against a live opencode and are the first thing
to check. The Claude Code client is the reference for behaviour.

## Running it

The team's environment (`.a6g/adapters/env.sh`): the app on 9316, MongoDB (`mongodb/mongodb-atlas-local:8.0`) on 9317,
the stub provider (`MEMORY_AI_PROVIDER=stub`). `pnpm test:acceptance` runs the client's hooks, CLI and dashboard as
real processes against its mock server. Production: one container of `apps/web` and MongoDB Atlas (vector and text
search are Atlas features). A Dockerfile and CI are still to write.
