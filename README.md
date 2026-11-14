# Agentic Memory

We need to make opencode extension, latest version, backend full stack nextjs app, MongoDB connected for agentic memory! 

# opencode-memory: OpenCode V2 plugin

GOAL
Thin V2 server plugin: capture session activity, send it to our web app API, inject recalled memory without breaking prompt cache. Only the API touches MongoDB.

RULES
1. Cache: bytes already sent in a session never change.
 - Frozen block: fetched once per session, persisted in ctx.storage, pushed as LAST system entry, byte-identical every request. Render sorted by _id, no timestamps. On fetch failure or existing history: freeze empty.
 - Per-turn recall is appended only to the new prompt text. Never edit system, old messages or tool list mid-session.
 - Re-fetch frozen block only in the compaction hook (cache rebuilds there).
2. Network only in prompt (800ms, fail open) and compaction (5s, else default). context reads ctx.storage only.
3. Writes go through a durable outbox with idempotency keys.
4. Redact secrets before enqueue and again on server. Token from env.

FILES .opencode/plugins/memory/
index.ts, api.ts, outbox.ts (ctx.storage "ob:<ulid>", batch, backoff), freeze.ts ("fz:<sessionID>"), render.ts, redact.ts, tools.ts (memory_search/save/forget)

index.ts
import { Plugin } from "@opencode/plugin"
export default Plugin.define({
 id: "memory",
 async setup(ctx) {
  const api = makeApi(ctx.options)
  const ob = makeOutbox(ctx.storage, api)
  const fz = makeFreeze(ctx.storage, api)
  await ctx.session.hook("prompt", async (e) => {
   await fz.ensure(e.sessionID)
   const hits = await api.recall(e.sessionID, e.prompt.text, 800)
   if (hits.length) e.prompt.text += "\n\n<memory>\n" + render(hits) + "\n</memory>"
  })
  await ctx.session.hook("context", async (e) => {
   const b = await fz.get(e.sessionID) // no network
   if (b) e.system.push({ type: "text", text: b })
  })
  await ctx.session.hook("compaction", async (e) => {
   ob.enqueue({ kind: "transcript", sessionID: e.sessionID, messages: e.messages })
   const s = await api.compress(e.sessionID, e.messages, 5000)
   if (s) e.result = { summary: s }
   await fz.refresh(e.sessionID)
  })
  await ctx.tool.hook("execute.after", (e) =>
   ob.enqueue({ kind: "tool", tool: e.tool, status: e.status }))
  await ctx.tool.transform((ed) => registerTools(ed, api))
  const ac = new AbortController()
  void (async () => {
   for await (const ev of ctx.event.subscribe({ types: MSG_TYPES, signal: ac.signal }))
    ob.enqueue({ kind: "event", ev })
  })()
  const t = setInterval(() => ob.flush(), 5000)
  return () => { ac.abort(); clearInterval(t) }
 },
})

API
POST /memory/events {batch:[{id,sessionID,scope,kind,payload,ts}]} -> 202, dedupe on id
POST /memory/recall {sessionID,scope,query,k} -> {memories:[{_id,kind,text}]}
GET /memory/frozen ?sessionID&scope -> {memories}
POST /memory/compress {sessionID,messages} -> {summary}
POST /memory/forget {ids|query,scope}, cascades to summaries

MONGO
memory_events: raw, unique id, TTL
memories: scope{org,project,user}, kind, text, embedding, provenance{sessionID,messageID,source}, trust, confidence, status(candidate|active|superseded|archived), supersedes, expiresAt
memory_summaries: rollups, sourceIds[]
memory_audit: actor, action, targetIds, ts
Indexes: vector on embedding filtered by scope+status; text on text

BUILD ORDER
1 schemas + API stubs 2 outbox + capture + ingest 3 freeze + context inject 4 prompt recall 5 compaction 6 tools 7 workers: extract > dedupe > embed > summarize > score > policy 8 governance UI + forget cascade

VERIFY IN SOURCE FIRST
- hook event field names (sessionID, messages)
- do prompt.text edits show in the TUI? if so use a hidden part
- event type names for MSG_TYPES; hook timeouts
- editor.add input schema, execute return shape

ACCEPTANCE
- cache-read tokens do not drop after turn 2
- system bytes identical across requests and restart
- API down: prompts proceed, outbox drains later, no dupes
- only user-turn content auto-promotes to active
