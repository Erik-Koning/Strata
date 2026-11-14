// The memory API's handlers, one per route file under app/api/memory. Each authenticates first (401 before anything is
// read), checks its body against the contract, and answers in the one envelope (http.ts).
import {
  CompressRequest,
  EventsRequest,
  ForgetRequest,
  FrozenQuery,
  RecallRequest,
  SaveRequest,
} from "@strata/contracts";
import { actorOf, authenticate, scopeFor } from "../api-auth.ts";
import { check, json, parseBody, route } from "../http.ts";
import { indexesReady } from "../indexes.ts";
import { compress } from "./compress.ts";
import { forget } from "./forget.ts";
import { frozen } from "./frozen.ts";
import { ingest } from "./ingest.ts";
import { recall } from "./recall.ts";
import { saveMemory } from "./save.ts";
import { hit } from "./store.ts";

export const postEvents = route(async (request) => {
  const principal = await authenticate(request);
  const body = await parseBody(request, EventsRequest);
  await indexesReady();
  return json(await ingest(principal, body.batch), 202);
});

export const postRecall = route(async (request) => {
  const principal = await authenticate(request);
  const body = await parseBody(request, RecallRequest);
  return json({ memories: await recall(scopeFor(principal, body.scope), body.query, body.k) });
});

export const getFrozen = route(async (request) => {
  const principal = await authenticate(request);
  const query = check(FrozenQuery, Object.fromEntries(new URL(request.url).searchParams));
  const { sessionID: _, ...scope } = query;
  return json({ memories: await frozen(scopeFor(principal, scope)) });
});

export const postCompress = route(async (request) => {
  const principal = await authenticate(request);
  const body = await parseBody(request, CompressRequest);
  return json({
    summary: await compress(actorOf(principal), scopeFor(principal, body.scope), body.sessionID, body.messages),
  });
});

export const postForget = route(async (request) => {
  const principal = await authenticate(request);
  const body = await parseBody(request, ForgetRequest);
  const scope = scopeFor(principal, body.scope);
  return json(
    await forget({ actor: actorOf(principal), owner: scope, ids: body.ids, query: body.query, dryRun: body.dryRun }),
  );
});

export const postSave = route(async (request) => {
  const principal = await authenticate(request);
  const body = await parseBody(request, SaveRequest);
  await indexesReady();
  const memory = await saveMemory({
    actor: actorOf(principal),
    scope: scopeFor(principal, body.scope),
    text: body.text,
    kind: body.kind,
    sessionID: body.sessionID ?? null,
    source: "tool",
  });
  return json({ memory: hit(memory) }, 201);
});
