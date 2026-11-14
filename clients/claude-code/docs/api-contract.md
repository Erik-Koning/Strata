# Strata API contract (what the plugin expects)

Base URL from `STRATA_URL` or `~/.strata/config.json` (`serverUrl`). JSON everywhere. All `/v1/*` routes except the two auth ones need `Authorization: Bearer <token>`; a bad or expired token returns `401 {"error":"invalid_token"}`.

## What Strata receives, and what it never does

The plugin sends **one engineer-approved summary per session**, written by the engineer's own Claude and edited by the engineer if they wished. It never sends prompts, Claude's replies, code, per-turn records or activity timestamps. Strata should enforce this and refuse anything else (the mock server does; see `mock-server/server.mjs`).

Strata must also:

- accept only `review.approved === true` with an `approvedAt`; drafts do not exist on the server
- store under `(userId, sessionId)`, with the author taken **from the token, never from the body**, so two engineers cannot collide or read each other's records through the plugin
- check project membership on every call

## Auth: OAuth device-code flow (RFC 8628)

`POST /v1/auth/device` body `{client}` returns
`{device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval}`.

`POST /v1/auth/token` body `{device_code}` returns `200 {access_token, token_type, user:{id,name,email}}`, or `400 {error}` where error is `authorization_pending`, `slow_down`, `expired_token` or `invalid_grant`.

## Read

- `GET /v1/me` returns `{user}`.
- `GET /v1/projects` returns `{projects:[{id,name,teamName,description}]}`: only projects the caller's teams can use.

## Write: `POST /v1/events`

Header `Idempotency-Key` equals the body's `idempotencyKey`: `<sessionId>:summary:<revision>`.

```json
{
  "idempotencyKey": "sess_abc:summary:3",
  "type": "session_summary",
  "sessionId": "sess_abc",
  "revision": 3,
  "projectId": "p_checkout",
  "updatedAt": "2026-11-14T15:04:05.000Z",
  "client": { "plugin": "0.3.0", "platform": "darwin" },
  "repo": { "remote": "https://github.com/acme/shop.git", "branch": "ABC-123-fix-tax", "head": "9f2c..." },
  "links": {
    "jira": ["ABC-123"],
    "pr": { "number": 42, "url": "https://github.com/acme/shop/pull/42", "title": "Fix tax rounding" },
    "noTicket": false
  },
  "summary": {
    "title": "Tax rounding per line",
    "built": "Line totals now round to the cent before summing, so invoices match the ledger.",
    "why": "Totals drifted by a cent on large orders.",
    "decisions": ["Round per line, not on the total, to match how the ledger posts"],
    "areas": ["billing", "tax"],
    "open": ["Refund path still rounds on the total"],
    "insights": ["The ledger rounds per line, so totals must be summed from rounded lines"],
    "workflow": ["Integration tests need the local Mongo container running first"],
    "painPoints": ["The full suite ran four times; running only the touched package would have been enough"],
    "gaps": ["No record of why the queue delivers at least once"]
  },
  "files": ["src/tax.ts", "src/tax.test.ts"],
  "review": { "approved": true, "approvedAt": "2026-11-14T15:05:00.000Z", "edited": true }
}
```

Field limits (the plugin enforces them; Strata should too): `title` 100 chars, `built` 500, `why` 300, `decisions` ≤ 5 × 160, `areas` ≤ 8 × 80, `open` ≤ 5 × 160, `insights`, `workflow`, `painPoints`, `gaps` ≤ 5 × 200 each (all optional, default empty), `files` ≤ 200 repo-relative paths. Plain text only; no code.

`links`: a summary is only sent if it has at least one Jira key, a PR, or `noTicket: true` (an explicit "no ticket exists" from the engineer). `pr` may be `{url}` alone when the engineer typed the link in. **Verify Jira keys and the PR server-side with read-only Jira/GitHub calls; treat them as hints.**

**Acknowledgement is mandatory.** Success is `201 {"ok": true}` for a first write and `200 {"ok": true, "duplicate": true}` for a replay. The plugin treats the summary as delivered only on `ok: true`. A 2xx with any other body (a proxy or captive-portal page, `{}`) is _not delivered_ and is retried.

**Revisions.** A session's summary grows as the engineer keeps working and can be edited by them, even after sending. Each version has a higher integer `revision` and is approved again before it is sent. **The highest approved revision for `(userId, sessionId)` is the session's current summary**; keep older ones for audit if you like, but answer questions from the latest. A replay of the same revision is a no-op.

### Retry semantics the backend should rely on

| Response                                                                    | Plugin does                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `200`/`201` with `ok: true`                                                 | marks that revision sent                                                                           |
| network error, `5xx`, `408`, `425`, `429`, `401`, or 2xx without `ok: true` | keeps it approved and retries on a later flush; stops the batch                                    |
| any other `4xx` (`400`, `403`, `404`, `413`, `422`)                         | final verdict on that revision: shown to the engineer as rejected; editing it makes a new revision |

Use `429` for rate limiting and `401` only for a bad or expired token. After 3 failed uploads in a row the engineer is told once; a `401` marks the sign-in expired and prompts a re-login.

Transport: the plugin refuses to send the token or any event over plain `http://` unless the host is localhost. Redirects are not followed.

## Retract: `DELETE /v1/sessions/:sessionId`

The engineer takes their summary back (the doc's "deletion on request"). Strata removes **every revision** of that session for the authenticated user and returns `200 {"ok": true}`, or `404` if it has nothing (the plugin treats 404 as success). The engineer's local copy stays; it returns to draft and is not sent again unless they approve it again.

## How the summary is produced (for context)

After each turn the plugin queues the redacted turn text and runs a background worker that asks the engineer's own Claude (`claude -p`, small model, no tools, no slash commands, no MCP) to fold it into the session summary. The raw text is deleted as soon as that succeeds, or after 3 failed attempts or 3 days. Secrets, `<private>` blocks, code fences and injected `<system-reminder>`-style blocks are stripped before the model sees the text and again from what it returns. A fully private prompt produces nothing. Subagent turns and background-task notifications are skipped.

## Not decided yet

- The summary schema is a first version; extend it once real summaries have been read.
- Usage and spend reporting (tokens per team and ticket) is not sent yet; the summarizer's own cost is small and stays on the engineer's Claude account.
- Meeting and Teams context are out of scope for the plugin.

## Read: search and roll-ups

Both are optional for the client: a server without them just means no team results. Only the latest approved revision of each session is searched or rolled up, and only for projects the caller's teams can use.

- `GET /v1/search?q=<words>&projectId=<id>` returns `{results:[{kind, text, title, projectId, jira:[], pr, sessionId, author, updatedAt}]}`. `kind` is `built`, `insight`, `workflow`, `pain-point`, `gap` or `decision`. Every word in `q` must match. At most 20 results.
- `GET /v1/rollups?projectId=<id>` returns `{rollups:[{key, kind:"ticket"|"pr"|"none", authors:[], sessions:[{sessionId,title,built,updatedAt}], decisions, insights, workflow, painPoints, gaps}]}`, grouped by Jira key, else PR URL.
