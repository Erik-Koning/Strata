# Strata: architecture

What exists, how the parts talk, and what's next. Every later change reads this first and keeps it true.

## The shape

```
Claude Code ──hooks──▶ clients/claude-code ──▶ local store (queue, summaries, drafts, overview)
                          │  └─ claude -p ──▶ one session summary, written locally
                          └──HTTPS + device token──▶ apps/web /v1 ──▶ MongoDB
OpenCode    ──adapter─▶ clients/claude-code/adapters/opencode (unverified) ─┘
apps/web: /api/memory/* (contract v1), /v1 summaries, Better Auth, the web pages
```

One deployable (`apps/web`) and one database. Only the API touches MongoDB. The web app serves the memory API and its
versioned event contract (below), plus the `/v1` summary API the new client targets. `packages/contracts` defines the
memory event contract; the plugin carries its own summary schema for now.

## The data

| Collection                                   | What                                                                                        | Key indexes                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `memory_events`                              | Raw capture, redacted on the way in, with its contract version; expires after 30 days       | `id` unique (the idempotency key), TTL          |
| `memories`                                   | `scope{org,project,user}`, kind, text, embedding, provenance, trust, confidence, status     | scope+status, text index, vector index, textKey |
| `memory_summaries`                           | Rollups made at a compaction, with the `sourceIds` they came from                           | sessionID, sourceIds                            |
| `memory_audit`                               | Who saved, forgot, compressed, made or revoked what                                         | ts                                              |
| `api_keys`                                   | A person's keys: name, prefix, SHA-256 only, last used, last client                         | hash unique                                     |
| `projects`, `project_members`                | The summary API's projects and who belongs to them; one personal default per person         | one default per user, membership unique         |
| `summary_revisions`                          | Approved session summaries, one document per revision; the highest is current               | idempotency, (user, session, revision), project |
| `records`                                    | Drafted summaries, insights, workflow findings, pain points and gaps; approved or discarded | author/status, session, dedupe key              |
| `deviceCode`                                 | Better Auth's device-authorization codes for `/strata:login`                                | Better Auth's own                               |
| `user`, `session`, `account`, `verification` | Better Auth                                                                                 | Better Auth's own                               |

The vector index (`memories_embedding`) is an Atlas Search index filtered on `scope.org`, `scope.project`,
`scope.user` and `status`. `pnpm db:indexes` creates everything and waits until the vector index is queryable.
Recall uses it where it's ready and the text index otherwise.

`scope.project` is the project a memory belongs to, or `*` for every project of that person.

## Who's who

- **People** sign up with an email and a password (Better Auth). A session cookie, `strata.session_token`. Each
  person sees and governs only their own memory.
- **Memory clients** send an API key made on the Connect page (`am_…`, shown once, kept as a SHA-256). A key covers
  its own person in the one organisation (`default`) and any project; naming another person or organisation is a 403.
  The summary client uses a device-code sign-in and a bearer token from `/v1/auth/*`.
- **The service token** (`MEMORY_API_TOKEN` in the app's environment) covers every scope: tests, scripts, the
  OpenCode sandbox.

## How memory is made (the memory API)

1. A client sends events (`prompt`, `assistant`, `tool`, `transcript`, `session`, `event`, `finding`). The API checks
   each on its own, stores each once and redacts it again. What each kind carries is below, under the contract.
2. **Extract** (`server/memory/extract.ts`, inline after ingest for now): a sentence that states a preference, a
   convention, a decision or a fact to remember becomes a memory. What the user said in their own turn is `active`
   and `explicit`. Anything else is a `candidate` (`inferred`) until a person keeps it.
3. Duplicates are caught by `textKey`, a hash of the normalized text within a scope.
4. `memory_save` and "Add a memory" make `active`, `explicit` memories directly.

Still to build, in the brief's order: dedupe beyond identical text, real embeddings, summarize, score and policy as
scheduled jobs (`POST /api/jobs/run`), and the real AI providers behind `server/ai/provider.ts`.

## The Claude Code client

The client has two write paths. It emits contract-v1 events to the memory API (prompt, assistant, tool, transcript,
session and finding), from which the server drafts records for review. It also keeps the local summary path: the
engineer's own Claude folds each turn into one summary, and only the approved summary goes to `/v1`.

| Hook                                | What it does                                                                      | Network              |
| ----------------------------------- | --------------------------------------------------------------------------------- | -------------------- |
| `SessionStart`                      | Marks the session active; queues the session start with git/refs; builds overview | none                 |
| `UserPromptSubmit`                  | Redacts the prompt, queues it as a prompt event, keeps it for `Stop`              | none                 |
| `PostToolUse`, `PostToolUseFailure` | Queues the tool name, status, duration and command signal; never its content      | none (async)         |
| `Stop`                              | Queues the assistant reply and any context change; starts the local summarizer    | none                 |
| `PreCompact`                        | Queues the transcript; summarizes whatever is still queued                        | none                 |
| `PostCompact`                       | Queues the compaction summary                                                     | none                 |
| `SessionEnd`                        | Queues the session end; flushes events and approved summaries                     | upload, if signed in |

Events go to a durable outbox (`events/`), one file each, stamped `v: 1`; a detached flusher sends them in batches
and deletes only what the server accepted. `events/` is separate from the local summary store, so either path can
fail without losing the other.

**How a summary is made.** `summarize.mjs` runs `claude -p` with a small model, no tools, no MCP, no slash commands,
no session persistence, its own empty working directory and a budget cap. The new work is fenced between random
`BEGIN`/`END` lines so prompt text cannot instruct the model. The reply must be one JSON object; `schema.mjs` then
enforces the field limits and strips tags, code fences, long inline code and secrets no matter what the model said.
Raw queue files are deleted on success, after three attempts, or after three days. A daily cap stops runaway cost.

## The contract, and how it changes

`packages/contracts` is the one definition of what crosses the wire. Clients will be installed on machines the team
doesn't control and updated whenever their owners get round to it, so the contract is built to grow without a flag
day. The rules:

1. **Every event carries its contract version**, `v` (`version.ts`; now 1, and 1 when absent, which is how the first
   plugins wrote). The API states the versions it accepts in `GET /api/health`.
2. **Within a version the contract only grows**: a new optional field, a new event kind, a new value in an open list.
   Nothing is renamed, removed, retyped or made required; that's a new version, and the API then keeps an upgrader
   from each older version it still accepts.
3. **Readers tolerate what they don't know.** Payloads and the envelope keep fields they don't name (`looseObject`);
   the API stores envelope fields it doesn't know under `ext`. An event of a kind, or a version, the API doesn't know
   yet is stored as it came with `known: false`, and the jobs read it once the API learns it. A newer client never
   loses data to an older API.
4. **Lists that grow are open** (`openName`): a tool's status, a command's class, a session event, a finding's type,
   a link's type and system, a memory's kind in an answer. The writer uses the known values; the reader takes any
   short lower-case name and treats one it doesn't know as unknown, not wrong.
5. **Lists that tell the API what to do stay closed**, such as a memory's kind on save: an API that doesn't know a
   value answers 400 rather than guess.
6. **One bad event never sinks a batch.** The API answers 202 with `rejected: [{ index, id, code, message }]`, and the
   plugin sets those aside under `dead:`. An API from before version 1 refused a bad batch whole (400); the plugin
   still handles that by sending one by one.
7. **A client too old gets 426 `upgrade_required`** and keeps its events, backing off as if the API were down, until
   it's updated. Nothing is thrown away.
8. **Links are generic** (`Ref`: `type`, `id`, optional `system` and `url`), so a new tracker is data, not a contract
   change.

`parseEvent` applies rules 1 to 7, and both sides use it. The example events (`@strata/contracts/examples`) are one of
each kind as a version-1 client writes them: the contract's tests and the API's tests accept them all.

| Kind         | Payload                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `prompt`     | `role: "user"`, `text`, `messageID?`. The only kind that becomes an active memory by itself                 |
| `assistant`  | `role: "assistant"`, `text`, `messageID?`                                                                   |
| `tool`       | `tool`, `status` (ok, error, interrupted), `ms?`, `toolUseID?`, and for a shell command `command`           |
| `transcript` | `trigger?`, `messages` (what the user typed and the agent wrote; no tool output)                            |
| `session`    | `event` (start, context, end), `source?`, `reason?`, `git?` (remote, branch, head, path), `refs?`           |
| `event`      | `type` (compact_summary), `text?`, `trigger?`                                                               |
| `finding`    | `type` (insight, workflow, pain_point, context_gap), `text`, `refs?`. Becomes a draft record for its author |

The envelope adds `promptID`, the user prompt an event belongs to (Claude Code's `prompt_id`), so a turn's prompt,
tool calls and reply group together, and a memory's provenance points at the turn it came from.

**A shell command never leaves the machine.** The plugin sends its class (`classifyCommand`: test, build, typecheck,
lint, format, install, git, other), its exit code when it failed, whether it ran in the background, and, for any
class but other, `fp`: the first 16 hex characters of a SHA-256 of the command after redaction and normalized
spacing (`commandKey`), so the same command run again can be counted. That and `ms` are what "where engineering time
goes" is measured from.

**Session links.** At the start, and at each Stop where the branch or the commit changed, the plugin sends `git`: the
normalized origin, the branch, the commit and the folder inside the repository (which tells a monorepo's products
apart), and `refs` for the upper-case ticket keys in the branch name (`PAY-412`). The API can match lower-case keys
later, against the projects an organisation actually has.

## Drafting, and what's kept

Decided on 14 November 2026: **session records are drafted on the server**, from the redacted text the plugin already
sends, and a draft is visible to its author alone until they approve it. Once a session is drafted, the text of its
prompts, replies and transcripts is deleted; until drafting exists, the 30-day TTL on `memory_events` is what limits
it. The promise to the people whose sessions these are is "nothing is shared without your review", not "nothing
leaves your machine": secrets are redacted on the machine and again on the server, and nobody else sees anything until
its author approves it.

The plugin now emits the events this section describes, and `apps/web/server/records/draft.ts` drafts records when a
session ends. It also keeps the local summary path with `claude -p`; the two run side by side until the summary path
is retired. The Anthropic drafting provider is still the stub, so `draftRecords` is deterministic for now.

**The approval gate.** `records.mjs` keeps `session.json`, `summary.json`, `review.json` and `upload.json` per session;
one writer per file and short locks keep the hooks, summarizer, syncer and dashboard from overwriting each other.
Status moves `summarizing → needs-link → draft/updated → ready → synced`, with `rejected` and `local` beside it. A
summary needs a Jira key, a PR, or an explicit "no ticket", and an approval of the exact revision, before it is sent.

**What the client needs from the backend.** The `/v1` contract is in `clients/claude-code/docs/api-contract.md`:
device-code auth, projects and membership, `POST /v1/events` for approved `session_summary` revisions,
`DELETE /v1/sessions/:id` to retract, and `GET /v1/search` / `GET /v1/rollups` for teammates' approved summaries.
The event path uses `POST /api/memory/events` (contract v1) and `GET/PATCH /api/records`, `POST /api/records/:id/approve`
and `/discard`. `apps/web` implements all of it; the mock server covers both surfaces for the plugin's tests, and the
`*.db.test.ts` files cover the server.

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
