// Strata Intelligence against the real engine, on a database of its own: answers come only from the asker's records,
// another person's records are never retrieved or opened, evidence never carries session content, and the pulse is
// counted from what's stored.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const name = `am_test_intel_${process.env.A6G_NAMESPACE?.replace(/[^a-z0-9]/gi, "_") ?? randomBytes(4).toString("hex")}`;
const base = process.env.MONGODB_URI ?? "mongodb://localhost:9317/?directConnection=true";
process.env.MONGODB_URI = base.replace(/\/([^/?]*)(\?|$)/, `/${name}$2`);
process.env.MEMORY_API_TOKEN = "test-service-token-0123456789abcdef";
process.env.MEMORY_AI_PROVIDER = "stub";

const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { ingest } = await import("../server/memory/ingest.ts");
const { addMemory } = await import("../server/memory/store.ts");
const { compress } = await import("../server/memory/compress.ts");
const { ask } = await import("../server/intelligence/ask.ts");
const { evidenceFor } = await import("../server/intelligence/evidence.ts");
const { pulse } = await import("../server/intelligence/pulse.ts");
const { memories } = await import("../server/collections.ts");

const service = { kind: "service" as const, label: "test", client: "test/1" };
// A prompt with no cue for extraction (extract.ts), so it stays raw session content and must stay hidden.
const SECRET_PROMPT = "Look at the purple-elephant-42 billing webhook retries for me";
let n = 0;
const ev = (
  user: string,
  kind: string,
  payload: Record<string, unknown>,
  session: string,
  project = "acme/billing",
) => ({
  v: 1,
  id: `intel-${user}-${++n}`,
  sessionID: session,
  scope: { project, user },
  kind,
  payload,
  ts: Date.now() - n * 1000,
});

const memory = (
  user: string,
  text: string,
  kind: "decision" | "fact" | "convention",
  status: "active" | "candidate",
  sessionID: string | null,
) =>
  addMemory({
    scope: { org: "default", user, project: "acme/billing" },
    kind,
    text,
    status,
    trust: status === "active" ? "explicit" : "inferred",
    confidence: 0.8,
    provenance: { sessionID, messageID: null, eventId: null, source: "manual" },
  });

beforeAll(async () => {
  await ensureIndexes({ wait: true, timeoutMs: 120_000 });
  await ingest(service, [
    ev(
      "ada",
      "session",
      {
        event: "start",
        source: "startup",
        git: { remote: "github.com/acme/billing", branch: "PAY-412-webhooks", head: "abc1234" },
        refs: [{ type: "ticket", id: "PAY-412" }],
      },
      "ada-s1",
    ),
    ev("ada", "prompt", { role: "user", text: SECRET_PROMPT }, "ada-s1"),
    ev(
      "ada",
      "finding",
      {
        type: "pain_point",
        text: "Stripe webhook retries are blocked: billing rejects signatures from the staging key.",
      },
      "ada-s1",
    ),
    ev(
      "ada",
      "finding",
      { type: "insight", text: "Invoice totals drift unless billing rounds once, at the end." },
      "ada-s1",
    ),
    ev(
      "ada",
      "tool",
      { tool: "Bash", status: "error", ms: 900, command: { class: "test", exit: 1, fp: "0123456789abcdef" } },
      "ada-s1",
    ),
    ev(
      "ada",
      "tool",
      { tool: "Bash", status: "ok", ms: 400, command: { class: "test", fp: "0123456789abcdef" } },
      "ada-s1",
    ),
    ev(
      "grace",
      "finding",
      { type: "pain_point", text: "Grace's private note: billing deploys are blocked on the vault migration." },
      "grace-s1",
    ),
  ]);
  await memory("ada", "Billing stores money as integer cents, never floats.", "decision", "active", "ada-s1");
  await memory("ada", "Billing might move to a ledger service someday.", "fact", "candidate", "ada-s1");
  await memory("grace", "Grace's billing decision: use the vault for webhook secrets.", "decision", "active", null);
  // Active but past its expiry: recall and frozen skip it (store.ts liveFilter), and so must Intelligence.
  const expired = await memory(
    "ada",
    "Billing webhook retries are blocked on the old gateway.",
    "fact",
    "active",
    null,
  );
  await memories().updateOne({ _id: expired.memory._id }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
  await compress(
    { kind: "service", id: "service", label: "test" },
    { org: "default", user: "ada", project: "acme/billing" },
    "ada-s1",
    [
      { role: "user", text: "Fix the billing webhook retries" },
      { role: "assistant", text: "Webhook retries now verify signatures with the right key." },
    ],
  );
});
afterAll(async () => {
  await db().dropDatabase();
  await closeMongo();
});

describe("Ask Strata", () => {
  it("answers from the asker's own records, cited by id", async () => {
    const a = await ask("ada", "What's blocking billing?");
    const texts = a.sources.map((s) => s.text).join("\n");
    expect(a.sources[0]?.category).toBe("pain_point");
    expect(texts).toContain("Stripe webhook retries are blocked");
    // Grace's records are about billing too, and never come back.
    expect(texts).not.toMatch(/Grace/);
    // The candidate isn't evidence: nobody said yes to it.
    expect(texts).not.toContain("ledger service");
    // Nor is an expired memory, however well it matches.
    expect(texts).not.toContain("old gateway");
    expect(a.gaps.join(" ")).toMatch(/1 candidate memory waits for your review/);
    for (const s of a.sources) expect(s.ref).toMatch(/^(mem|sum|fnd):/);
  });

  it("doesn't make up an answer it doesn't have", async () => {
    const a = await ask("ada", "Why did we migrate the kubernetes cluster?");
    expect(a.sources).toEqual([]);
    expect(a.lead).toMatch(/^Nothing in your records/);
  });

  it("never answers one person from another's records", async () => {
    const a = await ask("grace", "What's blocking billing?");
    expect(a.sources.length).toBeGreaterThan(0);
    expect(a.sources.every((s) => s.text.includes("Grace"))).toBe(true);
    expect(await ask("nobody", "billing")).toMatchObject({ sources: [], lead: "There are no records to search yet." });
  });
});

describe("evidence", () => {
  it("shows the record, its session's links and counts, and never the session's content", async () => {
    const a = await ask("ada", "What's blocking billing?");
    const ref = a.sources[0]!.ref;
    const e = await evidenceFor("ada", ref, true);
    expect(e?.source.ref).toBe(ref);
    expect(e?.session).toMatchObject({
      sessionID: "ada-s1",
      repo: "github.com/acme/billing",
      branch: "PAY-412-webhooks",
      refs: [{ type: "ticket", id: "PAY-412" }],
    });
    expect(e?.session?.captured.find((c) => c.kind === "prompt")?.count).toBe(1);
    expect(e?.authorization).toMatchObject({ owner: "You", cited: true });
    expect(JSON.stringify(e)).not.toContain("purple-elephant");
    expect(e?.related.length).toBeGreaterThan(0);
    expect(e?.related.every((r) => !r.text.includes("Grace"))).toBe(true);
  });

  it("won't open another person's record: the same answer as a missing one", async () => {
    const graces = await ask("grace", "What's blocking billing?");
    for (const s of graces.sources) expect(await evidenceFor("ada", s.ref)).toBeNull();
    const own = await memories().findOne({ "scope.user": "grace" });
    expect(await evidenceFor("ada", `mem:${own!._id.toHexString()}`)).toBeNull();
    expect(await evidenceFor("ada", "mem:000000000000000000000000")).toBeNull();
    expect(await evidenceFor("ada", "nonsense")).toBeNull();
  });
});

describe("Product Pulse", () => {
  it("counts what's stored for the person, and only theirs", async () => {
    const p = await pulse("ada");
    expect(p.totals).toMatchObject({
      activeMemories: 1,
      candidates: 1,
      summaries: 1,
      sessions7d: 1,
      findings: { pain_point: 1, insight: 1, workflow: 0, context_gap: 0 },
    });
    expect(p.coverage).toMatchObject({ sessions: 1, withEither: 1 });
    expect(p.friction.map((c) => c.text)).toEqual([
      "Stripe webhook retries are blocked: billing rejects signatures from the staging key.",
    ]);
    expect(p.signals).toEqual([{ class: "test", runs: 2, failed: 1 }]);
    expect(p.projects[0]).toMatchObject({
      project: "acme/billing",
      repo: "github.com/acme/billing",
      refs: ["PAY-412"],
      openFriction: 1,
    });
    expect(JSON.stringify(p)).not.toMatch(/Grace|purple-elephant/);
    expect(p.days.reduce((s, d) => s + d.events, 0)).toBe(6);
  });
});
