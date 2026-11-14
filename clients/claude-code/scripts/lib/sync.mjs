import { api } from "./api.mjs";
import { log } from "./log.mjs";
import { describeSession, readSession, readUpload, sessionIds, tryLock, unapprove, writeUpload } from "./records.mjs";
import { getAuth, getBinding, recordFailure, recordSuccess } from "./store.mjs";

const PLUGIN_VERSION = "0.3.0";
const HOOK_BUDGET = { maxEntries: 20, budgetMs: 20_000 }; // a hook has a timeout; a backlog must not eat it

// Retry on: no response (network), 5xx, 401 (re-login fixes it), 408, 425, 429.
// Everything else is a verdict on the summary itself and will never succeed as is.
export function isRetryable(err) {
  const s = err.status;
  return !s || s >= 500 || s === 401 || s === 408 || s === 425 || s === 429;
}

// A session's project: the engineer's choice for the session, else the repo's project.
export const resolveProject = (meta) => meta.projectId ?? getBinding(meta.repoKey)?.projectId ?? null;

/**
 * The only thing that ever leaves the machine: one approved, sanitized summary per session.
 * No prompts, no replies, no per-turn records, no timestamps finer than "last updated".
 */
export function buildEvent(s, projectId) {
  return {
    v: 1,
    idempotencyKey: `${s.sessionId}:summary:${s.revision}`,
    type: "session_summary",
    sessionId: s.sessionId,
    revision: s.revision,
    projectId,
    updatedAt: s.updatedAt,
    client: { plugin: PLUGIN_VERSION, platform: process.platform },
    repo: { remote: s.detected.remote ?? s.remote ?? "", branch: s.detected.branch ?? "", head: s.detected.head ?? "" },
    links: { jira: s.links.jira, pr: s.links.pr, noTicket: s.links.noTicket },
    summary: s.summary,
    files: s.files,
    review: { approved: true, approvedAt: s.approvedAt, edited: s.edited },
  };
}

// Why summaries are not leaving: the dashboard and /status say so instead of leaving the engineer to guess.
export function heldBreakdown() {
  const held = {
    summarizing: 0,
    needsReview: 0,
    noProject: 0,
    signedOut: 0,
    rejected: 0,
    local: 0,
    ready: 0,
  };
  const signedIn = Boolean(getAuth()?.token);
  for (const sid of sessionIds()) {
    const s = describeSession(sid);
    if (!s) continue;
    if (s.status === "summarizing") held.summarizing += 1;
    else if (s.status === "draft" || s.status === "updated") held.needsReview += 1;
    else if (s.status === "rejected") held.rejected += 1;
    else if (s.status === "local") held.local += 1;
    else if (s.status === "ready") {
      if (!resolveProject(s)) held.noProject += 1;
      else if (!signedIn) held.signedOut += 1;
      else held.ready += 1;
    }
  }
  return held;
}

/**
 * Upload approved summaries.
 *   success            -> upload.json says which revision the hub has
 *   retryable failure  -> stays ready, stop the batch, record the failure
 *   final rejection    -> status rejected for that revision; editing creates a new revision and retries
 *   no project / not signed in -> untouched, uploads when that changes
 */
export async function flush({
  only = null,
  maxEntries = HOOK_BUDGET.maxEntries,
  budgetMs = HOOK_BUDGET.budgetMs,
} = {}) {
  const result = { sent: 0, rejected: 0, failed: 0, error: null };
  const auth = getAuth();
  if (!auth?.token) return result;

  const deadline = Date.now() + budgetMs;
  const candidates = (only ? [only] : sessionIds())
    .map(describeSession)
    .filter((s) => s?.status === "ready" && resolveProject(s))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, maxEntries);

  for (const s of candidates) {
    if (Date.now() > deadline) break;
    const release = tryLock(s.sessionId, "upload", 5 * 60 * 1000); // two flushers never send the same revision
    if (!release) continue;
    try {
      // Re-read under the lock: another flusher may have finished it, or the engineer may have edited it.
      const fresh = describeSession(s.sessionId);
      if (fresh?.status !== "ready") continue;
      const projectId = resolveProject(fresh);
      const event = buildEvent(fresh, projectId);
      try {
        const ack = await api("POST", "/v1/events", event, {
          token: auth.token,
          headers: { "idempotency-key": event.idempotencyKey },
        });
        // A 200 is not enough: only an explicit acknowledgement means the Strata has it.
        if (ack.ok !== true) throw Object.assign(new Error("Strata did not acknowledge the summary"), { status: 502 });
        writeUpload(s.sessionId, {
          state: "synced",
          syncedRevision: fresh.revision,
          syncedAt: new Date().toISOString(),
          projectId,
          attempts: 0,
          lastError: null,
        });
        result.sent += 1;
        recordSuccess();
      } catch (err) {
        const note = {
          lastError: String(err.message).slice(0, 200),
          lastStatus: err.status ?? null,
          lastAttemptAt: new Date().toISOString(),
          attempts: readUpload(s.sessionId).attempts + 1,
        };
        if (isRetryable(err)) {
          writeUpload(s.sessionId, note);
          recordFailure(err);
          log("warn", "upload failed, will retry", { status: err.status, error: err.message });
          result.failed += 1;
          result.error = err.message;
          break;
        }
        log("error", "Strata rejected a summary", { status: err.status, code: err.code });
        writeUpload(s.sessionId, { ...note, state: "rejected", rejectedRevision: fresh.revision });
        result.rejected += 1;
      }
    } finally {
      release();
    }
  }
  return result;
}

/** Ask the hub to forget a session's summary. The engineer's local copy and edits stay; it returns to draft. */
export async function retract(sid) {
  const auth = getAuth();
  if (!auth?.token) throw Object.assign(new Error("sign in to retract"), { status: 401 });
  const meta = readSession(sid);
  if (!meta) throw Object.assign(new Error("no such session"), { status: 404 });
  try {
    await api("DELETE", `/v1/sessions/${encodeURIComponent(sid)}`, undefined, { token: auth.token });
  } catch (err) {
    if (err.status !== 404) throw err; // 404: the hub already has nothing
  }
  writeUpload(sid, { state: "retracted", syncedRevision: 0, rejectedRevision: 0, lastError: null });
  unapprove(sid); // retracting is a decision to send nothing until approved again
  return { ok: true };
}
