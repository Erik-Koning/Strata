// The versioned-event outbox. Capture never waits on the network: each event is one file under events/,
// redacted and stamped with the contract version, and a detached flusher sends them in batches. The id is
// the server's idempotency key, so a retry can never store the same event twice.
import crypto from "node:crypto";
import fs from "node:fs";
import { apiEvents } from "./api.mjs";
import { log } from "./log.mjs";
import { redactDeep } from "./redact.mjs";
import { getAuth, p, readJson, writeJson } from "./store.mjs";

const BATCH = 100;
const SEND_MS = 10_000;
const STALE_LOCK_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

const dir = () => p("events");
const lockFile = () => p("events", "flush.lock");
const backoffFile = () => p("events", "backoff.json");

/** Write one versioned event, redacted, and return its id. Never touches the network. */
export function enqueueEvent({ sessionID, project, kind, payload, promptID }) {
  const id = crypto.randomUUID();
  const event = {
    v: 1,
    id,
    sessionID,
    scope: { project },
    kind,
    payload: redactDeep(payload),
    ts: new Date().toISOString(),
    ...(promptID ? { promptID } : {}),
  };
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  const name = `${String(Date.now()).padStart(14, "0")}-${id}.json`;
  const tmp = `${p("events", name)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(event), { mode: 0o600 });
  fs.renameSync(tmp, p("events", name));
  return id;
}

export function pendingEvents() {
  try {
    return fs.readdirSync(dir()).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function takeLock() {
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockFile(), String(process.pid), { flag: "wx" });
      return () => fs.rmSync(lockFile(), { force: true });
    } catch {
      try {
        if (Date.now() - fs.statSync(lockFile()).mtimeMs > STALE_LOCK_MS) fs.rmSync(lockFile(), { force: true });
        else return null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const retryable = (error) =>
  !error.status || error.status >= 500 || error.status === 408 || error.status === 425 || error.status === 429;

// An event the server can't take is kept under events/dead/ (never resent, never lost without a trace).
function setAside(name) {
  fs.mkdirSync(p("events", "dead"), { recursive: true, mode: 0o700 });
  fs.renameSync(p("events", name), p("events", "dead", name));
}

// The 202 lists each event it refused by its place in the batch; the rest were stored (or were already).
function refusedIn(answer, count) {
  const refused = new Map();
  for (const entry of Array.isArray(answer?.rejected) ? answer.rejected : []) {
    if (Number.isInteger(entry?.index) && entry.index >= 0 && entry.index < count) refused.set(entry.index, entry);
  }
  return refused;
}

/**
 * Send pending events. Keeps everything on a retryable failure. A batch the server refuses whole, and each event its
 * 202 lists in `rejected[]`, is set aside as dead and logged with the reason.
 */
export async function flushEvents({ force = false, budgetMs = 20_000 } = {}) {
  const auth = getAuth();
  if (!auth?.token) return { sent: 0, dead: 0, left: pendingEvents() };
  const backoff = readJson(backoffFile(), { failures: 0, nextAt: 0 });
  if (!force && backoff.nextAt > Date.now()) return { sent: 0, dead: 0, left: pendingEvents(), skipped: "backoff" };
  const release = takeLock();
  if (!release) return { sent: 0, dead: 0, left: pendingEvents(), skipped: "locked" };

  let sent = 0;
  let dead = 0;
  const deadline = Date.now() + budgetMs;
  try {
    for (;;) {
      if (Date.now() > deadline) break;
      let names;
      try {
        names = fs
          .readdirSync(dir())
          .filter((name) => name.endsWith(".json"))
          .sort()
          .slice(0, BATCH);
      } catch {
        break;
      }
      if (!names.length) break;
      const events = [];
      for (const name of names) {
        try {
          const event = readJson(p("events", name), null);
          if (event?.id) events.push({ name, event });
          else fs.rmSync(p("events", name), { force: true });
        } catch {
          fs.rmSync(p("events", name), { force: true });
        }
      }
      if (!events.length) continue;
      let answer;
      try {
        answer = await apiEvents(
          events.map((entry) => entry.event),
          auth.token,
          SEND_MS,
        );
      } catch (error) {
        if (retryable(error)) throw error;
        // The server refused this batch as malformed: keep it aside so it cannot block the rest.
        for (const entry of events) {
          setAside(entry.name);
          dead += 1;
        }
        log("error", "events rejected", { status: error.status, error: error.message });
        continue;
      }
      const refused = refusedIn(answer, events.length);
      events.forEach((entry, index) => {
        const why = refused.get(index);
        if (!why) {
          fs.rmSync(p("events", entry.name), { force: true });
          sent += 1;
          return;
        }
        setAside(entry.name);
        dead += 1;
        // Why, never what: the code and message describe the shape, not the content.
        log("error", "event rejected", {
          id: entry.event.id,
          kind: entry.event.kind,
          code: why.code,
          reason: String(why.message ?? "").slice(0, 300),
        });
      });
    }
    fs.rmSync(backoffFile(), { force: true });
    return { sent, dead, left: pendingEvents() };
  } catch (error) {
    const failures = (backoff.failures ?? 0) + 1;
    const wait = Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
    writeJson(backoffFile(), { failures, nextAt: Date.now() + wait });
    log("warn", "event upload failed, will retry", { status: error.status, error: error.message });
    return { sent, dead, left: pendingEvents(), error: error.message };
  } finally {
    release();
  }
}
