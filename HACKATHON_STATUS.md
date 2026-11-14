# Strata Relay: hackathon status

Track: **Memory You Can Govern**. This file is updated as work lands, and only with what has actually been run.

## Ownership

| Lane                                             | Owner   | Files                                                                                                                     |
| ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Contracts, integration, Claude Code plugin, demo | lead    | `packages/contracts/src/handoff.ts`, `clients/claude-code/**`, `demo/**`, this file                                       |
| Handoff backend, authorization, governance tests | agent B | `apps/web/server/handoffs/**`, `apps/web/app/api/handoffs/**`, `server/memory/correct.ts`                                 |
| Atlas, embeddings, vector search                 | agent A | `apps/web/server/ai/**`, `server/indexes.ts` (vector), `server/memory/{recall,frozen,store}.ts`, `scripts/atlas-check.ts` |
| Relay UI                                         | agent C | `apps/web/app/(app)/relay/**`, `apps/web/components/relay/**`                                                             |

## Progress

- [x] Repo audit. Branch fast-forwarded to `origin/main` (RBAC and contract-v1 from teammates). The unmerged `plugin`
      branch is a rewrite of the client, so client changes here stay additive.
- [x] Baseline gate on Atlas Local (`mongodb/mongodb-atlas-local:8.0`, Node 22.23): typecheck OK, lint OK, unit 126/126,
      DB 27/27.
- [x] Handoff contract (`packages/contracts/src/handoff.ts`): lifecycle, schemas, `renderResume`, `resumeCommand`;
      `HandoffDoc`, the `handoffs` indexes and the `handoff.*` audit actions.
- [x] Handoff API and cross-account governance tests (agent B, `b899eba`). `pnpm test:db` 53/53, re-run by the lead,
      of which 18 are cross-account handoff tests with three accounts plus a suspended one: drafts 404 for others, only
      approved memories reach the recipient, forgotten, archived and expired memories excluded with a reason,
      corrections followed, revoke 404s the recipient, racing completes give one 200, and every step is audited.
- [x] Embeddings and Atlas readiness (agent A, `1145bda`): Voyage and OpenAI providers, the vector index's dimensions
      kept in step with the provider (drop and recreate proven on Atlas Local), every memory stamped with its
      embedding model, recall and frozen exclude expired memories and other models' vectors, `/api/health` reports
      `semantic`, and `pnpm --filter @strata/web atlas:check` passes against Atlas Local. **Not run against Atlas cloud
      or a real embeddings API: no credentials.**
- [x] Relay UI (agent C, `a593935`): `/relay` with an inbox and sent list, the checkpoint, VERIFIED/CLAIMED test
      badges, an unpushed or uncommitted warning, shared memories with provenance, excluded memories, the timeline,
      draft editing, picking a recipient and memories (none pre-ticked), approve, copy resume command, inline revoke.
      Checked in Chrome with real data **at 756 px wide only**: the three-pane desktop layout (from 1380 px) hasn't been
      looked at, because the browser window couldn't be resized wider on this machine.
- [x] Plugin: `strata_handoff_*` MCP tools, `/strata:handoff`, `/strata:resume` (lead, `8799182`). Unit 43/43,
      acceptance 6/6. A real headless `claude --plugin-dir` session loaded both commands and all five tools.
- [x] Reproducible demo (`demo/relay/run.mjs`): **26/26 checks passed** against a production build (`next start`)
      on Atlas Local, with two real headless Claude Code sessions: - Alice's session ran `/strata:handoff`. The plugin read git (branch, commit, pushed) and ran `npm test`
      (fail, exit 1, recorded as verified). - Bob and Mallory got 404 on the draft. Alice approved it for Bob, sharing one memory. Mallory still got 404,
      and Bob's resume carried the shared memory, never Alice's private one, framed as untrusted. - Bob's fresh session, in his own clone with his own key, ran `/strata:resume`. It hit the repository check
      (on `main`, commit missing), fetched and switched, claimed, verified `npm test` (fail), implemented compound
      parsing following Alice's shared decision ("round once at the end") and avoiding her failed `split`
      approach, verified again (pass), committed `95450ed` and completed. - The script itself ran `npm test` in Bob's clone (exit 0) and confirmed the handoff is `completed`,
      `verified: true`, with the final commit equal to Bob's HEAD. - Revocation: a second handoff was readable by Bob, then revoked by Alice, then 404 for get and resume. - Transcripts: `demo/relay/.demo-logs/{alice,bob}-session.jsonl` (git-ignored, local).
- [x] Full gate on the integrated tree: typecheck OK, lint OK (185 files), unit 73+38+43, acceptance 6/6, DB 53/53,
      `pnpm build` OK.

## Found while integrating

- `demo/relay` fixture: `node --test test/` fails on Node 22 (no directory argument); changed to `node --test`.
- Running `pnpm build` (which rebuilds `clients/claude-code/dist`) while a Claude session starts the plugin makes
  the MCP server fail, and Claude Code then caches the failure (`~/.claude/mcp-needs-auth-cache.json`, about 15
  minutes) for later sessions. Don't rebuild the plugin during a demo. The stale entry was removed locally.
- Cosmetic: on the timeline, a passing test's dot is grey rather than green.

## Blockers / needs the operator

- **Atlas cloud**: no hackathon sandbox URI yet. Everything runs on Atlas Local, which has the same `$vectorSearch`.
  Set `MONGODB_URI=mongodb+srv://…` in `apps/web/.env.local`, then run `pnpm db:indexes`.
- **Embeddings key**: none in the environment. Search uses the deterministic `stub` provider, which is **not**
  semantic. A real provider needs the operator's key.
- **Session secret for any hosted deploy**: `BETTER_AUTH_SECRET` (32+ chars) and `BETTER_AUTH_URL` are unset. Without
  them sessions are signed with a development constant: fine on localhost, not on a public URL.

## Integration: Relay + Intelligence (`integration/relay-intelligence`)

Relay `ee569ec` + Intelligence `8ab35c5`, merged in `8315307`. Conflicts only in `components/nav.tsx` and
`apps/web/package.json`; both sides kept (Intelligence and Relay nav entries; `atlas:check`, `db:reembed`,
`relay:demo-accounts` and `intelligence:demo` scripts).

- `7cf53dd`: a semantic conflict with no textual one. Relay made "live" (active **and** not expired, `liveFilter`) the
  rule for every memory read, and restricted `$vectorSearch` to the active embedding model. Intelligence predated that,
  so on the merged tree Ask Strata cited an expired memory and Pulse counted it. Intelligence's memory reads now use
  `liveFilter` and the model filter. A new assertion in `intelligence.db.test.ts` fails on `8315307` and passes now.
- `43a6ba1`: one suggested question said "the team"; Ask Strata reads only the asker's own records. Now "I".
- Intelligence is **owner-scoped and extractive**: no model writes answers (labelled "extractive · no model" and "your
  scope only"; the page lists team-wide records and AI-written answers as unavailable).

Run on `43a6ba1`, Node 22.23.3, Atlas Local 8.0.34 (database `strata_integration`, `?directConnection=true`):

- typecheck OK; lint OK (200 files); unit 73 + 51 + 43; acceptance 6/6; DB 59/59 (53 Relay + 6 Intelligence);
  `pnpm build` OK, and the rebuilt `clients/claude-code/dist/mcp.mjs` is byte-identical to the committed one.
- `node demo/relay/run.mjs --api http://localhost:9340` against `next start`: **26/26**, twice (on `8315307` and on
  `43a6ba1`), with real headless Claude Code sessions; nothing was built while they ran.
- `atlas:check` passes (local, stub).
- In Chrome at a 1440 px viewport: `/relay` and `/intelligence` load with no console errors and no horizontal scroll.
  Alice sees her shared and private memories; Bob, the recipient, gets **0 records** in Ask Strata (Relay sharing
  doesn't widen Intelligence's scope). Evidence drilldown shows owner, authorization and provenance.

Found, not changed:

- Relay's three-pane layout never turns on: Tailwind emits `min-[1380px]:` before `lg:`, so `lg:grid-cols-[260px_…]`
  wins. At 1440 px it renders as two panes, which reads fine. Forcing the three-pane CSS in the browser showed the
  checkpoint overlapping the right column, so fixing the breakpoint alone would make it worse.
- Stub embeddings aren't semantic: as Alice, "How should durations be rounded?" also cites her private "interviewing"
  memory (her own record, so not a leak, but don't demo Ask Strata as Alice on a shared screen).
- `pnpm build` rewrites `apps/web/next-env.d.ts` (`.next/dev/types` → `.next/types`); revert it before committing.
- The repository's `engines` says Node ≥ 24; everything here ran on 22.23.3. The default `node` on this machine is 18.
