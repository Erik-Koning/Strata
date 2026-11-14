// The durable outbox. Capturing never waits on the network: a hook writes each event to its own file ("ob:<ulid>") and
// carries on. A flusher, started in the background, sends them in batches and deletes only what the API acknowledged.
// The ulid is the event's id and its idempotency key: the API keeps an event once whatever happens here (a flusher
// killed after sending and before deleting sends it again, and the API answers "duplicate").
//
// One flusher at a time, by a lock file; a lock older than a minute is a flusher that died, and is taken over. After a
// failure the outbox backs off (1 s, 2 s, 4 s … up to 5 min) so a dead API isn't hammered by every hook.
import { closeSync, mkdirSync, openSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import type { EventKind, MemoryEvent, PayloadOf } from "@strata/contracts";
import { redactDeep } from "@strata/contracts/redact";
import { CONTRACT_VERSION } from "@strata/contracts/version";
import { type Api, ApiError } from "./api.ts";
import type { Store } from "./store.ts";
import { ulid } from "./ulid.ts";

export const OUTBOX = "ob:";
const DEAD = "dead:";
const BACKOFF = "bo:state";
const BATCH = 100;
const SEND_MS = 10_000;
const STALE_LOCK_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export type NewEvent = {
  [K in EventKind]: { sessionID: string; project: string; kind: K; payload: PayloadOf<K>; promptID?: string };
}[EventKind];

// Writes the event, redacted and stamped with the contract version it's written to, and returns its id. Never touches
// the network.
export function enqueue(store: Store, event: NewEvent, now: number = Date.now()): string {
  const id = ulid(now);
  const stored = {
    v: CONTRACT_VERSION,
    id,
    sessionID: event.sessionID,
    scope: { project: event.project },
    kind: event.kind,
    payload: redactDeep(event.payload),
    ts: new Date(now).toISOString(),
    ...(event.promptID ? { promptID: event.promptID } : {}),
  } as MemoryEvent;
  store.set(`${OUTBOX}${id}`, JSON.stringify(stored));
  return id;
}

export const pending = (store: Store): number => store.keys(OUTBOX).length;

interface Backoff {
  failures: number;
  nextAt: number;
}

function readBackoff(store: Store): Backoff {
  try {
    const parsed = JSON.parse(store.get(BACKOFF) ?? "") as Backoff;
    return { failures: Number(parsed.failures) || 0, nextAt: Number(parsed.nextAt) || 0 };
  } catch {
    return { failures: 0, nextAt: 0 };
  }
}

export interface FlushResult {
  sent: number;
  // Events the API refused as malformed, set aside under "dead:" so they never block the rest.
  dead: number;
  left: number;
  skipped?: "locked" | "backoff";
  error?: string;
}

function takeLock(dir: string, now: number): (() => void) | null {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "flush.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(lock, "wx"));
      return () => rmSync(lock, { force: true });
    } catch {
      try {
        if (now - statSync(lock).mtimeMs > STALE_LOCK_MS) rmSync(lock, { force: true });
        else return null;
      } catch {
        // Gone between the two calls: try again.
      }
    }
  }
  return null;
}

const touch = (dir: string): void => {
  try {
    const now = new Date();
    utimesSync(join(dir, "flush.lock"), now, now);
  } catch {
    // The lock is ours; a failed touch only risks another flusher taking it after a minute.
  }
};

// A 400 or 422 means the API won't take what was sent, not that it's down. A 426 (upgrade_required) is neither: the
// events are kept, with the usual back-off, until the plugin is updated.
const refused = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 400 || error.status === 413 || error.status === 422);

export async function flush(
  store: Store,
  api: Api,
  options: { home: string; now?: number; force?: boolean; batch?: number } = { home: "" },
): Promise<FlushResult> {
  const now = options.now ?? Date.now();
  const backoff = readBackoff(store);
  if (!options.force && backoff.nextAt > now) return { sent: 0, dead: 0, left: pending(store), skipped: "backoff" };
  const release = takeLock(options.home || store.dir, now);
  if (!release) return { sent: 0, dead: 0, left: pending(store), skipped: "locked" };
  let sent = 0;
  let dead = 0;
  try {
    for (;;) {
      const keys = store.keys(OUTBOX).slice(0, options.batch ?? BATCH);
      if (!keys.length) break;
      const events: { key: string; event: MemoryEvent }[] = [];
      for (const key of keys) {
        const raw = store.get(key);
        try {
          if (raw === null) continue;
          events.push({ key, event: JSON.parse(raw) as MemoryEvent });
        } catch {
          // Unreadable: keep it aside, out of the way.
          if (raw !== null) store.set(`${DEAD}${key.slice(OUTBOX.length)}`, raw);
          store.delete(key);
          dead++;
        }
      }
      if (!events.length) continue;
      try {
        const answer = await api.events(
          events.map((e) => e.event),
          SEND_MS,
        );
        // The API lists each event it refused, and why: those are set aside, and the rest are delivered.
        const refusedAt = new Set((answer?.rejected ?? []).map((r) => r.index));
        events.forEach(({ key, event }, index) => {
          if (refusedAt.has(index)) {
            store.set(`${DEAD}${event.id}`, JSON.stringify(event));
            dead++;
          } else sent++;
          store.delete(key);
        });
      } catch (error) {
        if (!refused(error)) throw error;
        // An API from before contract version 1 refuses a bad batch whole: send them one by one, and set aside each
        // the API refuses.
        for (const { key, event } of events) {
          try {
            await api.events([event], SEND_MS);
            store.delete(key);
            sent++;
          } catch (single) {
            if (!refused(single)) throw single;
            store.set(`${DEAD}${event.id}`, JSON.stringify(event));
            store.delete(key);
            dead++;
          }
        }
      }
      touch(options.home || store.dir);
    }
    store.delete(BACKOFF);
    return { sent, dead, left: pending(store) };
  } catch (error) {
    const failures = backoff.failures + 1;
    const wait = Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
    store.set(BACKOFF, JSON.stringify({ failures, nextAt: now + wait }));
    return { sent, dead, left: pending(store), error: error instanceof Error ? error.message : String(error) };
  } finally {
    release();
  }
}
