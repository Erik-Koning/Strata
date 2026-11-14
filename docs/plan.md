# Strata

Layered memory for AI-assisted development. Strata is a **Claude Code plugin**
(with an optional **opencode v2** adapter) that drafts short notes about coding
sessions. The engineer reviews every note before anyone else sees it. Approved notes build
up, layer by layer, into a shared picture of each product.

Strata is the capture layer of the **Delivery Context Hub** (working name), a
separate web app that is in progress.

About page: [`docs/about.html`](about.html)
(published at https://claude.ai/artifact/99ku5Wiv7P5WZWnZeiqBmg)

## What it records

| Kind             | What                                                                                 | Written                 |
| ---------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| Summary          | What was implemented and why, linked to ticket and PR                                | Drafted at session end  |
| Insight          | A non-obvious fact about the system: a constraint, quirk, or decision and its reason | Drafted, or logged live |
| Workflow finding | How work on the repo actually gets done: setup, test order, release, approvals       | Drafted, or logged live |
| Pain point       | Something that slowed the session, written as a suggestion                           | Suggested by the agent  |
| Context gap      | Information the agent needed and couldn't find, so it guessed or searched            | Logged live             |

Pain points and context gaps describe code and process, never a person.

## Flow

1. **Capture**: hooks capture prompts, replies, tool timings and the session's branch and commit as you work.
2. **Redact**: secrets are stripped on the engineer's machine, and again on the server.
3. **Draft**: at session end, Claude drafts a summary and findings on the server. Only the author sees the draft, and
   the session's prompt and reply text is deleted once it's drafted.
4. **Review**: the engineer approves, edits or discards each record (`/strata:review`).
5. **Share**: approved records join the product's pages and are indexed for vector search.

## Claude Code hooks

| Hook           | Strata does                                                               |
| -------------- | ------------------------------------------------------------------------- |
| `SessionStart` | Loads the product overview and open context gaps into the agent's context |
| `Stop`         | Writes a one-line local note after each response                          |
| `PreCompact`   | Saves notes before the conversation is compacted                          |
| `SessionEnd`   | Drafts the session summary and findings, queued for review                |

Planned commands: `/strata:review`, `/strata:note`, `/strata:gaps`.
Planned MCP tools: `strata_search`, `strata_record`.

## Layers

| Layer            | Scope                                      |
| ---------------- | ------------------------------------------ |
| Product overview | One per product, rewritten on each roll-up |
| Ticket and PR    | One per Jira ticket or GitHub PR           |
| Session          | One reviewed summary plus its findings     |
| Response notes   | Many per session, local until review       |

## Decided

| Area    | Choice                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| Name    | Strata                                                                                                     |
| Form    | Claude Code plugin; opencode v2 adapter optional, sharing one capture core                                 |
| Storage | MongoDB Atlas for documents, plus vector stores for semantic search                                        |
| Model   | Claude                                                                                                     |
| Viewer  | Delivery Context Hub web app (separate, in progress)                                                       |
| Drafts  | Written on the server from redacted text; the author's alone until approved; raw text deleted once drafted |
| Wire    | Versioned events (`v`), typed payloads, open lists; see `docs/architecture.md`                             |

## Open questions

- What is the record schema, and how much editing does a typical draft need?
- How many response notes per session help before they turn into noise?
- Which opencode v2 events map onto `Stop`, `PreCompact` and `SessionEnd`?
- Which embeddings model backs vector search? Voyage AI (owned by MongoDB) is the natural fit.
- Does the hub read Atlas directly, or go through a Strata API?
