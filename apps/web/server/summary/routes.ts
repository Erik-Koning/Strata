// The /v1 routes the summary-first client uses: device sign-in, projects, approved summaries,
// retraction, search and roll-ups. Every write is one engineer-approved session summary.
import { CONTRACT_VERSION, MIN_CONTRACT_VERSION, SessionSummaryEvent } from "@strata/contracts";
import { auth } from "../auth.ts";
import { db } from "../db.ts";
import { createKey } from "../keys.ts";
import { parseV1, readObject, requireUser, V1Error, v1Json, v1Route } from "../v1.ts";
import { isEmptySummary, sanitizeFiles, sanitizeLinks, sanitizeSummary } from "./sanitize.ts";
import {
  assertMember,
  deleteSession,
  ensureDefaultProject,
  findUser,
  latestRevisions,
  projectsFor,
  resolveProjectIds,
  rollupsFor,
  searchRevisions,
  storeRevision,
} from "./store.ts";

const RAW_FIELDS = ["prompt", "assistantMessage", "turn", "messages", "transcript", "payload"];

function deviceError(error: unknown): V1Error {
  const body = (error as { body?: { error?: unknown; error_description?: unknown } }).body;
  const raw = typeof body?.error === "string" ? body.error : (error as { code?: unknown }).code;
  const code = typeof raw === "string" && raw ? raw : "invalid_grant";
  const message =
    typeof body?.error_description === "string"
      ? body.error_description
      : error instanceof Error
        ? error.message
        : "Sign-in failed.";
  return new V1Error(400, code, message);
}

// POST /v1/auth/device — the plugin sends { client }, Better Auth wants { client_id }.
export const postDeviceCode = v1Route(async (request) => {
  const body = await readObject(request);
  const client =
    typeof body.client === "string" && body.client.trim() ? body.client.trim().slice(0, 60) : "strata-plugin";
  const device = await auth().api.deviceCode({ body: { client_id: client } });
  return v1Json(device);
});

// POST /v1/auth/token — the plugin sends { device_code }; fill in the grant type and client,
// then exchange the resulting Better Auth session for a long-lived API key.
export const postDeviceToken = v1Route(async (request) => {
  const body = await readObject(request);
  const deviceCode = typeof body.device_code === "string" ? body.device_code.trim() : "";
  if (!deviceCode) throw new V1Error(400, "invalid_request", "device_code is required.");

  let token: { access_token: string };
  try {
    token = await auth().api.deviceToken({
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: "strata-plugin",
      },
    });
  } catch (error) {
    throw deviceError(error);
  }

  const session = await auth()
    .api.getSession({ headers: new Headers({ authorization: `Bearer ${token.access_token}` }) })
    .catch(() => null);
  if (!session?.user) throw new V1Error(502, "server_error", "The device sign-in did not produce a session.");

  const { key } = await createKey(session.user.id, "Claude Code");
  // The plugin keeps the API key, not this session; revoke the unused session so it cannot linger.
  await db()
    .collection("session")
    .deleteOne({ token: token.access_token })
    .catch(() => undefined);

  return v1Json({
    access_token: key,
    token_type: "Bearer",
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
  });
});

// GET /v1/me
export const getMe = v1Route(async (request) => {
  const me = await requireUser(request);
  const user = await findUser(me.userId);
  return v1Json({
    user: { id: me.userId, name: user?.name ?? "", email: user?.email ?? "" },
  });
});

// GET /v1/projects — the caller's projects. The first call creates their personal project.
export const getProjects = v1Route(async (request) => {
  const me = await requireUser(request);
  const user = await findUser(me.userId);
  await ensureDefaultProject(me.userId, user?.name ?? "");
  return v1Json({ projects: await projectsFor(me.userId) });
});

// POST /v1/events — one approved summary revision. Raw prompts, replies and turns are refused.
export const postSummaryEvent = v1Route(async (request) => {
  const me = await requireUser(request);
  const raw = await readObject(request);
  if (RAW_FIELDS.some((field) => field in raw)) throw new V1Error(422, "raw_content_not_accepted");

  const event = parseV1(SessionSummaryEvent, raw);
  if (event.v < MIN_CONTRACT_VERSION)
    throw new V1Error(
      426,
      "upgrade_required",
      `This client writes an older contract than the API accepts (versions ${MIN_CONTRACT_VERSION} to ${CONTRACT_VERSION}). Update the plugin.`,
    );
  const header = request.headers.get("idempotency-key");
  if (header && header !== event.idempotencyKey)
    throw new V1Error(400, "idempotency_mismatch", "The Idempotency-Key header and body differ.");
  if (event.review.approved !== true || !event.review.approvedAt) throw new V1Error(422, "not_approved");

  await assertMember(me.userId, event.projectId);
  const summary = sanitizeSummary(event.summary);
  if (isEmptySummary(summary)) throw new V1Error(422, "empty_summary");
  // Links are optional: a summary may arrive with no ticket and no PR.
  const links = sanitizeLinks(event.links);

  const { duplicate } = await storeRevision({
    v: event.v,
    userId: me.userId,
    sessionId: event.sessionId,
    projectId: event.projectId,
    revision: event.revision,
    idempotencyKey: event.idempotencyKey,
    updatedAt: new Date(event.updatedAt),
    client: event.client ?? null,
    repo: event.repo,
    links,
    summary,
    files: sanitizeFiles(event.files),
    review: {
      approved: true,
      approvedAt: new Date(event.review.approvedAt),
      edited: event.review.edited,
    },
  });
  return duplicate ? v1Json({ ok: true, duplicate: true }, 200) : v1Json({ ok: true }, 201);
});

// DELETE /v1/sessions/:sessionId — retract every revision of one session.
export const deleteSessionSummary = v1Route(async (request, sessionId: string) => {
  const me = await requireUser(request);
  const deleted = await deleteSession(me.userId, decodeURIComponent(sessionId));
  if (!deleted) throw new V1Error(404, "not_found");
  return v1Json({ ok: true });
});

// GET /v1/search?q=&projectId=
export const getSearch = v1Route(async (request) => {
  const me = await requireUser(request);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!query) throw new V1Error(400, "query_required");
  const projectIds = await resolveProjectIds(me.userId, url.searchParams.get("projectId"));
  return v1Json({ results: searchRevisions(await latestRevisions(projectIds), query) });
});

// GET /v1/rollups?projectId=
export const getRollups = v1Route(async (request) => {
  const me = await requireUser(request);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) throw new V1Error(400, "project_required", "projectId is required.");
  await assertMember(me.userId, projectId);
  return v1Json({ rollups: rollupsFor(await latestRevisions([projectId])) });
});
