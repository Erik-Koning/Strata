import fs from "node:fs";
import { EMPTY_SUMMARY, FINDING_KINDS, sanitizeSummary } from "./schema.mjs";
import { p, readJson, settings, writeJson } from "./store.mjs";

// Local store: ~/.strata/store/sessions/<sessionId>/
//   session.json   where it came from + the engineer's choices (project, sync mode, links)
//   summary.json   the session summary the summarizer (or the engineer) wrote, with a revision
//   review.json    which revision the engineer approved
//   upload.json    what Strata has
//   queue/         redacted turn text waiting to be summarized; deleted once summarized
// One writer per file, so the hooks, the summarizer, the syncer and the dashboard never
// overwrite each other.
const safe = (id) => id.replace(/[^\w.-]/g, "_");
export const sessionDir = (sid) => p("store", "sessions", safe(sid));
const file = (sid, name) => `${sessionDir(sid)}/${name}`;

export const SYNC_MODES = ["review", "never"];
export const effectiveMode = (meta) => meta?.sync ?? settings().defaultSync ?? "review";
export const JIRA_RE = /^[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6}$/;
export const PR_RE = /^https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

// ---------- session ----------
export function ensureSession(sid, init) {
  const existing = readJson(file(sid, "session.json"), null);
  if (existing) return existing;
  const meta = {
    sessionId: sid,
    createdAt: new Date().toISOString(),
    projectId: null,
    sync: null,
    linkOverrides: { jira: [], prUrl: null, noTicket: false },
    ...init,
  };
  fs.mkdirSync(sessionDir(sid), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file(sid, "session.json"), JSON.stringify(meta, null, 2), { flag: "wx", mode: 0o600 });
  } catch {
    return readJson(file(sid, "session.json"), meta); // another hook created it first
  }
  return meta;
}
export const readSession = (sid) => readJson(file(sid, "session.json"), null);
export function updateSession(sid, patch) {
  const meta = readSession(sid);
  if (!meta) return null;
  const next = { ...meta, ...patch };
  writeJson(file(sid, "session.json"), next);
  return next;
}

// ---------- queue (raw, redacted, short-lived) ----------
export function enqueueItem(sid, key, item) {
  const dir = file(sid, "queue");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The same turn Stopping twice with the same text is one item, even after the first was summarized.
  const seen = readJson(file(sid, "seen.json"), []);
  if (seen.includes(key)) return false;
  writeJson(file(sid, "seen.json"), [...seen, key].slice(-200));
  writeJson(`${dir}/item-${String(Date.now()).padStart(14, "0")}-${key}.json`, { ...item, attempts: 0 });
  return true;
}
export function listQueue(sid) {
  try {
    return fs
      .readdirSync(file(sid, "queue"))
      .filter((n) => n.endsWith(".json"))
      .sort()
      .flatMap((name) => {
        const item = readJson(file(sid, `queue/${name}`), null);
        return item ? [{ name, ...item }] : [];
      });
  } catch {
    return [];
  }
}
export const removeQueueItem = (sid, name) => fs.rmSync(file(sid, `queue/${name}`), { force: true });
export const bumpQueueItem = (sid, name) => {
  const item = readJson(file(sid, `queue/${name}`), null);
  if (item) writeJson(file(sid, `queue/${name}`), { ...item, attempts: (item.attempts ?? 0) + 1 });
};

// ---------- summary / review / upload ----------
export const readSummary = (sid) => readJson(file(sid, "summary.json"), null);
export const writeSummary = (sid, doc) => writeJson(file(sid, "summary.json"), doc);
export const readReview = (sid) => readJson(file(sid, "review.json"), { approvedRevision: 0 });
export const readUpload = (sid) =>
  readJson(file(sid, "upload.json"), { state: "none", syncedRevision: 0, attempts: 0 });
export const writeUpload = (sid, patch) => writeJson(file(sid, "upload.json"), { ...readUpload(sid), ...patch });

export function approve(sid) {
  const summary = readSummary(sid);
  if (!summary) return false;
  writeJson(file(sid, "review.json"), { approvedRevision: summary.revision, approvedAt: new Date().toISOString() });
  return true;
}
export const unapprove = (sid) => writeJson(file(sid, "review.json"), { approvedRevision: 0 });

// Short-lived exclusive lock, shared by the summarizer and by dashboard edits of summary.json.
export function tryLock(sid, name, ttlMs) {
  const lock = file(sid, `${name}.lock`);
  fs.mkdirSync(sessionDir(sid), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      return () => fs.rmSync(lock, { force: true });
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs <= ttlMs) return null;
        fs.rmSync(lock, { force: true }); // stale lock from a crashed process
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The engineer's edit: a new revision, and the approval no longer matches it. */
export function editSummary(sid, fields) {
  const release = tryLock(sid, "summary", 120_000);
  if (!release) return null; // the summarizer is working on it
  try {
    const current = readSummary(sid) ?? {
      revision: 0,
      summary: EMPTY_SUMMARY,
      files: [],
      detected: { jira: [], pr: null },
    };
    const next = {
      ...current,
      summary: sanitizeSummary({ ...current.summary, ...fields }),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      edited: true,
    };
    writeSummary(sid, next);
    return next;
  } finally {
    release();
  }
}

/**
 * A finding logged live (by the engineer or by the agent through the MCP tool): added to the
 * summary as a new revision, so it goes through the same review and approval as everything else.
 */
export function addFinding(sid, kind, text) {
  const list = FINDING_KINDS[kind];
  if (!list) throw new Error(`kind must be one of: ${Object.keys(FINDING_KINDS).join(", ")}`);
  const clean = sanitizeSummary({ [list]: [text] })[list][0];
  if (!clean) throw new Error("nothing left to record after removing code and secrets");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const release = tryLock(sid, "summary", 120_000);
    if (release) {
      try {
        const current = readSummary(sid) ?? {
          revision: 0,
          summary: EMPTY_SUMMARY,
          files: [],
          detected: { jira: [], pr: null },
        };
        const existing = current.summary[list] ?? [];
        if (existing.includes(clean)) return { ...current, added: false };
        const next = {
          ...current,
          summary: sanitizeSummary({ ...current.summary, [list]: [...existing, clean] }),
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        writeSummary(sid, next);
        return { ...next, added: true };
      } finally {
        release();
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); // the summarizer holds the lock for a moment
  }
  throw new Error("the summary is being updated right now; try again in a moment");
}

// ---------- what Strata will be told, and where we are ----------
export function effectiveLinks(meta, summary) {
  const detected = summary?.detected ?? {};
  const ov = meta.linkOverrides ?? {};
  const jira = [...new Set([...(detected.jira ?? []), ...(ov.jira ?? [])])];
  const pr = ov.prUrl ? { url: ov.prUrl } : (detected.pr ?? null);
  return { jira, pr, noTicket: Boolean(ov.noTicket) };
}

export function describeSession(sid) {
  const meta = readSession(sid);
  if (!meta) return null;
  const sum = readSummary(sid);
  const review = readReview(sid);
  const up = readUpload(sid);
  const queued = listQueue(sid).length;
  const links = effectiveLinks(meta, sum);
  const linked = links.jira.length > 0 || Boolean(links.pr) || links.noTicket;
  const approved = Boolean(sum) && review.approvedRevision === sum.revision;

  let status;
  if (effectiveMode(meta) === "never") status = "local";
  else if (!sum) status = queued ? "summarizing" : "empty";
  else if (up.state === "rejected" && up.rejectedRevision === sum.revision) status = "rejected";
  else if (up.syncedRevision === sum.revision) status = "synced";
  else if (!linked) status = "needs-link";
  else if (!approved) status = up.syncedRevision > 0 ? "updated" : "draft";
  else status = "ready";

  return {
    ...meta,
    status,
    queued,
    linked,
    links,
    approved,
    approvedAt: approved ? review.approvedAt : null,
    summary: sum?.summary ? { ...EMPTY_SUMMARY, ...sum.summary } : null,
    revision: sum?.revision ?? 0,
    updatedAt: sum?.updatedAt ?? meta.createdAt,
    edited: Boolean(sum?.edited),
    files: sum?.files ?? [],
    detected: sum?.detected ?? { jira: [], pr: null },
    upload: up,
    title: sum?.summary?.title || meta.title || "(waiting for a summary)",
  };
}

export function sessionIds() {
  try {
    return fs.readdirSync(p("store", "sessions"));
  } catch {
    return [];
  }
}
export function listSessions({ includeEmpty = false, limit = 500 } = {}) {
  return sessionIds()
    .map(describeSession)
    .filter((s) => s && (includeEmpty || s.status !== "empty"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
export function countByStatus() {
  const totals = {
    sessions: 0,
    summarizing: 0,
    "needs-link": 0,
    draft: 0,
    updated: 0,
    ready: 0,
    synced: 0,
    rejected: 0,
    local: 0,
  };
  for (const s of listSessions()) {
    totals.sessions += 1;
    totals[s.status] = (totals[s.status] ?? 0) + 1;
  }
  return totals;
}

export function deleteSession(sid) {
  fs.rmSync(sessionDir(sid), { recursive: true, force: true });
}

// Raw turn text lives only until it is summarized (the worker deletes it; this is the backstop).
// Synced summaries stay long enough to show what was sent; unsent work is the only copy, so it stays longer.
export function pruneStore({ syncedDays = 30, otherDays = 180, queueDays = 3, emptyDays = 7 } = {}) {
  const cfg = settings().retentionDays ?? {};
  const day = 86_400_000;
  for (const sid of sessionIds()) {
    const s = describeSession(sid);
    if (!s) continue;
    for (const item of listQueue(sid))
      if (Date.now() - fs.statSync(file(sid, `queue/${item.name}`)).mtimeMs > queueDays * day)
        removeQueueItem(sid, item.name);
    const age = Date.now() - new Date(s.updatedAt).getTime();
    const limit =
      s.status === "empty" ? emptyDays : s.status === "synced" ? (cfg.synced ?? syncedDays) : (cfg.other ?? otherDays);
    if (age > limit * day && !(s.status === "summarizing")) deleteSession(sid);
  }
}
