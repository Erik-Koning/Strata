#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
// Local dashboard: a web UI on this machine to manage captured sessions, projects, sync and sign-in.
//
// Security model (it can read prompts, replies and trigger uploads, so it is locked down):
//  - binds 127.0.0.1 only, never a network interface
//  - Host header must be this server (blocks DNS-rebinding from a malicious website)
//  - every /api call needs a per-launch secret, handed over once in the launch URL and kept in a
//    HttpOnly SameSite=Strict cookie; mutating calls must also be JSON (forces a CORS preflight)
//  - the Strata bearer token never leaves this process: the browser only sees "signed in as ..."
//  - the page renders all captured text with textContent, never innerHTML
import http from "node:http";
import { fileURLToPath } from "node:url";
import { api } from "../lib/api.mjs";
import { log } from "../lib/log.mjs";
import { requestDeviceCode, waitForApproval } from "../lib/login.mjs";
import { openGaps, recurring, resolveGap } from "../lib/overview.mjs";
import {
  approve,
  countByStatus,
  deleteSession,
  describeSession,
  editSummary,
  JIRA_RE,
  listQueue,
  listSessions,
  PR_RE,
  SYNC_MODES,
  unapprove,
  updateSession,
  writeUpload,
} from "../lib/records.mjs";
import { rollups } from "../lib/rollups.mjs";
import {
  allBindings,
  clearAuth,
  getAuth,
  getHealth,
  p,
  readJson,
  removeBinding,
  serverUrl,
  setBinding,
  settings,
  writeJson,
} from "../lib/store.mjs";
import { flush, heldBreakdown, resolveProject, retract } from "../lib/sync.mjs";

const UI = fs.readFileSync(new URL("./ui.html", import.meta.url), "utf8");
const TOKEN = crypto.randomBytes(24).toString("hex");
const IDLE_EXIT_MS = 60 * 60 * 1000;
const SETTINGS_KEYS = [
  "serverUrl",
  "defaultSync",
  "excludedPaths",
  "jiraKeys",
  "retentionDays",
  "summarizer",
  "summaryModel",
  "maxSummariesPerDay",
];
const STRATA_CLI = fileURLToPath(new URL("../strata.mjs", import.meta.url));
let lastRequestAt = Date.now();
let port = 0;
let login = { state: "idle" };
let loginAbort = null;
let projectsCache = { at: 0, projects: [], error: null };

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const fail = (status, message) => Object.assign(new Error(message), { http: status });

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieToken = (req) => /(?:^|;\s*)strata=([0-9a-f]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
const authorized = (req) => safeEqual(cookieToken(req), TOKEN);

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw fail(413, "body too large");
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw fail(400, "invalid JSON");
  }
}

async function getProjects() {
  const auth = getAuth();
  if (!auth?.token) return { projects: [], error: "sign in to load projects" };
  if (Date.now() - projectsCache.at < 30_000) return projectsCache;
  try {
    const { projects } = await api("GET", "/v1/projects", undefined, { token: auth.token, timeoutMs: 6000 });
    projectsCache = { at: Date.now(), projects, error: null };
  } catch (err) {
    projectsCache = { at: Date.now() - 20_000, projects: projectsCache.projects, error: err.message };
  }
  return projectsCache;
}

const projectName = (projects, id) => {
  const project = projects.find((candidate) => candidate.id === id);
  return project ? `${project.teamName} / ${project.name}` : null;
};

function present(session, projects) {
  const resolved = resolveProject(session);
  const binding = allBindings()[session.repoKey];
  return {
    ...session,
    resolvedProjectId: resolved,
    resolvedProjectName:
      projectName(projects, resolved) ??
      (binding?.projectId === resolved && binding ? `${binding.teamName} / ${binding.name}` : null),
    projectSource: session.projectId ? "session" : binding ? "repo" : null,
  };
}

function requireSession(id) {
  const session = describeSession(id);
  if (!session) throw fail(404, "no such session");
  return session;
}

const listField = (value, name, max, count) => {
  if (!Array.isArray(value) || value.length > count || value.some((v) => typeof v !== "string" || v.length > max))
    throw fail(400, `${name} must be a short list of text`);
  return value;
};

const routes = [
  [
    "GET",
    /^\/api\/state$/,
    async () => {
      const auth = getAuth();
      return {
        server: serverUrl(),
        signedIn: Boolean(auth?.token),
        user: auth?.user ?? null,
        health: getHealth(),
        defaultSync: settings().defaultSync ?? "review",
        counts: countByStatus(),
        held: heldBreakdown(),
        login,
      };
    },
  ],

  ["GET", /^\/api\/rollups$/, async () => ({ rollups: rollups() })],

  // Open gaps and repeated pain points per repo, with the engineer's way to mark a gap answered.
  [
    "GET",
    /^\/api\/gaps$/,
    async () => {
      const repos = new Map(listSessions().map((s) => [s.repoKey, s.remote]));
      return {
        repos: [...repos]
          .filter(([key]) => key)
          .map(([repoKey, remote]) => ({
            repoKey,
            remote: remote ?? "",
            open: openGaps(repoKey, { limit: 50 }),
            recurring: recurring(repoKey),
          }))
          .filter((r) => r.open.length || r.recurring.length),
      };
    },
  ],
  [
    "POST",
    /^\/api\/gaps\/resolve$/,
    async (req) => {
      const { repoKey, text } = await readBody(req);
      if (typeof repoKey !== "string" || typeof text !== "string" || !repoKey || !text || text.length > 400)
        throw fail(400, "repoKey and text are required");
      resolveGap(repoKey, text);
      return { ok: true };
    },
  ],

  [
    "GET",
    /^\/api\/projects$/,
    async () => {
      const { projects, error } = await getProjects();
      return { projects, error };
    },
  ],

  [
    "GET",
    /^\/api\/sessions$/,
    async () => {
      const { projects } = await getProjects();
      return { sessions: listSessions().map((s) => present(s, projects)) };
    },
  ],

  [
    "GET",
    /^\/api\/sessions\/([\w.-]+)$/,
    async (_req, [id]) => {
      const session = requireSession(id);
      const { projects } = await getProjects();
      return { session: present(session, projects) };
    },
  ],

  // Engineer's choices about a session: where it goes, whether it may go, and what it is linked to.
  [
    "PATCH",
    /^\/api\/sessions\/([\w.-]+)$/,
    async (req, [id]) => {
      const session = requireSession(id);
      const body = await readBody(req);
      const patch = {};
      if ("sync" in body) {
        if (body.sync !== null && !SYNC_MODES.includes(body.sync))
          throw fail(400, "sync must be review, never or null");
        patch.sync = body.sync;
      }
      if ("projectId" in body) {
        if (body.projectId !== null && typeof body.projectId !== "string")
          throw fail(400, "projectId must be a string or null");
        const { projects, error } = await getProjects();
        // When Strata is unreachable the list is empty; only a known project is rejected then.
        if (body.projectId && !error && !projects.some((project) => project.id === body.projectId))
          throw fail(400, "that project is not available to you");
        patch.projectId = body.projectId;
      }
      if ("links" in body) {
        const { jira = [], prUrl = null, noTicket = false } = body.links ?? {};
        const keys = listField(jira, "jira", 20, 10).map((k) => k.trim().toUpperCase());
        if (keys.some((k) => !JIRA_RE.test(k))) throw fail(400, "a Jira key looks like ABC-123");
        if (prUrl !== null && !(typeof prUrl === "string" && PR_RE.test(prUrl.trim())))
          throw fail(400, "a pull request link looks like https://github.com/org/repo/pull/12");
        if (typeof noTicket !== "boolean") throw fail(400, "noTicket must be true or false");
        patch.linkOverrides = { jira: [...new Set(keys)], prUrl: prUrl ? prUrl.trim() : null, noTicket };
      }
      // Changing where or whether a session goes changes what was approved: ask again.
      updateSession(id, patch);
      if ("links" in body && session.approved) unapprove(id);
      return { ok: true };
    },
  ],

  [
    "DELETE",
    /^\/api\/sessions\/([\w.-]+)$/,
    async (_req, [id]) => {
      requireSession(id);
      deleteSession(id); // local copy only; use retract to remove it from Strata
      return { ok: true };
    },
  ],

  // The engineer's edit: a new revision, so what they approved is no longer what is on the table.
  [
    "PUT",
    /^\/api\/sessions\/([\w.-]+)\/summary$/,
    async (req, [id]) => {
      requireSession(id);
      const body = await readBody(req);
      const fields = {};
      for (const key of ["title", "built", "why"]) if (key in body) fields[key] = String(body[key] ?? "");
      for (const key of ["decisions", "areas", "open", "insights", "workflow", "painPoints", "gaps"])
        if (key in body) fields[key] = listField(body[key], key, 400, 20);
      const next = editSummary(id, fields);
      if (!next) throw fail(409, "the summary is being updated right now; try again in a moment");
      return { ok: true, revision: next.revision };
    },
  ],

  [
    "POST",
    /^\/api\/sessions\/([\w.-]+)\/approve$/,
    async (req, [id]) => {
      const session = requireSession(id);
      const body = await readBody(req);
      if (!session.summary?.built) throw fail(409, "there is no summary to approve yet: describe what was built first");
      if (!session.linked) throw fail(409, "link a Jira ticket or PR first, or mark that no ticket exists");
      approve(id);
      return body.send === true ? flush({ only: id, maxEntries: 1, budgetMs: 30_000 }) : { ok: true };
    },
  ],

  [
    "POST",
    /^\/api\/sessions\/([\w.-]+)\/unapprove$/,
    async (_req, [id]) => {
      requireSession(id);
      unapprove(id);
      return { ok: true };
    },
  ],

  [
    "POST",
    /^\/api\/sessions\/([\w.-]+)\/sync$/,
    async (_req, [id]) => {
      const session = requireSession(id);
      if (!session.approved) throw fail(409, "approve the summary first; only approved summaries are sent");
      return flush({ only: id, maxEntries: 1, budgetMs: 30_000 });
    },
  ],

  [
    "POST",
    /^\/api\/sessions\/([\w.-]+)\/retract$/,
    async (_req, [id]) => {
      requireSession(id);
      try {
        return await retract(id);
      } catch (err) {
        throw fail(err.status === 401 ? 401 : 502, err.message);
      }
    },
  ],

  // A rejected revision can be tried again as it is.
  [
    "POST",
    /^\/api\/sessions\/([\w.-]+)\/retry$/,
    async (_req, [id]) => {
      requireSession(id);
      writeUpload(id, { state: "none", rejectedRevision: 0, lastError: null });
      return { ok: true };
    },
  ],

  [
    "POST",
    /^\/api\/sessions\/([\w.-]+)\/summarize$/,
    async (_req, [id]) => {
      requireSession(id);
      spawn(process.execPath, [STRATA_CLI, "summarize", id], { detached: true, stdio: "ignore", windowsHide: true })
        .on("error", () => {})
        .unref();
      return { ok: true, queued: listQueue(id).length };
    },
  ],

  ["POST", /^\/api\/sync$/, async () => flush({ maxEntries: 500, budgetMs: 60_000 })],

  [
    "GET",
    /^\/api\/repos$/,
    async () => {
      const bindings = allBindings();
      const repos = new Map();
      for (const session of listSessions()) {
        const entry = repos.get(session.repoKey) ?? {
          repoKey: session.repoKey,
          remote: session.remote,
          sessions: 0,
          pending: 0,
        };
        entry.sessions += 1;
        if (["draft", "updated", "needs-link", "ready"].includes(session.status)) entry.pending += 1;
        repos.set(session.repoKey, entry);
      }
      for (const key of Object.keys(bindings))
        if (!repos.has(key)) repos.set(key, { repoKey: key, remote: "", sessions: 0, pending: 0 });
      return { repos: [...repos.values()].map((repo) => ({ ...repo, binding: bindings[repo.repoKey] ?? null })) };
    },
  ],

  [
    "PUT",
    /^\/api\/repos$/,
    async (req) => {
      const { repoKey, projectId } = await readBody(req);
      if (typeof repoKey !== "string" || !repoKey) throw fail(400, "repoKey required");
      if (projectId === null) {
        removeBinding(repoKey);
      } else {
        const { projects } = await getProjects();
        const project = projects.find((candidate) => candidate.id === projectId);
        if (!project) throw fail(400, "that project is not available to you");
        setBinding(repoKey, { projectId: project.id, name: project.name, teamName: project.teamName });
      }
      return { ok: true };
    },
  ],

  [
    "GET",
    /^\/api\/settings$/,
    async () => {
      const all = settings();
      return {
        settings: Object.fromEntries(SETTINGS_KEYS.map((key) => [key, all[key] ?? null])),
        effective: { serverUrl: serverUrl() },
      };
    },
  ],

  [
    "PUT",
    /^\/api\/settings$/,
    async (req) => {
      const body = await readBody(req);
      const next = { ...settings() };
      for (const key of SETTINGS_KEYS) {
        if (!(key in body)) continue;
        const value = body[key];
        if (value === null || value === "") {
          delete next[key];
          continue;
        }
        if (key === "serverUrl") {
          let url;
          try {
            url = new URL(value);
          } catch {
            throw fail(400, "serverUrl must be a URL");
          }
          const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
          if (url.protocol !== "https:" && !local)
            throw fail(400, "serverUrl must use https (plain http is allowed only for localhost)");
          next.serverUrl = url.origin;
        } else if (key === "defaultSync") {
          if (!SYNC_MODES.includes(value)) throw fail(400, "defaultSync must be review or never");
          next.defaultSync = value;
        } else if (key === "summarizer") {
          if (typeof value !== "boolean") throw fail(400, "summarizer must be true or false");
          next.summarizer = value;
        } else if (key === "summaryModel") {
          if (typeof value !== "string" || !/^[\w.:-]{1,64}$/.test(value))
            throw fail(400, "summaryModel must be a model name such as haiku");
          next.summaryModel = value;
        } else if (key === "maxSummariesPerDay") {
          if (!Number.isInteger(value) || value < 1 || value > 5000)
            throw fail(400, "maxSummariesPerDay must be a whole number from 1 to 5000");
          next.maxSummariesPerDay = value;
        } else if (key === "excludedPaths" || key === "jiraKeys") {
          if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.length > 300))
            throw fail(400, `${key} must be a list of text`);
          next[key] = value.map((v) => v.trim()).filter(Boolean);
        } else if (key === "retentionDays") {
          const { synced, other } = value ?? {};
          if (![synced, other].every((n) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 3650)))
            throw fail(400, "retention must be whole days");
          next.retentionDays = { ...(synced ? { synced } : {}), ...(other ? { other } : {}) };
        }
      }
      writeJson(p("config.json"), next);
      projectsCache = { at: 0, projects: [], error: null };
      return { ok: true };
    },
  ],

  [
    "POST",
    /^\/api\/login\/start$/,
    async () => {
      loginAbort?.abort();
      loginAbort = new AbortController();
      const device = await requestDeviceCode();
      login = {
        state: "pending",
        userCode: device.user_code,
        url: device.verification_uri_complete ?? device.verification_uri,
      };
      waitForApproval(device, { signal: loginAbort.signal })
        .then(async (user) => {
          login = { state: "done", user };
          projectsCache = { at: 0, projects: [], error: null };
          // Everything saved while signed out goes up as soon as the engineer signs in.
          await flush({ maxEntries: 500, budgetMs: 60_000 });
        })
        .catch((err) => {
          if (login.state === "pending") login = { state: "error", error: err.message };
        });
      return { login };
    },
  ],

  [
    "POST",
    /^\/api\/logout$/,
    async () => {
      clearAuth();
      login = { state: "idle" };
      projectsCache = { at: 0, projects: [], error: null };
      return { ok: true };
    },
  ],

  [
    "GET",
    /^\/api\/log$/,
    async () => {
      const text = (() => {
        try {
          return fs.readFileSync(p("strata.log"), "utf8");
        } catch {
          return "";
        }
      })();
      return { lines: text.split("\n").filter(Boolean).slice(-200).reverse() };
    },
  ],
];

const server = http.createServer(async (req, res) => {
  lastRequestAt = Date.now();
  try {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw fail(403, "bad host");
    const url = new URL(req.url, `http://${host}`);

    if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true });

    if (!url.pathname.startsWith("/api/")) {
      // Launch URL carries the secret once; swap it for a cookie and drop it from the address bar.
      if (url.searchParams.get("t") && safeEqual(url.searchParams.get("t"), TOKEN)) {
        res.writeHead(302, { location: "/", "set-cookie": `strata=${TOKEN}; HttpOnly; SameSite=Strict; Path=/` });
        return res.end();
      }
      if (!authorized(req)) {
        res.writeHead(401, { "content-type": "text/plain" });
        return res.end("Open the dashboard with /strata:dashboard");
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      return res.end(UI);
    }

    if (!authorized(req)) throw fail(401, "not authorized");
    if (req.method !== "GET" && !String(req.headers["content-type"] ?? "").startsWith("application/json"))
      throw fail(415, "JSON only");

    for (const [method, pattern, handler] of routes) {
      const match = pattern.exec(url.pathname);
      if (method === req.method && match) return sendJson(res, 200, await handler(req, match.slice(1)));
    }
    throw fail(404, "not found");
  } catch (err) {
    if (!err.http) log("error", "dashboard error", { error: String(err.message) });
    sendJson(res, err.http ?? 500, { error: err.http ? err.message : "internal error" });
  }
});

const cleanup = () => {
  try {
    if (readJson(p("dashboard.json"), {}).pid === process.pid) fs.rmSync(p("dashboard.json"), { force: true });
  } catch {
    // best effort
  }
};
process.on("exit", cleanup);
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

server.listen(Number(settings().dashboardPort) || 0, "127.0.0.1", () => {
  port = server.address().port;
  writeJson(p("dashboard.json"), { pid: process.pid, port, token: TOKEN, startedAt: new Date().toISOString() });
  log("info", "dashboard started", { port });
});

setInterval(() => {
  if (Date.now() - lastRequestAt > IDLE_EXIT_MS) process.exit(0);
}, 60_000).unref();
