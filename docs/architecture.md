# Strata: architecture

What exists, how the parts talk, and what's next. Every later change reads this first and keeps it true.

## The shape

```
Claude Code ──hooks──▶ clients/claude-code ──▶ local store (events, summaries, drafts, overview)
                          │  └─ claude -p ──▶ one session summary, written locally
                          └──HTTPS + device token──▶ apps/web
                                                      ├─ /api/memory/*  (contract v1)
                                                      ├─ /api/records   (drafted, reviewed)
                                                      ├─ /v1/*          (approved summaries)
                                                      └─▶ MongoDB (atlas-local / Atlas)
OpenCode    ──adapter─▶ clients/claude-code/adapters/opencode (unverified)
apps/web pages: Better Auth sessions, Overview, Memories, People, Connect, Audit log, Relay, Intelligence
                the hub (server/hub/*): My Day, Products, Time, Gaps, Ask, a page per session
```

One deployable (`apps/web`) and one database. Only the API touches MongoDB. `packages/contracts` defines the memory
event contract and the record shapes; the plugin carries its own summary schema and an event outbox for now.

## The data

| Collection                                   | What                                                                                        | Key indexes                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `memory_events`                              | Raw capture, redacted on the way in, with its contract version; expires after 30 days       | `id` unique (the idempotency key), TTL          |
| `memories`                                   | `scope{org,project,user}`, kind, text, embedding, provenance, trust, confidence, status     | scope+status, text index, vector index, textKey |
| `memory_summaries`                           | Rollups made at a compaction, with the `sourceIds` they came from                           | sessionID, sourceIds                            |
| `memory_audit`                               | Who saved, forgot, compressed, made or revoked what; invites, roles, suspensions, teams     | ts, actor, targetIds, action                    |
| `api_keys`                                   | A person's keys: name, prefix, SHA-256 only, last used, last client                         | hash unique                                     |
| `members`                                    | A person's role (engineer, manager, exec, admin) and whether they're suspended              | `_id` is the account id                         |
| `teams`                                      | A name, its members and its managers                                                        | name unique (any case), memberIds, managerIds   |
| `invites`                                    | Email, role, teams, SHA-256 of the token, expiry, who made it, when it was used             | hash unique, email                              |
| `records`                                    | Drafted summaries, insights, workflow findings, pain points and gaps; approved or discarded | author/status, session, dedupe key              |
| `projects`, `project_members`                | The `/v1` summary API's projects; one personal default per person                           | one default per user, membership unique         |
| `summary_revisions`                          | Approved session summaries, one document per revision; the highest is current               | idempotency, (user, session, revision), project |
| `draft_claims`                               | One per session being drafted: who holds it, whether to look again; kept 30 days after      | `_id` (org, person, project, session), TTL      |
| `products`                                   | A product: one or more repositories, each whole or one folder; a slug id; `mergedInto`      | `repoKeys` unique per org                       |
| `signal_daily`                               | Tool time per UTC day, product, repository, command class and fingerprint. No person        | (item, day, product) unique; day+product        |
| `gaps`                                       | One context gap per normalized text per product: occurrences, counts, owner, resolution     | `key` unique; status+product+lastSeen; text     |
| `team_search` (planned)                      | D5, not merged yet: one document per approved TeamRecord, for Ask Strata's search           | two Atlas Search indexes, `pnpm db:indexes`     |
| `deviceCode`                                 | Better Auth's device-authorization codes for `/strata:login`                                | Better Auth's own                               |
| `user`, `session`, `account`, `verification` | Better Auth                                                                                 | Better Auth's own                               |

The vector index (`memories_embedding`) is an Atlas Search index filtered on `scope.org`, `scope.project`,
`scope.user` and `status`. `pnpm db:indexes` creates everything and waits until the vector index is queryable.
Recall uses it where it's ready and the text index otherwise.

`scope.project` is the project a memory belongs to, or `*` for every project of that person.

## Who's who

- **People** get an account only from an invite link (`/sign-up?invite=inv_…`): an admin makes one on the People page,
  for an email, a role and teams; the first admin's comes from `pnpm invite <email>`, which only someone holding the
  database's credentials can run. A link works once, for that email, for 7 days; only its SHA-256 is kept. Better
  Auth's own sign-up route is closed to HTTP (`disabledPaths`), and a database hook refuses any account no open invite
  was made for. A session cookie, `strata.session_token`, after that.
- **Visibility into the work, not the worker** (`server/access.ts`, from `docs/about.html`):
  - **Private stays private.** A person's memories, events, summaries and draft records are theirs alone. No role,
    admins included, reads them.
  - **Approved records are for everyone with access.** A person's approval is what shares a record; after that, every
    member of the organisation can see it.
  - **A role decides what a person's home view leads with**, not what they may see:

    | Role      | Home view leads with                                                            |
    | --------- | ------------------------------------------------------------------------------- |
    | Engineer  | Pain points and context gaps in their products                                  |
    | Manager   | The teams they manage: features and who worked on them, from approved summaries |
    | Executive | Progress and updates across every product                                       |
    | Admin     | Progress, and the People page: people, roles, teams and invitations             |

  - **Who, never how much.** Views show who worked on an area, never counts, rankings or comparisons of people, and
    no activity: no time, no last-seen, no prompt history. The People page shows who has access, not when they last
    used it; the admins' audit log shows changes to access, not what anyone did in their own memory.

  Only someone whose role is Manager can manage a team. An install always keeps one admin who can act: the last one
  can't be demoted or suspended, and no one can suspend themselves.
- **Suspending** someone ends their sessions, revokes their API keys and stops them signing in until an admin restores
  them; restoring doesn't bring the keys back.
- **Every check is on the server**: admin pages answer 404 to anyone else, and every admin server action checks the
  caller again, whatever the page showed. Every change to access is in the audit log, and a person sees any change an
  admin made to theirs.
- **Clients** send an API key made on the Connect page (`am_…`, shown once, kept as a SHA-256). A key covers its own
  person in the one organisation (`default`) and any project; naming another person or organisation is a 403.
- **The service token** (`MEMORY_API_TOKEN` in the app's environment) covers every scope: tests, scripts, the
  OpenCode sandbox.

## How memory is made

1. A client sends events (`prompt`, `assistant`, `tool`, `transcript`, `session`, `event`, `finding`). The API checks
   each on its own, stores each once and redacts it again. What each kind carries is below, under the contract.
2. **Extract** (`server/memory/extract.ts`, inline after ingest for now): a sentence that states a preference, a
   convention, a decision or a fact to remember becomes a memory. What the user said in their own turn is `active`
   and `explicit`. Anything else is a `candidate` (`inferred`) until a person keeps it.
3. Duplicates are caught by `textKey`, a hash of the normalized text within a scope.
4. `memory_save` and "Add a memory" make `active`, `explicit` memories directly.

Still to build, in the brief's order: dedupe beyond identical text, summarize, score and policy as scheduled jobs
(`POST /api/jobs/run`), and real embeddings by default. `server/ai/provider.ts` has the stub (the default), Voyage AI
and OpenAI embeddings, and Anthropic for the text work (summaries, drafts, answers) when `MEMORY_AI_PROVIDER=anthropic`
and `ANTHROPIC_API_KEY` is set; without the key it stays on the stub.

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
fail without losing the other. Proven by `pnpm test:acceptance` (the hooks as real processes).

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
each kind as a version-1 client writes them: the contract's tests and the API's tests accept them all. The plugin
emits v1 events and its tests check their shape; a shared `parseEvent` test waits on bundling the contracts into it.

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

Decided on 14 November 2026: **session records are drafted on the server**, from the redacted text the plugin sends,
and a draft is visible to its author alone until they approve it. `server/records/draft.ts` runs when a session's end
event arrives: it builds the records and dedupes them by text. The raw prompt, reply and transcript events stay in
`memory_events` until the 30-day TTL, matching my-day; deleting them at drafting is a later policy decision. The
promise to the people whose sessions these are is "nothing is shared without your review", not "nothing leaves your
machine": secrets are redacted on the machine and again on the server, and nobody else sees anything until its author
approves it. The drafter is the provider's (`draftRecords`): Anthropic's when it's chosen and has its key, the
deterministic stub otherwise, and the stub again whenever a model call fails.

**Drafting runs off the request.** A model can take longer than a client waits, so `POST /api/memory/events` stores the
batch, counts its tool time and answers; a session's end event then starts drafting after the answer (`draftLater` in
`server/memory/ingest.ts`). A failure there is logged and never loses an event. A session is drafted by one attempt at a
time: the attempt takes the session's claim in `draft_claims` (an upsert on a unique id, so of two attempts exactly one
wins). An end event that arrives while the session is being drafted asks the holder to look once more for events that
came meanwhile, rather than drafting it twice; a claim whose holder went quiet for 10 minutes can be taken over. A
finished claim is kept 30 days, as long as the events it was drafted from.

## The hub: what the team reads

The team's pages read approved work, never anyone's drafts, through the modules in `apps/web/server/hub/`. Every
function there takes the viewer and checks it (`reader.ts`): approved work is for everyone in the organisation who
isn't suspended, and a suspended person reads nothing, whatever the page already checked.

- **The read model** (`team-records.ts`, decision D3). Approved `records` and the latest approved revision of each
  `summary_revisions` session, read as one list of `TeamRecord`s: a summary's built line, decisions, open questions,
  insights, workflow notes, pain points and gaps each become one. A session has one summary: when both stores have one,
  worded differently, the plugin's reviewed summary is kept, with the drafted one's tickets and pull requests carried
  over. Any other line said in both stores in one session is shown once, the record's. Queries: `recordsFor`,
  `whatsNew` (by week), `inProgress` (by ticket, else pull request, else session, with open questions),
  `contributorsFor` (who, by name, never how much) and `sessionDetail` (the session's author also sees their drafts and
  the session's tool time).
- **Products** (`products.ts`). A product is one or more repositories, each whole or one folder of it, so a monorepo
  can hold several. One is made automatically per repository the first time it's seen, named after it, with a slug id
  that never changes; an admin can rename and merge them later (`mergedInto` sends old links on). A product is listed
  only once it has approved work, so a repository that so far appears only in someone's own events stays theirs.
- **Tool time** (`signals.ts`, `time-math.ts`). Each shell command's class, exit, fingerprint and duration is counted
  into `signal_daily` as its tool event arrives (and, for events stored before or missed, by the backfill): runs,
  failures, re-runs (the same fingerprint again in one session) and time, per day, product, repository, class and
  fingerprint. No person and no session is in it, and it outlives the events' 30 days. `timeLost` ranks commands by the
  hours lost to failures, re-runs and slow first runs; `timeTrend` and `timeTrends` (several at once, for a page) give a
  command's weeks in one product, since a monorepo split by folder runs the same command in more than one.
- **Gaps** (`gaps.ts`). One document per gap: the same normalized text in the same product. Fed by approved
  `context_gap` records and summary gap lines (`syncGaps`, which reconciles against approved work and is safe to run any
  time) and by questions Ask Strata couldn't answer (`recordAskGap`). Counted per session and per question, never per
  person; who asked isn't kept. Anyone can take a gap on, resolve it (a note is required, a link when there is one) or
  reopen it, each in the audit log; `gapHistory` reads a gap's occurrences and those changes back.
- **Search** (planned: `search.ts`, decision D5, on the `hub-wip-ask-graph` branch, not merged). `team_search` would hold one document per approved TeamRecord (`_id` is the
  TeamRecord's id; org, kind, productId, repo, sessionId, title, text, at), never a draft. `indexSessions` rewrites a
  session's documents from the read model wherever approved work changes, and `searchTeam` merges a vector search and a
  full-text search with `$rankFusion`, falling back to a text index where the Atlas indexes aren't there. The two
  indexes are made by `pnpm db:indexes` only, never in a test database: `team_search_semantic`, a vector index whose
  embeddings Atlas makes itself (automated embedding with Voyage's `voyage-4` on `text`, filtered by org, kind,
  productId and at), and `team_search_text`, an Atlas Search index on title and text with the same filters.
- **Ask Strata** (`ask.ts`). A question is answered only from approved work the asker may see, every claim cited as
  [n] and linked to its record or session; an answer that cites nothing counts as unanswered, and the question becomes a
  gap. Without a model, the page shows the matching excerpts. The provider's `answerWithReason` also says why there was
  no answer (no sources, nothing relevant, or the model's call failed or ran out of time), so a failure on our side
  needn't count as something the team doesn't know, and takes a length (`maxSentences`) for a walk-through longer than
  the few sentences a question gets.

`pnpm hub:backfill` fills `products`, `signal_daily` and `gaps` from what's already stored, idempotently; it runs against
production only when the operator says so.

| Page             | What it shows                                                                                          | Reads                         |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `/my-day`        | The viewer's own drafts by session, to approve, edit or discard, and memories their sessions suggested | `records` (the author's only) |
| `/products`      | Each product with its latest work, open gaps and time lost on its tools                                | `product-page.ts`             |
| `/products/[id]` | What's new by week, In progress, time lost, open gaps, code areas and who worked on them               | `product-page.ts`             |
| `/time`          | Hours lost to commands in a range, ranked, each with its trend, pain points and a ticket to copy       | `time-page.ts`                |
| `/gaps`          | Open gaps ranked by how often they come back, split into agents and people; resolved ones              | `gaps.ts`                     |
| `/gaps/[id]`     | One gap: the sessions it came from, as each put it, and its history                                    | `gaps.ts`, `gaps/detail.ts`   |
| `/ask`           | Questions answered from approved work, each claim cited; a first-week path for new joiners             | `ask.ts`                      |
| `/sessions/[id]` | One session: its summary, findings, links, and, for its author, drafts and tool time                   | `team-records.ts`             |

No page counts, ranks or compares people. Time is measured on tools, never on people, and its figures carry no person.

## The OpenCode adapter

`clients/claude-code/adapters/opencode/strata.js` maps opencode events (`session.created`, `message.updated`,
`session.idle`, `session.compacted`, `session.deleted`) onto the same hook entrypoint. The event names are unverified
against a live opencode and are the first thing to check. The Claude Code client is the reference for behaviour.

## Running it

The team's environment (`.a6g/adapters/env.sh`): the app on 9316, MongoDB (`mongodb/mongodb-atlas-local:8.0`) on 9317,
the stub provider (`MEMORY_AI_PROVIDER=stub`). Production: one container of `apps/web` and MongoDB Atlas (vector and
text search are Atlas features). A Dockerfile and CI are still to write.
