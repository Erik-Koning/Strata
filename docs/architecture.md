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
| `memory_events`                              | Raw capture, redacted on the way in, with its contract version; expires after 30 days   | `id` unique (the idempotency key), TTL          |
| `memories`                                   | `scope{org,project,user}`, kind, text, embedding, provenance, trust, confidence, status | scope+status, text index, vector index, textKey |
| `memory_summaries`                           | Rollups made at a compaction, with the `sourceIds` they came from                       | sessionID, sourceIds                            |
| `memory_audit`                               | Who saved, forgot, compressed, made or revoked what; invites, roles, suspensions, teams | ts, actor, targetIds, action                    |
| `api_keys`                                   | A person's keys: name, prefix, SHA-256 only, last used, last client                     | hash unique                                     |
| `members`                                    | A person's role (engineer, manager, exec, admin) and whether they're suspended          | `_id` is the account id                         |
| `teams`                                      | A name, its members and its managers                                                    | name unique (any case), memberIds, managerIds   |
| `invites`                                    | Email, role, teams, SHA-256 of the token, expiry, who made it, when it was used         | hash unique, email                              |
| `records`                                    | Drafts and approved records: a session summary or a finding, its author, refs, sources  | key unique, author+status, approved             |
| `user`, `session`, `account`, `verification` | Better Auth                                                                             | Better Auth's own                               |

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
each kind as a version-1 client writes them: the contract's tests and the API's tests accept them all, and the
plugin's tests check that every event its hooks queue parses as known, so neither side can drift alone.

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

What's built (`server/records.ts`), run inline after each batch of events is stored:

- **A finding** (`kind: "finding"`) becomes a draft at once, with its refs. Made once per event, however often it's
  sent.
- **A session's summary** is drafted when the session ends (`session` with `event: "end"`), from its prompts and
  replies through the AI provider (`stub`: extractive, until a real one is set), with the session's ticket refs and
  branch. A session that ends again redrafts it, unless its author has edited or approved it.
- **My Day** (`/my-day`) is where the author decides: approve and share (optionally after editing), save an edit, or
  discard, which deletes the draft. Only the author can do any of these. It also lists the candidate memories their
  sessions suggested, to keep or set aside. Only people who use the plugin themselves get My Day: one of their API
  keys has been used by a client.

Not built yet: deleting a session's prompt and reply text once it's drafted (the 30-day TTL still limits it), and
forgetting a memory doesn't yet remove a draft made from the same events.

## The OpenCode plugin (next)

The brief fixes its files and rules. Its sketch (`Plugin.define`, `ctx.session.hook`, `ctx.storage`) is shorthand:
map each piece onto the real `@opencode-ai/plugin` API and record the mapping here before building. The Claude Code
client is the reference for behaviour; the contracts are shared.

## Running it

The team's environment (`.a6g/adapters/env.sh`): the app on 9316, MongoDB (`mongodb/mongodb-atlas-local:8.0`) on 9317,
the stub provider (`MEMORY_AI_PROVIDER=stub`). Production: one container of `apps/web` and MongoDB Atlas (vector and
text search are Atlas features). A Dockerfile and CI are still to write.
