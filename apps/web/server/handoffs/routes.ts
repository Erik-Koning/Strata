// The handoff API's handlers, one per route file under app/api/handoffs. Each authenticates first (401 before anything
// is read; the service token gets 403, since a handoff is between people), checks its body against the contract, and
// answers in the one envelope (http.ts). The rules themselves are in service.ts.
import {
  ApproveHandoffRequest,
  ClaimHandoffRequest,
  CompleteHandoffRequest,
  CreateHandoffRequest,
  ListHandoffsQuery,
  RecordTestRequest,
  RevokeHandoffRequest,
  UpdateHandoffRequest,
} from "@strata/contracts";
import { authenticate } from "../api-auth.ts";
import { ApiError, check, json, parseBody, route } from "../http.ts";
import * as handoffs from "./service.ts";

export interface IdContext {
  params: Promise<{ id: string }>;
}

const isJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

const caller = async (request: Request) => handoffs.callerFromPrincipal(await authenticate(request));

export const postHandoffs = route(async (request) => {
  const c = await caller(request);
  const body = await parseBody(request, CreateHandoffRequest);
  return json({ handoff: await handoffs.createHandoff(c, body) }, 201);
});

export const getHandoffs = route(async (request) => {
  const c = await caller(request);
  const { box } = check(ListHandoffsQuery, Object.fromEntries(new URL(request.url).searchParams));
  return json({ handoffs: await handoffs.listHandoffs(c, box) });
});

export const getRecipients = route(async (request) => {
  const c = await caller(request);
  return json({ people: await handoffs.listRecipients(c) });
});

export const getHandoff = route(async (request, ctx: IdContext) => {
  const c = await caller(request);
  return json({ handoff: await handoffs.getHandoff(c, (await ctx.params).id) });
});

export const patchHandoff = route(async (request, ctx: IdContext) => {
  const c = await caller(request);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "bad_json", "The body isn't JSON.");
  }
  check(UpdateHandoffRequest, raw);
  // The raw body goes on, so only the fields it names change (the contract would fill the rest with defaults).
  return json({ handoff: await handoffs.updateHandoff(c, (await ctx.params).id, raw as UpdateHandoffRequest) });
});

export const postApprove = route(async (request, ctx: IdContext) => {
  const c = await caller(request);
  const body = await parseBody(request, ApproveHandoffRequest);
  return json({ handoff: await handoffs.approveHandoff(c, (await ctx.params).id, body) });
});

export const postClaim = route(async (request, ctx: IdContext) => {
  const c = await caller(request);
  const body = await parseBody(request, ClaimHandoffRequest);
  return json({ handoff: await handoffs.claimHandoff(c, (await ctx.params).id, body) });
});

export const postTest = route(async (request, ctx: IdContext) => {
  const c = await caller(request);
  const body = await parseBody(request, RecordTestRequest);
  return json({ handoff: await handoffs.recordTest(c, (await ctx.params).id, body) });
});

export const postComplete = route(async (request, ctx: IdContext) => {
  const c = await caller(request);
  const body = await parseBody(request, CompleteHandoffRequest);
  return json({ handoff: await handoffs.completeHandoff(c, (await ctx.params).id, body) });
});

export const postRevoke = route(async (request, ctx: IdContext) => {
  const c = await caller(request);
  // A reason is optional, and so is the body.
  const text = await request.text();
  if (text.trim() && !isJson(text)) throw new ApiError(400, "bad_json", "The body isn't JSON.");
  const body = check(RevokeHandoffRequest, text.trim() ? JSON.parse(text) : {});
  return json({ handoff: await handoffs.revokeHandoff(c, (await ctx.params).id, body) });
});

export const getResume = route(async (request, ctx: IdContext) => {
  const c = await caller(request);
  return json(await handoffs.resumeHandoff(c, (await ctx.params).id));
});
