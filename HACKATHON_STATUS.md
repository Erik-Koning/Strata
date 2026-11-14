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
- [ ] Relay UI (agent C)
- [x] Plugin: `strata_handoff_*` MCP tools, `/strata:handoff`, `/strata:resume` (lead, `8799182`). Unit 43/43,
      acceptance 6/6. A real headless `claude --plugin-dir` session loaded both commands and all five tools.
- [ ] Reproducible demo: a real failing test, handed off, continued in a fresh `claude` session (lead)

## Blockers / needs the operator

- **Atlas cloud**: no hackathon sandbox URI yet. Everything runs on Atlas Local, which has the same `$vectorSearch`.
  Set `MONGODB_URI=mongodb+srv://…` in `apps/web/.env.local`, then run `pnpm db:indexes`.
- **Embeddings key**: none in the environment. Search uses the deterministic `stub` provider, which is **not**
  semantic. A real provider needs the operator's key.
