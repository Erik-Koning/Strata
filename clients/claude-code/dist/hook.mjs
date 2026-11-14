// Strata for Claude Code. Built from src/ by build.ts: edit those, not this.

// src/hook.ts
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync as mkdirSync2, statSync, truncateSync } from "node:fs";
import { dirname, join as join3 } from "node:path";
import { fileURLToPath } from "node:url";

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

// ../../packages/contracts/src/redact.ts
var PATTERNS = [
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "stripe-key", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { kind: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "memory-api-key", re: /\bam_[A-Za-z0-9_-]{24,}/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // Credentials in a connection string: the user stays, the password goes.
  {
    kind: "url-password",
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi,
    keep: (_m, before) => before ?? ""
  },
  { kind: "bearer", re: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/g, keep: (_m, before) => before ?? "" },
  // NAME_TOKEN=value, "password": "value", secret: value, api-key = value
  {
    kind: "secret",
    re: /\b((?:[A-Z][A-Z0-9_]*_)?(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CLIENT_?SECRET)|(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret))(["']?\s*[:=]\s*["']?)([^\s"',;]{8,})/gi,
    keep: (_m, name, sep) => `${name ?? ""}${sep ?? ""}`
  }
];
var MARKER = /\[REDACTED:[a-z-]+\]/;
function redact(text) {
  let out = text;
  for (const { kind, re, keep: keep2 } of PATTERNS) {
    out = out.replace(re, (match, ...rest) => {
      if (MARKER.test(match)) return match;
      const groups = rest.filter((g) => typeof g === "string");
      return `${keep2 ? keep2(match, ...groups) : ""}[REDACTED:${kind}]${kind === "url-password" ? groups[2] ?? "@" : ""}`;
    });
  }
  return out;
}
var SECRET_KEY = /^(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|client[_-]?secret)$/i;
function redactDeep(value) {
  return walk(value, null);
}
function walk(value, key2) {
  if (typeof value === "string") return key2 && SECRET_KEY.test(key2) && value ? "[REDACTED:secret]" : redact(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, null));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
    return out;
  }
  return value;
}

// ../../packages/contracts/src/render.ts
var MAX_CHARS = 600;
function line(memory) {
  const text = memory.text.replace(/\s+/g, " ").trim();
  const cut = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}\u2026` : text;
  return `- [${memory.kind}] ${cut}`;
}
var byId = (a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
function renderFrozen(memories) {
  if (!memories.length) return "";
  const lines = [...memories].sort(byId).map(line);
  return [
    "<memory-frozen>",
    "Long-term memory about this user and project, from earlier sessions. Follow it unless the user says otherwise.",
    ...lines,
    "</memory-frozen>"
  ].join("\n");
}
function renderRecall(memories) {
  if (!memories.length) return "";
  return ["<memory>", "Recalled for this message:", ...[...memories].sort(byId).map(line), "</memory>"].join("\n");
}

// src/freeze.ts
var FROZEN_MS = 800;
var key = (sessionID) => `fz:${sessionID}`;
function frozenBlock(store, sessionID) {
  const raw = store.get(key(sessionID));
  if (raw === null) return null;
  try {
    const { block } = JSON.parse(raw);
    return typeof block === "string" ? block : null;
  } catch {
    return null;
  }
}
async function fetchBlock(api, sessionID, project) {
  try {
    const { memories } = await api.frozen({ sessionID, project }, FROZEN_MS);
    return renderFrozen(Array.isArray(memories) ? memories : []);
  } catch {
    return null;
  }
}
var keep = (store, sessionID, block) => {
  store.set(key(sessionID), JSON.stringify({ block }));
  return block;
};
async function ensureFrozen(store, api, sessionID, project, source) {
  const kept = frozenBlock(store, sessionID);
  if (source === "compact") {
    const fresh = await fetchBlock(api, sessionID, project);
    return fresh === null ? kept ?? keep(store, sessionID, "") : keep(store, sessionID, fresh);
  }
  if (source === "clear") return keep(store, sessionID, await fetchBlock(api, sessionID, project) ?? "");
  if (kept !== null) return kept;
  if (source === "resume" || source === "fork") return keep(store, sessionID, "");
  return keep(store, sessionID, await fetchBlock(api, sessionID, project) ?? "");
}

// src/ulid.ts
import { randomBytes } from "node:crypto";
var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var lastTime = -1;
var lastRandom = [];
function encodeTime(time) {
  let out = "";
  let rest = time;
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}
function freshRandom() {
  const bytes = randomBytes(16);
  return Array.from({ length: 16 }, (_, i) => (bytes[i] ?? 0) % 32);
}
function increment(digits) {
  const out = [...digits];
  for (let i = out.length - 1; i >= 0; i--) {
    if ((out[i] ?? 0) < 31) {
      out[i] = (out[i] ?? 0) + 1;
      return out;
    }
    out[i] = 0;
  }
  return out;
}
function ulid(now = Date.now()) {
  if (now <= lastTime) {
    lastRandom = increment(lastRandom);
  } else {
    lastTime = now;
    lastRandom = freshRandom();
  }
  return encodeTime(lastTime) + lastRandom.map((d) => ALPHABET[d]).join("");
}

// src/outbox.ts
var OUTBOX = "ob:";
var MAX_BACKOFF_MS = 5 * 6e4;
function enqueue(store, event, now = Date.now()) {
  const id = ulid(now);
  const stored = {
    id,
    sessionID: event.sessionID,
    scope: { project: event.project },
    kind: event.kind,
    payload: redactDeep(event.payload),
    ts: new Date(now).toISOString()
  };
  store.set(`${OUTBOX}${id}`, JSON.stringify(stored));
  return id;
}

// src/transcript.ts
import { readFileSync } from "node:fs";
var MAX_MESSAGES = 400;
var MAX_CHARS2 = 8e3;
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}
function parseTranscript(jsonl) {
  const messages = [];
  for (const line2 of jsonl.split("\n")) {
    if (!line2.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line2);
    } catch {
      continue;
    }
    if (entry.isMeta === true || entry.type !== "user" && entry.type !== "assistant") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(entry.message?.content).trim();
    if (!text) continue;
    messages.push({
      role,
      text: text.length > MAX_CHARS2 ? text.slice(0, MAX_CHARS2) : text,
      ...typeof entry.uuid === "string" ? { id: entry.uuid } : {}
    });
  }
  return messages.slice(-MAX_MESSAGES);
}
function readTranscript(path) {
  if (!path) return [];
  try {
    return parseTranscript(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

// src/hooks.ts
var RECALL_MS = 800;
var COMPRESS_MS = 5e3;
var RECALL_K = 6;
var SOURCES = /* @__PURE__ */ new Set(["startup", "resume", "clear", "compact", "fork"]);
var context = (event, text) => text ? JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }) : "";
async function handle(input, deps) {
  const { config, store, api, kick } = deps;
  const sessionID = input.session_id;
  const event = input.hook_event_name ?? "";
  if (!sessionID) return "";
  const capture = (kind, payload) => enqueue(store, { sessionID, project: config.project, kind, payload });
  switch (event) {
    case "SessionStart": {
      const source = SOURCES.has(input.source) ? input.source : "startup";
      const block = await ensureFrozen(store, api, sessionID, config.project, source);
      capture("session", { event: "start", source });
      kick();
      return context("SessionStart", block);
    }
    case "UserPromptSubmit": {
      const prompt = input.prompt ?? "";
      if (!prompt.trim()) return "";
      capture("prompt", { role: "user", text: prompt });
      let recalled = "";
      try {
        const { memories } = await api.recall(
          { sessionID, scope: { project: config.project }, query: redact(prompt).slice(0, 8e3), k: RECALL_K },
          RECALL_MS
        );
        recalled = renderRecall(Array.isArray(memories) ? memories : []);
      } catch {
      }
      kick();
      return context("UserPromptSubmit", recalled);
    }
    case "PostToolUse":
    case "PostToolUseFailure":
      capture("tool", { tool: input.tool_name ?? "unknown", status: event === "PostToolUseFailure" ? "error" : "ok" });
      return "";
    case "PreCompact": {
      const messages = readTranscript(input.transcript_path);
      if (messages.length) {
        capture("transcript", { trigger: input.trigger ?? null, messages });
        try {
          await api.compress(
            {
              sessionID,
              scope: { project: config.project },
              messages: messages.map((m) => ({ ...m, text: redact(m.text) }))
            },
            COMPRESS_MS
          );
        } catch {
        }
      }
      kick();
      return "";
    }
    case "PostCompact":
      if (input.compact_summary)
        capture("event", { type: "compact_summary", trigger: input.trigger ?? null, text: input.compact_summary });
      return "";
    case "Stop":
      if (input.last_assistant_message) capture("assistant", { role: "assistant", text: input.last_assistant_message });
      kick();
      return "";
    case "SessionEnd":
      capture("session", { event: "end", reason: input.reason ?? null });
      kick();
      return "";
    default:
      return "";
  }
}

// src/store.ts
import { existsSync, mkdirSync, readdirSync, readFileSync as readFileSync2, renameSync, rmSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var encode = (key2) => key2.replace(/[^A-Za-z0-9._-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
var decode = (file) => file.replace(/%([0-9a-f]{2})/g, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
function openStore(home) {
  const dir = join2(home, "kv");
  mkdirSync(dir, { recursive: true, mode: 448 });
  const path = (key2) => join2(dir, encode(key2));
  return {
    dir,
    get(key2) {
      try {
        return readFileSync2(path(key2), "utf8");
      } catch {
        return null;
      }
    },
    set(key2, value) {
      const target = path(key2);
      const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(temporary, value, { mode: 384 });
      renameSync(temporary, target);
    },
    delete(key2) {
      rmSync(path(key2), { force: true });
    },
    keys(prefix) {
      if (!existsSync(dir)) return [];
      const start = encode(prefix);
      return readdirSync(dir).filter((file) => file.startsWith(start) && !file.endsWith(".tmp")).sort().map(decode);
    }
  };
}

// src/hook.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
function kickFlush() {
  try {
    const flusher = join3(dirname(fileURLToPath(import.meta.url)), "flush.mjs");
    spawn(process.execPath, [flusher], { detached: true, stdio: "ignore", env: process.env }).unref();
  } catch {
  }
}
function logError(home, error) {
  try {
    mkdirSync2(home, { recursive: true });
    const log = join3(home, "errors.log");
    try {
      if (statSync(log).size > 256 * 1024) truncateSync(log, 0);
    } catch {
    }
    const message = error instanceof Error ? error.message : String(error);
    appendFileSync(log, `${(/* @__PURE__ */ new Date()).toISOString()} ${message.slice(0, 500)}
`);
  } catch {
  }
}
async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const config = loadConfig(process.env, input.cwd);
  if (!config) return;
  try {
    const output = await handle(input, {
      config,
      store: openStore(config.home),
      api: makeApi(config),
      kick: kickFlush
    });
    if (output) process.stdout.write(output);
  } catch (error) {
    logError(config.home, error);
  }
}
main().finally(() => {
  process.exitCode = 0;
});
