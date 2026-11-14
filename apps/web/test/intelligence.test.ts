// Ask Strata's reading and answering, without a database: what a question is taken to ask, which records match, and
// that an answer only ever says what a record says, with that record's id.
import { describe, expect, it } from "vitest";
import { compose } from "../server/intelligence/answer.ts";
import { parseRef } from "../server/intelligence/sources.ts";
import { excerpt, rank, readQuestion, stem } from "../server/intelligence/text.ts";
import type { SourceCard } from "../server/intelligence/types.ts";

const NOW = new Date("2026-11-14T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let n = 0;
const card = (over: Partial<SourceCard> & Pick<SourceCard, "text" | "category">): SourceCard => {
  const id = (++n).toString(16).padStart(24, "0");
  const kind =
    over.kind ??
    (["pain_point", "context_gap", "insight", "workflow"].includes(over.category)
      ? "finding"
      : over.category === "summary"
        ? "summary"
        : "memory");
  const at = over.updatedAt ?? daysAgo(1);
  return {
    ref: kind === "memory" ? `mem:${id}` : kind === "summary" ? `sum:${id}` : `fnd:e-${n}`,
    kind,
    project: "acme/billing",
    sessionID: "s1",
    status: kind === "finding" ? "draft" : kind === "summary" ? "generated" : "active",
    createdAt: at,
    updatedAt: at,
    ...over,
  };
};

const corpus = [
  card({
    category: "pain_point",
    text: "Stripe webhook retries are blocked: the billing service rejects signatures from the staging key.",
  }),
  card({
    category: "decision",
    text: "Billing service stores money as integer cents, never floats, to avoid rounding drift.",
  }),
  card({
    category: "context_gap",
    text: "Nobody documented which billing service queue the invoice worker reads from.",
  }),
  card({
    category: "fact",
    project: "acme/auth",
    text: "The auth service is slow on cold start because it loads the JWKS on first request.",
  }),
  card({
    category: "decision",
    project: "acme/auth",
    text: "Authentication moved from JWT cookies to Better Auth sessions on MongoDB.",
    updatedAt: daysAgo(3),
  }),
  card({
    category: "insight",
    project: "acme/auth",
    text: "Session lookups are faster with the by_user index on the sessions collection.",
    updatedAt: daysAgo(2),
  }),
  card({
    category: "convention",
    project: "*",
    text: "Run the web app with pnpm dev; it listens on port 9316.",
    updatedAt: daysAgo(40),
  }),
];
const counts = { memories: 4, summaries: 0, findings: 3, candidates: 2 };
const answer = (question: string, cards = corpus) =>
  compose({ question, corpus: cards, counts, retrieval: "text", now: NOW });

describe("reading a question", () => {
  it("separates the intent from the topic", () => {
    const r = readQuestion("What's blocking the billing service?");
    expect(r.intent?.name).toBe("blockers");
    expect(r.terms).toEqual(["bill", "servic"]);
  });

  it("finds the time window and the intent-only questions", () => {
    const r = readQuestion("What did the team discover this week?");
    expect(r.intent?.name).toBe("discoveries");
    expect(r.terms).toEqual([]);
    expect(r.windowDays).toBe(7);
    expect(readQuestion("What's failing?")).toMatchObject({ terms: [], intent: { name: "blockers" } });
    expect(readQuestion("What work is still unfinished?")).toMatchObject({ terms: [], intent: { name: "unfinished" } });
  });

  it("keeps a cue that's also the topic, and folds names together", () => {
    expect(readQuestion("What changed in the build pipeline?")).toMatchObject({
      intent: { name: "changes" },
      terms: ["build", "pipelin"],
    });
    expect(readQuestion("What changed in authentication recently?")).toMatchObject({ terms: ["auth"], windowDays: 14 });
    expect(readQuestion("How do I get this service running?")).toMatchObject({
      intent: { name: "setup" },
      terms: ["servic"],
    });
    expect(stem("running")).toBe("run");
    expect(stem("billing")).toBe("bill");
  });
});

describe("ranking", () => {
  it("needs most of the topic: a record about another service doesn't match billing", () => {
    const docs = corpus.map((c) => ({ id: c.ref, text: c.text, extra: c.project }));
    const hits = rank(docs, ["bill", "servic"]).map((h) => h.id);
    expect(hits).toHaveLength(3);
    expect(hits).not.toContain(corpus[3]!.ref);
  });

  it("shortens at a sentence or word, never mid-word", () => {
    const long = `${"Word ".repeat(100)}end`;
    const out = excerpt(long, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("Word…")).toBe(true);
  });
});

describe("answering", () => {
  it("answers from the records, the asked-for kind first, each point cited", () => {
    const a = answer("What's blocking the billing service?");
    expect(a.mode).toBe("extractive");
    expect(a.sources[0]?.category).toBe("pain_point");
    expect(a.sources.map((s) => s.category)).toEqual(["pain_point", "context_gap", "decision"]);
    const refs = new Set(a.sources.map((s) => s.ref));
    for (const section of a.sections)
      for (const point of section.points) {
        expect(point.refs.length).toBeGreaterThan(0);
        for (const ref of point.refs) expect(refs.has(ref)).toBe(true);
        // A point is the record's own words.
        const source = a.sources.find((s) => s.ref === point.refs[0])!;
        expect(source.text).toContain(point.text.replace(/…$/, ""));
      }
    expect(a.gaps.join(" ")).toMatch(/Ticket and pull request status isn't connected/);
    expect(a.gaps.join(" ")).toMatch(/2 candidate memories wait for your review/);
  });

  it("treats a project's name as the scope: another project's service doesn't answer for billing", () => {
    const web = card({
      category: "context_gap",
      project: "acme/web",
      text: "Unclear whether the web service needs Node 24.",
    });
    const a = answer("What's blocking the billing service?", [...corpus, web]);
    expect(a.sources.map((s) => s.ref)).not.toContain(web.ref);
    expect(a.sources.every((s) => s.project === "acme/billing" || /billing/i.test(s.text))).toBe(true);
  });

  it("says so, and cites nothing, when nothing matches", () => {
    const a = answer("What's blocking the payments ledger?");
    expect(a.sources).toEqual([]);
    expect(a.sections).toEqual([]);
    expect(a.lead).toMatch(/^Nothing in your records about “payments” and “ledger”/);
    expect(a.gaps[0]).toMatch(/None mentions “payments” or “ledger”/);
  });

  it("refuses a question with no topic and no intent rather than guessing", () => {
    const a = answer("What about it?");
    expect(a.sources).toEqual([]);
    expect(a.lead).toMatch(/doesn't name a topic/);
    // A word no record has is said to be missing, not matched loosely.
    expect(answer("hello there").lead).toBe("Nothing in your records about “hello” answers this.");
  });

  it("keeps to the window, and says when older records would match", () => {
    const a = answer("How do I run the web app this week?");
    expect(a.sources).toEqual([]);
    expect(a.gaps.join(" ")).toMatch(/1 older record would match outside the last 7 days/);
    expect(answer("How do I run the web app?").sources[0]?.category).toBe("convention");
  });

  it("answers an intent-only question with that kind of record, newest first", () => {
    const a = answer("What did the team discover this week?");
    // Insights, workflow notes and facts from the last 7 days; the decisions and the 40-day-old convention stay out.
    expect(a.sources.map((s) => s.category)).toEqual(["insight", "fact"]);
    const changes = answer("What changed recently?");
    expect(changes.sources.length).toBeGreaterThan(0);
    expect(changes.sources.every((s) => s.project !== "*")).toBe(true);
  });

  it("says when matching records aren't blockers", () => {
    const a = answer(
      "What's blocking auth?",
      corpus.filter((c) => c.category !== "pain_point" && c.category !== "context_gap"),
    );
    expect(a.sources.length).toBeGreaterThan(0);
    expect(a.gaps.join(" ")).toMatch(/None of these records is logged as a pain point or a context gap/);
  });
});

describe("source ids", () => {
  it("parses only well-formed ids", () => {
    expect(parseRef(`mem:${"a".repeat(24)}`)).toEqual({ kind: "memory", id: "a".repeat(24) });
    expect(parseRef("fnd:evt-1:x")).toEqual({ kind: "finding", id: "evt-1:x" });
    expect(parseRef("mem:nothex")).toBeNull();
    expect(parseRef("sum:$where")).toBeNull();
    expect(parseRef('fnd:{"$gt":""}')).toBeNull();
    expect(parseRef("other:1")).toBeNull();
  });
});
