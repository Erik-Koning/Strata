// The /v1 summary API end to end, through its route handlers, on a database of its own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("v1_test");
process.env.MEMORY_API_TOKEN = "test-service-token-0123456789abcdef";
process.env.MEMORY_AI_PROVIDER = "stub";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://localhost:9316";

const {
  deleteSessionSummary,
  getMe,
  getProjects,
  getRollups,
  getSearch,
  postDeviceCode,
  postDeviceToken,
  postSummaryEvent,
} = await import("../server/summary/routes.ts");
const { closeMongo, db } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { createKey } = await import("../server/keys.ts");
const { summaryRevisions } = await import("../server/collections.ts");

const SERVICE = process.env.MEMORY_API_TOKEN;
const call = <A extends unknown[]>(
  handler: (request: Request, ...rest: A) => Promise<Response>,
  init: {
    token?: string | null;
    body?: unknown;
    query?: string;
    method?: string;
    headers?: Record<string, string>;
  } = {},
  ...rest: A
) =>
  handler(
    new Request(`http://test/v1/x${init.query ?? ""}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? SERVICE}` }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    ...rest,
  );

let key = "";
let projectId = "";
let revision = 0;
const summaryEvent = (overrides: Record<string, unknown> = {}) => {
  revision += 1;
  return {
    v: 1,
    idempotencyKey: `s1:summary:${revision}`,
    type: "session_summary",
    sessionId: "s1",
    revision,
    projectId,
    updatedAt: new Date().toISOString(),
    client: { plugin: "0.3.0", platform: "test" },
    repo: { remote: "https://github.com/acme/shop.git", branch: "ABC-1-x", head: "abc" },
    links: { jira: ["ABC-1"], pr: null, noTicket: false },
    summary: {
      title: "Tax rounding per line",
      built: "Line totals now round before summing.",
      why: "Invoices drifted by a cent.",
      decisions: ["Round per line"],
      areas: ["tax"],
      open: [],
      insights: ["The ledger rounds per line."],
      workflow: [],
      painPoints: [],
      gaps: ["No record of the retry budget."],
    },
    files: ["src/tax.ts"],
    review: { approved: true, approvedAt: new Date().toISOString(), edited: false },
    ...overrides,
  };
};

beforeAll(async () => {
  await ensureIndexes({ wait: false });
  key = (await createKey("v1-user", "test")).key;
  const projects = await (await call(getProjects, { token: key })).json();
  projectId = projects.projects[0].id;
});
afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("auth and projects", () => {
  it("answers 401 without a key and 200 with one", async () => {
    expect((await call(getMe, { token: null })).status).toBe(401);
    const me = await call(getMe, { token: key });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { id: "v1-user" } });
  });

  it("gives every person one default project, created once", async () => {
    const first = await (await call(getProjects, { token: key })).json();
    expect(first.projects).toHaveLength(1);
    expect(first.projects[0].teamName).toBe("Personal");
    const second = await (await call(getProjects, { token: key })).json();
    expect(second.projects).toHaveLength(1);
    expect(second.projects[0].id).toBe(first.projects[0].id);
  });
});

describe("approved summaries", () => {
  it("stores a revision once and acknowledges a replay as a duplicate", async () => {
    const event = summaryEvent();
    const first = await call(postSummaryEvent, {
      token: key,
      body: event,
      headers: { "idempotency-key": event.idempotencyKey },
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ ok: true });

    const again = await call(postSummaryEvent, {
      token: key,
      body: event,
      headers: { "idempotency-key": event.idempotencyKey },
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(await summaryRevisions().countDocuments({ sessionId: "s1" })).toBe(1);
  });

  it("refuses raw content, unknown projects, empty summaries and unlinked work", async () => {
    const raw = await call(postSummaryEvent, { token: key, body: { ...summaryEvent(), prompt: "secret" } });
    expect(raw.status).toBe(422);
    expect((await raw.json()).error).toBe("raw_content_not_accepted");

    const unknown = await call(postSummaryEvent, {
      token: key,
      body: summaryEvent({ projectId: "0123456789abcdef01234567" }),
    });
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).error).toBe("unknown_project");

    const empty = await call(postSummaryEvent, {
      token: key,
      body: summaryEvent({ summary: { ...summaryEvent().summary, title: "", built: "" } }),
    });
    expect(empty.status).toBe(422);

    const unlinked = await call(postSummaryEvent, {
      token: key,
      body: summaryEvent({ links: { jira: [], pr: null, noTicket: false } }),
    });
    expect(unlinked.status).toBe(422);
    expect((await unlinked.json()).error).toBe("unlinked");
  });

  it("keeps another person out of a project they do not belong to", async () => {
    const other = (await createKey("v1-other", "test")).key;
    const res = await call(postSummaryEvent, { token: other, body: summaryEvent() });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("unknown_project");
  });
});

describe("search and roll-ups", () => {
  it("finds a summary only when every word matches, and returns its kind", async () => {
    const found = await (await call(getSearch, { token: key, query: "?q=ledger%20rounds" })).json();
    expect(found.results).toContainEqual(
      expect.objectContaining({ kind: "insight", text: "The ledger rounds per line." }),
    );

    const missing = await (await call(getSearch, { token: key, query: "?q=ledger%20missing" })).json();
    expect(missing.results).toEqual([]);
    expect((await call(getSearch, { token: key, query: "?q=" })).status).toBe(400);
  });

  it("groups the current summary by its Jira ticket", async () => {
    await call(postSummaryEvent, {
      token: key,
      body: summaryEvent({
        links: { jira: ["ABC-1"], pr: { url: "https://github.com/acme/shop/pull/4" }, noTicket: false },
      }),
    });
    const { rollups } = await (await call(getRollups, { token: key, query: `?projectId=${projectId}` })).json();
    const group = rollups.find((r: { key: string }) => r.key === "ABC-1");
    expect(group.kind).toBe("ticket");
    expect(group.sessions).toHaveLength(1);
    expect(group.insights).toContain("The ledger rounds per line.");
  });
});

describe("retract", () => {
  it("removes every revision for the session and then answers 404", async () => {
    expect((await call(deleteSessionSummary, { token: key, body: {} }, "s1")).status).toBe(200);
    expect(await summaryRevisions().countDocuments({ sessionId: "s1" })).toBe(0);
    expect((await call(deleteSessionSummary, { token: key, body: {} }, "s1")).status).toBe(404);
  });
});

describe("device sign-in", () => {
  it("issues a device code and reports a pending token", async () => {
    const issued = await call(postDeviceCode, { token: null, body: { client: "strata-plugin" } });
    expect(issued.status).toBe(200);
    const device = await issued.json();
    expect(device.device_code).toBeTruthy();
    expect(device.user_code).toBeTruthy();
    expect(device.verification_uri).toContain("/activate");

    const pending = await call(postDeviceToken, { token: null, body: { device_code: device.device_code } });
    expect(pending.status).toBe(400);
    expect((await pending.json()).error).toBe("authorization_pending");
  });
});
