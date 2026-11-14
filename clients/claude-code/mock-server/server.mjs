#!/usr/bin/env node
import crypto from "node:crypto";
// In-memory stand-in for the real Strata backend, to develop and test the plugin
// against. It follows docs/api-contract.md. Not for production use.
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const AUTO_APPROVE_MS = 2000;

const users = {
  u_alice: { id: "u_alice", name: "Alice Dev", email: "alice@example.com" },
};
const projects = [
  { id: "p_checkout", name: "Checkout Revamp", teamName: "Payments", description: "New checkout flow" },
  { id: "p_search", name: "Search Relevance", teamName: "Discovery", description: "Ranking improvements" },
];

const devices = new Map(); // device_code -> { userCode, createdAt }
const tokens = new Map(); // access token -> user id
const events = new Map(); // `${userId}:${idempotencyKey}` -> stored event
// Test control: make the next `count` event posts answer with `status` (or a 200 HTML page).
let forced = { status: 0, count: 0 };
const posts = new Map(); // idempotency key -> how many times it was posted (to prove no double uploads)

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

const userOf = (req) => users[tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""))] ?? null;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const route = `${req.method} ${url.pathname}`;

    if (route === "POST /v1/auth/device") {
      const deviceCode = crypto.randomBytes(16).toString("hex");
      const userCode = crypto.randomBytes(3).toString("hex").toUpperCase();
      devices.set(deviceCode, { userCode, createdAt: Date.now() });
      return send(res, 200, {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `http://localhost:${PORT}/activate`,
        verification_uri_complete: `http://localhost:${PORT}/activate?code=${userCode}`,
        expires_in: 300,
        interval: 1,
      });
    }

    if (route === "POST /v1/auth/token") {
      const { device_code } = await readBody(req);
      const device = devices.get(device_code);
      if (!device) return send(res, 400, { error: "invalid_grant" });
      if (Date.now() - device.createdAt < AUTO_APPROVE_MS) return send(res, 400, { error: "authorization_pending" });
      devices.delete(device_code);
      const token = crypto.randomBytes(24).toString("hex");
      tokens.set(token, "u_alice");
      return send(res, 200, { access_token: token, token_type: "Bearer", user: users.u_alice });
    }

    if (route === "GET /activate") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(
        "<h1>Mock Strata</h1><p>Device approved automatically after 2 seconds. You can close this tab.</p>",
      );
    }

    const user = userOf(req);
    if (url.pathname.startsWith("/v1/") && !user) return send(res, 401, { error: "invalid_token" });

    if (route === "GET /v1/me") return send(res, 200, { user });
    if (route === "GET /v1/projects") return send(res, 200, { projects });

    if (route === "POST /v1/debug/fail") {
      forced = { ...(await readBody(req)) };
      return send(res, 200, { ok: true });
    }

    if (route === "POST /v1/events") {
      const event = await readBody(req);
      if (forced.count > 0) {
        forced.count -= 1;
        if (forced.status === "html") {
          res.writeHead(200, { "content-type": "text/html" });
          return res.end("<html>captive portal</html>");
        }
        if (forced.status === "no-ack") return send(res, 200, {});
        return send(res, forced.status, { error: "forced" });
      }
      if (!event.idempotencyKey || !event.sessionId) return send(res, 400, { error: "invalid_event" });
      if (!projects.some((project) => project.id === event.projectId))
        return send(res, 422, { error: "unknown_project" });
      // The contract the real hub must also enforce: summaries only, and only approved ones.
      if (event.type !== "session_summary") return send(res, 422, { error: "unsupported_type" });
      if ("prompt" in event || "assistantMessage" in event || "turn" in event)
        return send(res, 422, { error: "raw_content_not_accepted" });
      if (event.review?.approved !== true || !event.review?.approvedAt)
        return send(res, 422, { error: "not_approved" });
      if (!event.summary?.title || !event.summary?.built) return send(res, 422, { error: "empty_summary" });
      if (!event.links?.jira?.length && !event.links?.pr && !event.links?.noTicket)
        return send(res, 422, { error: "unlinked" });
      // The server stamps the author from the token; nothing the client sends can set it.
      const key = `${user.id}:${event.idempotencyKey}`;
      posts.set(key, (posts.get(key) ?? 0) + 1);
      const duplicate = events.has(key);
      if (!duplicate) events.set(key, { ...event, userId: user.id, receivedAt: new Date().toISOString() });
      console.log(
        `${duplicate ? "dup " : "new "} summary rev=${event.revision} project=${event.projectId} user=${user.id}`,
      );
      return send(res, duplicate ? 200 : 201, { ok: true, duplicate });
    }

    const retract = /^DELETE \/v1\/sessions\/([\w.-]+)$/.exec(route);
    if (retract) {
      const mine = [...events.entries()].filter(([, e]) => e.userId === user.id && e.sessionId === retract[1]);
      if (!mine.length) return send(res, 404, { error: "not_found" });
      for (const [key] of mine) events.delete(key);
      console.log(`del  session=${retract[1]} user=${user.id}`);
      return send(res, 200, { ok: true });
    }

    // Read side the real hub must offer: the latest approved revision of each session, shared with the team.
    const FINDINGS = [
      ["built", "built"],
      ["insight", "insights"],
      ["workflow", "workflow"],
      ["pain-point", "painPoints"],
      ["gap", "gaps"],
      ["decision", "decisions"],
    ];
    const latest = (projectId) => {
      const best = new Map();
      for (const e of events.values()) {
        if (projectId && e.projectId !== projectId) continue;
        const k = `${e.userId}:${e.sessionId}`;
        if (!best.has(k) || best.get(k).revision < e.revision) best.set(k, e);
      }
      return [...best.values()];
    };

    if (route === "GET /v1/search") {
      const words = (url.searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return send(res, 400, { error: "query_required" });
      const results = [];
      for (const e of latest(url.searchParams.get("projectId"))) {
        for (const [kind, list] of FINDINGS) {
          for (const text of [].concat(e.summary[list] ?? [])) {
            if (words.every((w) => `${text} ${e.summary.title}`.toLowerCase().includes(w))) {
              results.push({
                kind,
                text,
                title: e.summary.title,
                projectId: e.projectId,
                jira: e.links.jira,
                pr: e.links.pr?.url ?? null,
                sessionId: e.sessionId,
                author: users[e.userId]?.name ?? null,
                updatedAt: e.updatedAt,
              });
            }
          }
        }
      }
      return send(res, 200, { results: results.slice(0, 20) });
    }

    if (route === "GET /v1/rollups") {
      const groups = new Map();
      for (const e of latest(url.searchParams.get("projectId"))) {
        const key = e.links.jira[0] ?? e.links.pr?.url ?? "(no ticket)";
        if (!groups.has(key))
          groups.set(key, {
            key,
            kind: e.links.jira.length ? "ticket" : e.links.pr ? "pr" : "none",
            sessions: [],
            authors: new Set(),
            lists: Object.fromEntries(FINDINGS.map(([, l]) => [l, new Set()])),
          });
        const g = groups.get(key);
        g.sessions.push({
          sessionId: e.sessionId,
          title: e.summary.title,
          built: e.summary.built,
          updatedAt: e.updatedAt,
        });
        g.authors.add(users[e.userId]?.name);
        for (const [, l] of FINDINGS) for (const x of e.summary[l] ?? []) if (l !== "built") g.lists[l].add(x);
      }
      return send(res, 200, {
        rollups: [...groups.values()].map((g) => ({
          key: g.key,
          kind: g.kind,
          authors: [...g.authors],
          sessions: g.sessions,
          ...Object.fromEntries(
            Object.entries(g.lists)
              .filter(([l]) => l !== "built")
              .map(([l, s]) => [l, [...s]]),
          ),
        })),
      });
    }

    if (route === "GET /v1/debug/stats") return send(res, 200, { posts: Object.fromEntries(posts) });

    if (route === "GET /v1/debug/events") return send(res, 200, { events: [...events.values()] });

    send(res, 404, { error: "not_found" });
  })
  .listen(PORT, () => console.log(`mock Strata on http://localhost:${PORT}`));
