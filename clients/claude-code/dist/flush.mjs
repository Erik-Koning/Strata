// Strata for Claude Code. Built from src/ by build.ts: edit those, not this.

// src/config.ts
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
var VERSION = true ? "0.1.0" : "dev";
var CLIENT = `claude-code/${VERSION}`;
function setting(env, ...names) {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value && !value.startsWith("${")) return value;
  }
  return null;
}
function memoryHome(env = process.env) {
  return setting(env, "MEMORY_HOME", "CLAUDE_PLUGIN_DATA") ?? join(homedir(), ".claude", "strata");
}
function loadConfig(env = process.env, cwd) {
  const apiUrl = setting(env, "MEMORY_API_URL", "CLAUDE_PLUGIN_OPTION_API_URL", "STRATA_API_URL");
  const token = setting(env, "MEMORY_API_TOKEN", "CLAUDE_PLUGIN_OPTION_API_TOKEN", "STRATA_API_TOKEN");
  if (!apiUrl || !token) return null;
  const where = setting(env, "CLAUDE_PROJECT_DIR") ?? cwd ?? process.cwd();
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    token,
    home: memoryHome(env),
    project: setting(env, "MEMORY_PROJECT") ?? projectOf(where)
  };
}
function normalizeRemote(remote) {
  const url = remote.trim();
  if (!url) return null;
  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(url);
  let host;
  let path;
  if (scp) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  if (!host || !path) return null;
  return `${host.toLowerCase()}/${path}`;
}
function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500
    }).trim() || null;
  } catch {
    return null;
  }
}
function projectOf(cwd) {
  const remote = git(cwd, ["config", "--get", "remote.origin.url"]);
  const normalized = remote ? normalizeRemote(remote) : null;
  if (normalized) return normalized;
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  return basename(top ?? cwd) || "default";
}

// src/api.ts
var ApiError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function makeApi(config) {
  async function call(method, path, body, ms) {
    const response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        "x-memory-client": CLIENT,
        ...body === void 0 ? {} : { "content-type": "application/json" }
      },
      ...body === void 0 ? {} : { body: JSON.stringify(body) },
      signal: AbortSignal.timeout(ms)
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const message = parsed?.error?.message;
      throw new ApiError(response.status, typeof message === "string" ? message : `HTTP ${response.status}`);
    }
    return parsed;
  }
  return {
    events: (batch, ms) => call("POST", "/api/memory/events", { batch }, ms),
    recall: (body, ms) => call("POST", "/api/memory/recall", body, ms),
    frozen: ({ sessionID, project }, ms) => call("GET", `/api/memory/frozen?${new URLSearchParams({ sessionID, project }).toString()}`, void 0, ms),
    compress: (body, ms) => call("POST", "/api/memory/compress", body, ms),
    forget: (body, ms) => call("POST", "/api/memory/forget", body, ms),
    save: (body, ms) => call("POST", "/api/memory/save", body, ms)
  };
}

// src/outbox.ts
import { closeSync, mkdirSync, openSync, rmSync, statSync, utimesSync } from "node:fs";
import { join as join2 } from "node:path";
var OUTBOX = "ob:";
var DEAD = "dead:";
var BACKOFF = "bo:state";
var BATCH = 100;
var SEND_MS = 1e4;
var STALE_LOCK_MS = 6e4;
var MAX_BACKOFF_MS = 5 * 6e4;
var pending = (store) => store.keys(OUTBOX).length;
function readBackoff(store) {
  try {
    const parsed = JSON.parse(store.get(BACKOFF) ?? "");
    return { failures: Number(parsed.failures) || 0, nextAt: Number(parsed.nextAt) || 0 };
  } catch {
    return { failures: 0, nextAt: 0 };
  }
}
function takeLock(dir, now) {
  mkdirSync(dir, { recursive: true });
  const lock = join2(dir, "flush.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(lock, "wx"));
      return () => rmSync(lock, { force: true });
    } catch {
      try {
        if (now - statSync(lock).mtimeMs > STALE_LOCK_MS) rmSync(lock, { force: true });
        else return null;
      } catch {
      }
    }
  }
  return null;
}
var touch = (dir) => {
  try {
    const now = /* @__PURE__ */ new Date();
    utimesSync(join2(dir, "flush.lock"), now, now);
  } catch {
  }
};
var refused = (error) => error instanceof ApiError && (error.status === 400 || error.status === 413 || error.status === 422);
async function flush(store, api, options = { home: "" }) {
  const now = options.now ?? Date.now();
  const backoff = readBackoff(store);
  if (!options.force && backoff.nextAt > now) return { sent: 0, dead: 0, left: pending(store), skipped: "backoff" };
  const release = takeLock(options.home || store.dir, now);
  if (!release) return { sent: 0, dead: 0, left: pending(store), skipped: "locked" };
  let sent = 0;
  let dead = 0;
  try {
    for (; ; ) {
      const keys = store.keys(OUTBOX).slice(0, options.batch ?? BATCH);
      if (!keys.length) break;
      const events = [];
      for (const key of keys) {
        const raw = store.get(key);
        try {
          if (raw === null) continue;
          events.push({ key, event: JSON.parse(raw) });
        } catch {
          if (raw !== null) store.set(`${DEAD}${key.slice(OUTBOX.length)}`, raw);
          store.delete(key);
          dead++;
        }
      }
      if (!events.length) continue;
      try {
        await api.events(
          events.map((e) => e.event),
          SEND_MS
        );
        for (const { key } of events) store.delete(key);
        sent += events.length;
      } catch (error) {
        if (!refused(error)) throw error;
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
    const wait = Math.min(1e3 * 2 ** (failures - 1), MAX_BACKOFF_MS);
    store.set(BACKOFF, JSON.stringify({ failures, nextAt: now + wait }));
    return { sent, dead, left: pending(store), error: error instanceof Error ? error.message : String(error) };
  } finally {
    release();
  }
}

// src/store.ts
import { existsSync, mkdirSync as mkdirSync2, readdirSync, readFileSync, renameSync, rmSync as rmSync2, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";
var encode = (key) => key.replace(/[^A-Za-z0-9._-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
var decode = (file) => file.replace(/%([0-9a-f]{2})/g, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
function openStore(home) {
  const dir = join3(home, "kv");
  mkdirSync2(dir, { recursive: true, mode: 448 });
  const path = (key) => join3(dir, encode(key));
  return {
    dir,
    get(key) {
      try {
        return readFileSync(path(key), "utf8");
      } catch {
        return null;
      }
    },
    set(key, value) {
      const target = path(key);
      const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(temporary, value, { mode: 384 });
      renameSync(temporary, target);
    },
    delete(key) {
      rmSync2(path(key), { force: true });
    },
    keys(prefix) {
      if (!existsSync(dir)) return [];
      const start = encode(prefix);
      return readdirSync(dir).filter((file) => file.startsWith(start) && !file.endsWith(".tmp")).sort().map(decode);
    }
  };
}

// src/flush.ts
async function main() {
  const config = loadConfig();
  if (!config) return;
  await flush(openStore(config.home), makeApi(config), { home: config.home, force: process.argv.includes("--force") });
}
main().catch(() => void 0).finally(() => {
  process.exitCode = 0;
});
