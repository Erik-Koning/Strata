// pnpm intelligence:demo <email>: a made-up week of engineering work for one account, so the Intelligence page has
// something to show in a demo. It goes through the app's own write paths (ingest, addMemory, compress), so what the
// page reads is stored exactly as real capture would store it; memories are marked source "seed" and events come
// from the client "strata-demo-seed", and the evidence panel says so. A second, made-up person gets records too, to
// show they never appear. Idempotent: events dedupe on their ids and memories on their text.

import { auth } from "../server/auth.ts";
import { closeMongo } from "../server/db.ts";
import { ensureIndexes } from "../server/indexes.ts";
import { compress } from "../server/memory/compress.ts";
import { ingest } from "../server/memory/ingest.ts";
import { addMemory } from "../server/memory/store.ts";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("usage: pnpm intelligence:demo <email of an existing account>");
  process.exit(1);
}
const ctx = await auth().$context;
const found = await ctx.internalAdapter.findUserByEmail(email);
if (!found) {
  console.error(`No account for ${email}. Make one first (pnpm invite ${email}).`);
  process.exit(1);
}
const user = found.user.id;
const OTHER = "demo-other-person";
const HOUR = 3_600_000;
const now = Date.now();
const service = { kind: "service" as const, label: "demo seed", client: "strata-demo-seed" };

interface Session {
  id: string;
  project: string;
  branch: string;
  ticket?: string;
  hoursAgo: number;
  findings: { type: "pain_point" | "context_gap" | "insight" | "workflow"; text: string }[];
  memories: { kind: "decision" | "fact" | "convention" | "preference"; text: string }[];
  tools: { class: string; exit?: number }[];
  summary?: [string, string];
}

const SESSIONS: Session[] = [
  {
    id: "demo-billing-1",
    project: "acme/billing",
    branch: "PAY-412-stripe-webhook-retries",
    ticket: "PAY-412",
    hoursAgo: 30,
    findings: [
      {
        type: "pain_point",
        text: "Stripe webhook retries are blocked: the billing service rejects signatures because staging still signs with the old endpoint secret.",
      },
      {
        type: "context_gap",
        text: "Nobody documented which queue the invoice worker reads from; the billing README names two and only one exists.",
      },
      {
        type: "insight",
        text: "Webhook handlers must be idempotent on the Stripe event id: Stripe retries for up to three days after a 5xx.",
      },
    ],
    memories: [
      {
        kind: "decision",
        text: "Billing stores money as integer cents, never floats, to avoid rounding drift in invoice totals.",
      },
      {
        kind: "decision",
        text: "Webhook signature checks use the raw request body; parsing JSON first breaks the HMAC.",
      },
    ],
    tools: [
      { class: "test", exit: 1 },
      { class: "test", exit: 1 },
      { class: "test" },
      { class: "typecheck" },
      { class: "git" },
    ],
    summary: [
      "Make the Stripe webhook retries pass on staging",
      "Found that staging signs with the old endpoint secret; signature verification now reads the raw body. Retries stay blocked until the staging secret is rotated.",
    ],
  },
  {
    id: "demo-auth-1",
    project: "acme/auth",
    branch: "AUTH-88-better-auth-migration",
    ticket: "AUTH-88",
    hoursAgo: 72,
    findings: [
      {
        type: "insight",
        text: "Session lookups dropped from 40 ms to 3 ms once the sessions collection got an index on userId.",
      },
      {
        type: "workflow",
        text: "To test sign-in locally, run pnpm invite with your email first: accounts are invite-only, so sign-up without a link fails.",
      },
      {
        type: "pain_point",
        text: "The auth integration tests are slow because each one waits for the Atlas Search index to become queryable.",
      },
    ],
    memories: [
      {
        kind: "decision",
        text: "Authentication moved from hand-rolled JWT cookies to Better Auth sessions stored in MongoDB, so sessions can be revoked.",
      },
      {
        kind: "convention",
        text: "Auth routes never log request bodies; passwords and tokens only ever pass through redact().",
      },
    ],
    tools: [{ class: "test" }, { class: "test" }, { class: "build" }, { class: "lint", exit: 1 }, { class: "lint" }],
    summary: [
      "Migrate authentication to Better Auth",
      "Sessions now live in MongoDB with a userId index; JWT cookies are gone. Sign-in needs an invite link in local runs.",
    ],
  },
  {
    id: "demo-web-1",
    project: "acme/web",
    branch: "WEB-19-local-dev",
    ticket: "WEB-19",
    hoursAgo: 150,
    findings: [
      {
        type: "workflow",
        text: "To get the web app running: start the atlas-local MongoDB container, copy .env.example to apps/web/.env.local, run pnpm db:indexes, then pnpm dev on port 9316.",
      },
      {
        type: "context_gap",
        text: "It's unclear whether the web service needs Node 24 or works on 22; the engines field says 24 but CI isn't set up yet.",
      },
    ],
    memories: [
      { kind: "convention", text: "Use pnpm, never npm or yarn, in every package of this repository." },
      { kind: "fact", text: "The web service listens on port 9316 by default; set PORT to change it." },
    ],
    tools: [{ class: "install" }, { class: "build", exit: 1 }, { class: "build" }, { class: "format" }],
  },
  {
    id: "demo-billing-2",
    project: "acme/billing",
    branch: "PAY-430-invoice-rounding",
    ticket: "PAY-430",
    hoursAgo: 8,
    findings: [
      {
        type: "insight",
        text: "Invoice totals only match the ledger when billing rounds once, at the end, instead of per line item.",
      },
    ],
    memories: [
      {
        kind: "fact",
        text: "Billing's invoice worker reads from the invoices-v2 queue; invoices-v1 was removed in October.",
      },
    ],
    tools: [{ class: "test" }, { class: "test" }, { class: "typecheck" }],
  },
];

let made = 0;
for (const s of SESSIONS) {
  const at = (offsetMinutes: number) => now - s.hoursAgo * HOUR + offsetMinutes * 60_000;
  let i = 0;
  const event = (kind: string, payload: Record<string, unknown>, minute: number) => ({
    v: 1,
    id: `demo-${s.id}-${++i}`,
    sessionID: s.id,
    scope: { project: s.project, user },
    kind,
    payload,
    ts: at(minute),
  });
  const batch = [
    event(
      "session",
      {
        event: "start",
        source: "startup",
        git: { remote: `github.com/${s.project}`, branch: s.branch, head: "9f1c2ab7e4d0" },
        ...(s.ticket ? { refs: [{ type: "ticket", id: s.ticket }] } : {}),
      },
      0,
    ),
    ...s.tools.map((t, n) =>
      event(
        "tool",
        {
          tool: "Bash",
          status: t.exit ? "error" : "ok",
          ms: 1200 + n * 300,
          command: { class: t.class, ...(t.exit ? { exit: t.exit } : {}), fp: `${n}`.padStart(16, "a") },
        },
        5 + n * 4,
      ),
    ),
    ...s.findings.map((f, n) => event("finding", { type: f.type, text: f.text }, 20 + n * 6)),
    event("session", { event: "end", reason: "exit" }, 60),
  ];
  const result = await ingest(service, batch);
  made += result.accepted;
  for (const m of s.memories)
    await addMemory({
      scope: { org: "default", user, project: s.project },
      kind: m.kind,
      text: m.text,
      status: "active",
      trust: "explicit",
      confidence: 0.85,
      provenance: { sessionID: s.id, messageID: null, eventId: null, source: "seed" },
    });
  if (s.summary && result.accepted)
    await compress(
      { kind: "service", id: "service", label: "demo seed" },
      { org: "default", user, project: s.project },
      s.id,
      [
        { role: "user", text: s.summary[0] },
        { role: "assistant", text: s.summary[1] },
      ],
    );
}

// Another person's records, about the same things: the page must never show them.
await ingest(service, [
  {
    v: 1,
    id: "demo-other-1",
    sessionID: "demo-other-s1",
    scope: { project: "acme/billing", user: OTHER },
    kind: "finding",
    payload: {
      type: "pain_point",
      text: "PRIVATE to another person: billing deploys are blocked on the vault migration.",
    },
    ts: now - 2 * HOUR,
  },
]);
await addMemory({
  scope: { org: "default", user: OTHER, project: "acme/billing" },
  kind: "decision",
  text: "PRIVATE to another person: billing webhook secrets move to the vault.",
  status: "active",
  trust: "explicit",
  confidence: 0.9,
  provenance: { sessionID: null, messageID: null, eventId: null, source: "seed" },
});
// A candidate for the demo account: shown as awaiting review, never used as evidence.
await addMemory({
  scope: { org: "default", user, project: "acme/billing" },
  kind: "fact",
  text: "The assistant suggested billing might move to a separate ledger service.",
  status: "candidate",
  trust: "inferred",
  confidence: 0.4,
  provenance: { sessionID: "demo-billing-1", messageID: null, eventId: null, source: "assistant" },
});

await ensureIndexes();
console.log(`intelligence:demo: ${made} events stored for ${email}`);
await closeMongo();
