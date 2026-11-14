# Building the hub's pages

The plan for building the team-facing pages shown in `docs/how-strata-works.svg` (product pages, where engineering time
goes, context gaps, Ask Strata), plus the review queue, session pages and an overview by role that they need. Written
on 14 November 2026 from an audit of `main` at `ce47b5f`. Agents build it in phases; each phase ends with the gate
passing and a commit.

## Where we are

**Working today**

- The memory loop: the plugin sends contract-v1 events (session git context, prompts, replies, tool timings with
  command class, exit code and fingerprint, findings) to `/api/memory/events`; recall and the frozen block come back.
- Server-side records: when a session ends, `server/records/draft.ts` drafts a summary and findings into `records`
  (with the **stub** provider: regex, not a model). `/api/records` lists, edits, approves and discards them, by API key
  only. Approved insights and workflow findings become memories.
- The plugin's summary path: it drafts a session summary on the machine (`claude -p --model haiku`), the engineer
  reviews it with `/strata:review`, and the approved summary goes to `/v1/events`, stored as `summary_revisions`
  (title, built, why, decisions, areas, open questions, insights, workflow, pain points, gaps, Jira and PR links).
- Accounts by invitation, roles (engineer, manager, exec, admin), teams, suspension; the People page.
- Pages: Overview, Memories, Connect, Audit log, People, and `/activate` for the plugin's device login.

**Not built**: product pages, where engineering time goes, context gaps, Ask Strata, the knowledge graph, a review
page, a session page, an overview by role. Nothing reads approved work team-wide in a page.

**Broken or half-wired** (from the audit)

| What                                                                                                                                                                                          | Where                                                 | Status                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------- |
| The plugin calls `/v1/*`; the app served only `/api/v1/*`, so `/strata:login` failed                                                                                                          | `next.config.ts`, `proxy.ts`                          | Fixed in phase 0       |
| Approving a device login landed on `?error=NEXT_REDIRECT`                                                                                                                                     | `app/activate/actions.ts`                             | Fixed in phase 0       |
| "Approved" message on `/activate` used undefined colour tokens                                                                                                                                | `app/activate/page.tsx`                               | Fixed in phase 0       |
| Two write paths that never join: `records` keyed by git remote, `summary_revisions` keyed by a personal project id; a finding logged with `strata_record` lands in both and is reviewed twice | `scripts/mcp.mjs`, `server/summary`, `server/records` | Decision D3            |
| Approved summaries are readable only by project members, and every project is personal, so nobody sees anyone's                                                                               | `server/summary/store.ts:107`                         | Phase 1 read model     |
| Tool timings are stored raw per person, aggregated nowhere, and expire after 30 days                                                                                                          | `memory_events` TTL                                   | Phase 1 `signal_daily` |
| Context gaps exist only as per-session records and summary strings: no cross-session count, owner or resolution                                                                               |                                                       | Phase 1 `gaps`         |
| Nothing searches records; the only vector index is on personal memories; `/v1/search` is a substring match                                                                                    |                                                       | D5: F1 and P4          |
| The model provider is the stub only: `anthropic` and `openai` throw                                                                                                                           | `server/ai/provider.ts:157`                           | Decision D4            |
| Transcript `messages` and compact-summary text aren't cleared after drafting                                                                                                                  | `records/draft.ts:161`                                | Phase 1                |
| Discarding or editing an approved record leaves its memory; re-approving adds a second; a duplicate edit is a 500                                                                             | `records/routes.ts`                                   | Phase 1                |
| The plugin sends `head: ""` outside git; the API rejects the event and the plugin ignores `rejected[]`                                                                                        | `scripts/lib/git.mjs`, `events.mjs`                   | Phase 1                |
| README and Connect say `MEMORY_API_URL`/`MEMORY_API_TOKEN`; the plugin reads `STRATA_URL` and `~/.strata/auth.json`                                                                           | `README.md`, `connect/key-maker.tsx`                  | Phase 1                |
| PR #4 (My Day) branches from before #3 and #5, conflicts in 6 files, and uses a different `RecordDoc`                                                                                         | `origin/my-day`                                       | Decision D2            |
| No `loading`/`error`/`not-found` pages; no page tests, Playwright or CI                                                                                                                       |                                                       | Phase 4                |

## Decisions (settled 14 November 2026)

- **D1. Dev data: production, as it is.** The dev server stays on the team cluster's database. No demo data is seeded
  there; pages are built to read real, thin data, so their empty states matter. Tests run in throwaway databases
  (`pnpm test:db`). The derived collections (products, `signal_daily`, `gaps`) are filled by idempotent backfills
  that run against production only when the operator says so.
- **D2. The review queue: rebase My Day (PR #4)** onto `main`'s records model and land it, with a session page beside
  it. It runs in phase 2, after the foundation, because it touches the same shared files.
- **D3. The team pages read both stores, merged**: approved `records` and the latest approved `summary_revisions`
  through one read model, duplicates within a session dropped. The double review is fixed later.
- **D4. An Anthropic provider** for Ask Strata and drafting, read from `ANTHROPIC_API_KEY` (the operator adds the key
  to `.env.local`; agents never read that file). Until the key is there, Ask Strata answers with cited excerpts.
- **D5. Ask Strata searches Atlas and talks through the Anthropic SDK.** Approved team work is copied into one
  collection, `team_search`, with two Atlas indexes on it: a vector index whose embeddings Atlas makes itself
  (automated embedding with Voyage's `voyage-4`, billed by Atlas per token, no embedding code of ours) and a full-text
  Atlas Search index. A question runs both and merges them with `$rankFusion`. The chat uses `@anthropic-ai/sdk` (its
  tool runner and streaming; P4 adds the dependency) with tools that read through F1's modules as the asker, never raw
  database access, so the privacy rules hold whatever the model asks for. Drafting stays on the provider's `fetch`. The
  cluster is an M10, which automated embedding needs; before P4 starts, the operator confirms in Atlas that it runs
  MongoDB 8.0 or later (`$rankFusion`) and that storage auto-scaling is on (automated embedding pauses without disk).

## Rules every agent follows

- **Everyone works in this checkout**, `/Users/erikkoning/Documents/Work/Strata` on `Erik-frontend`, so the dev server
  on `http://localhost:9316` shows each change as it lands. No agent commits or pushes; the orchestrator commits at the
  end of each phase, after the gate.
- **Each agent owns its files** and touches nothing else: its route folder under `apps/web/app/(app)/`, its module under
  `apps/web/server/hub/`, its components under `apps/web/components/<feature>/`, its tests. Shared files
  (`collections.ts`, `indexes.ts`, `nav.tsx`, `(app)/layout.tsx`, `globals.css`, `packages/contracts`) change only in
  phase 1. An agent that needs a shared change reports it instead of making it.
- **Match the app**: `PageHeader`, `.card`, `.chip`, `.btn`, the tokens in `globals.css`, lucide icons, `requireViewer()`
  first, `Date` and `ObjectId` serialised before reaching a client component, server actions that check the caller and
  return `{ error }`. Light and dark, phone width, `min-h-11` tap targets on mobile, designed empty states.
- **Privacy rules from the ground rules**: drafts are their author's alone; approved work is visible to everyone in the
  organisation who isn't suspended; no page shows counts, rankings or comparisons of people (a page may say who has
  worked on an area recently, by name, never how much); time is measured on tools, never on people, and aggregates
  carry no person.
- **The gate, per agent**: `pnpm biome check` on its files, `tsc -p apps/web` with no new errors (the `PageProps`
  error in `memories/page.tsx` predates this), its unit tests, and its database tests with `pnpm test:db` (a throwaway
  database). Every agent ends with a report: what it built, what it couldn't, what it found broken.

## Phase 0: unblock (done)

The `/v1` rewrite, the device-approval fix and the activate page's colours, so the plugin can sign in to the dev server.

## Phase 1: foundation (two agents, in parallel)

**Agent F1: data and read model.** Owns `server/hub/*.ts`, `server/collections.ts`, `server/indexes.ts`, the ingest
hook, `server/records/*`, and their tests.

1. `products`: a product is one or more repositories (normalized remote, and optionally a folder prefix for a
   monorepo). Products are made automatically from every repository seen in events, records and summaries, named after
   the repository; an admin can rename and merge them later. `listProducts`, `getProduct`, `productFor(repo, path)`.
2. The team read model, `server/hub/team-records.ts`: `TeamRecord { id, kind, title, text, productId, repo, sessionId,
   refs, author, at, source: "record" | "summary" }` over approved `records` and the latest approved
   `summary_revisions` (its `built`, `open`, `insights`, `workflow`, `painPoints` and `gaps` become records of those
   kinds), duplicates within a session dropped by normalized text. Approved work is readable org-wide; drafts by their
   author only. Queries: `whatsNew(productId, since)`, `inProgress(productId)` (sessions and tickets with recent
   activity and no merged PR yet, plus `open` items), `recordsFor({ productId, kind, since })`, `sessionDetail(id)`.
3. `signal_daily`: per day, product, repository, command class and fingerprint: runs, failures, re-runs (the same
   fingerprint again in the same session), total and median milliseconds. Written incrementally when `tool` events are
   ingested, backfilled from the events still stored. No person anywhere in it.
4. `gaps`: one document per gap across sessions (normalized text per product): text, product, first and last seen,
   session count, how many came from agents and how many from people, status `open | resolved`, owner, resolution
   `{ url, note, at }`. Fed by approved `context_gap` records, approved summary gaps, and (phase 2) questions Ask
   Strata couldn't answer.
5. Indexes for all of the above, and for team-wide reads of approved records.
6. Drafting clears transcript `messages` and compact-summary text too. (Approve, discard and edit as plain functions
   belong to P5, which rebases My Day.)
7. `pnpm hub:backfill`: idempotent backfills for products, `signal_daily` and `gaps`. Written and tested, not run.
8. Tests for every query, including the privacy rules.
9. Search over approved work (D5). `team_search`: one document per approved TeamRecord (`_id` is the TeamRecord id;
   org, kind, productId, repo, sessionId, title, text, at), never a draft. `server/hub/search.ts`:
   `indexSessions(sessionIds)` rewrites those sessions' documents from the read model (upserts what is approved,
   deletes what no longer is), called wherever approved work changes (the records routes and summary approval now,
   P5's approve, edit and discard when they land, and `hub:backfill`); `searchTeam(viewer, { query, kind?, productId?,
   since?, limit })` runs `$rankFusion` over `$vectorSearch` (the question sent as text) and `$search`, and falls back
   to a text index when the search indexes aren't there. Two indexes, made by `pnpm db:indexes` only, never in a test
   database (each build would embed everything again, billed): `team_search_semantic`, a vectorSearch index with
   `{ type: "autoEmbed", modality: "text", path: "text", model: "voyage-4" }` and filter fields org, kind, productId
   and at; and `team_search_text`, an Atlas Search index on title and text with the same fields for filtering. Database
   tests cover the sync and the fallback; the real indexes are checked once by hand on the cluster.

**Agent F2: shell, model provider and fixes.** Owns `components/nav.tsx`, `(app)/layout.tsx`, the placeholder
pages, `server/ai/provider.ts`, `server/config.ts`, the plugin's small fixes, the lint fixes and the docs.

1. The Anthropic provider (D4) behind `server/ai/provider.ts`: drafting and answering through the Messages API with
   `fetch` (no new dependency), the model set by `MEMORY_AI_MODEL`, embeddings staying on the stub until a real
   embeddings provider is chosen. Tests with a fake `fetch`.
2. Navigation for the new pages: Products, Time, Gaps, Ask and My Day, with the mobile bar handling more links. A
   placeholder page at `/products`, `/time`, `/gaps` and `/ask` ("Being built"), so they appear in the dev server at
   once. (`/my-day` arrives with P5.)
3. `pnpm lint` already fails on `main` (`useTemplate` in `test/summary.test.ts`, the plugin's `ui.html` and
   `tests/fake-claude.mjs`): fix those so the gate is green.
4. The plugin: omit `head` when there's no commit; set aside events listed in `rejected[]`; README and Connect
   describe `STRATA_URL` and `/strata:login`, not `MEMORY_API_*`.

## Phase 2: the pages (five agents, in parallel)

Each owns one route folder, one `server/hub/<feature>.ts` built on F1's read model, its components and its tests.

- **P1. Products** (`/products`, `/products/[id]`): the list (what each product is, what changed this week, open
  gaps); each product's page with What's new (approved summaries by week, each line linked to its ticket, PR and
  session), In progress, its slice of time lost and gaps, its code areas and who has worked on each recently, and its
  tickets and PRs.
- **P2. Where engineering time goes** (`/time`): hours lost in the chosen range, ranked (re-runs, failures and slow
  runs by command class and fingerprint, per product), with a trend per item, the pain points that explain it, the
  sessions behind each figure, "copy as a ticket", and the before-and-after once an item is marked fixed.
- **P3. Context gaps** (`/gaps`): open gaps ranked by how often they come back, split into agents and people; take
  ownership, resolve with a link to the doc, ADR or comment that answers it; resolved gaps listed with when they stopped
  recurring; filters by product and source.
- **P4. Ask Strata** (`/ask` and `app/api/ask/route.ts`, per D5): a chat over approved work that streams its answer.
  The route checks the caller with `requireViewer()`, takes the conversation from the page (nothing is stored but
  unanswered questions) and runs Claude Opus 5.5 (`claude-opus-5-5`) through the SDK's tool runner with these tools,
  each a thin call into F1's modules as the asker:
  - `search_team_records(query, kind?, productId?, since?)`: `searchTeam`, returning numbered sources.
  - `get_record(id)` and `get_session(id)`: the whole record or session, and where it came from.
  - `get_product(id)`: what a product is and does, its What's new and In progress.
  - `time_lost(productId?, since)` and `open_gaps(productId?)`: from `signal_daily` and `gaps`, which carry no person.

  Every claim cites a source as [n], numbered once per conversation and linked to its record or session; an answer
  that cites nothing counts as unanswered and goes into `gaps`. A question runs at effort `low`; an "Analyse" switch
  runs at `high` and adds code execution with programmatic tool calling, so Claude can script many searches and
  aggregations and bring back only the result. Server-side fallback (`fallbacks: "default"`) as in the provider, a
  cap on tool rounds and on questions per person per hour, the system prompt and tools cached. A first-week path per
  product for new joiners. Without `ANTHROPIC_API_KEY`, the page shows the search results as cited excerpts. Tests
  with a fake Anthropic client.
- **P5. Review and sessions** (`/review` from My Day, `/sessions/[id]`): drafts grouped by session, approve, edit,
  discard, approve all; each session's page with its summary, findings, links, tool time and where each finding came
  from. Per D2, this rebases PR #4.

## Phase 3: tie it together (one agent)

- **Overview by role** (`/`): what's waiting for my review, then by role (`HOME_FOCUS`): an engineer sees their drafts
  and their products; a manager or exec sees what shipped, time lost and open gaps across their products.
- **Knowledge graph, first version**: a "Related" panel on records, sessions and products (same ticket, same code area,
  same gap), and a small graph of a product's areas, records, tickets and gaps on its page. Insights flagged for review
  when later PRs change their code area.
- **Weekly digest**: `/digest`, the week's What's new and In progress per followed product, ready to email later.

## Phase 4: verify and ship (the orchestrator)

The full gate (`typecheck`, `lint`, `test`, `test:db`, `test:acceptance`, `build`); a walk through every page in light
and dark and at phone width on the demo data; `loading`, `error` and `not-found` pages; Playwright smoke tests for each
page; README and `docs/architecture.md` updated; one PR per phase or one for the lot, as the operator prefers.

## Later

Organisations beyond `default`; PR lookups on GitHub; Jira write-back for "copy as a ticket"; email for the digest;
personal memory recall on automated embedding too (it still embeds with the stub); one write path instead of two (D3).

## Watching it live

- The app: `http://localhost:9316`, on the database D1 chooses. New pages appear in the navigation as placeholders at
  the start of phase 1 and fill in as each agent lands.
- The plugin, against the same server, in another terminal:

  ```sh
  STRATA_URL=http://localhost:9316 STRATA_HOME=~/.strata-dev claude --plugin-dir clients/claude-code
  ```

  Then `/strata:login`, approve on the `/activate` page it opens, and work as usual. Events show up on Overview and
  Memories; a finished session's drafts on the review page. `STRATA_HOME` keeps this sign-in apart from any other.
