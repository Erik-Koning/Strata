// The hub's pure rules: what a repository is called, when two findings are the same, how a summary becomes team
// records, how a repository and a folder find their product, and how time is cut into days and weeks.
import { describe, expect, it } from "vitest";
import type { ProductDoc, SummaryRevisionDoc } from "../server/collections.ts";
import { indexProducts } from "../server/hub/products.ts";
import { fromSummary, summaryRefs } from "../server/hub/team-records.ts";
import {
  dayKey,
  dedupeWithinSession,
  normalizePath,
  normalizeRepo,
  normalizeText,
  pathWithin,
  slugCandidates,
  weekStart,
} from "../server/hub/text.ts";

describe("normalizeRepo", () => {
  it("names a repository the way the plugin does, whatever form its remote came in", () => {
    for (const remote of [
      "git@github.com:acme/billing.git",
      "https://github.com/acme/billing.git",
      "https://user:token@github.com/acme/billing",
      "ssh://git@github.com/acme/billing",
      "github.com/acme/billing",
      "GitHub.com/acme/billing/",
    ])
      expect(normalizeRepo(remote)).toBe("github.com/acme/billing");
    expect(normalizeRepo("https://gitlab.example.org/group/sub/app.git")).toBe("gitlab.example.org/group/sub/app");
  });

  it("refuses what isn't a repository: a folder's name, the wildcard project, nothing", () => {
    for (const name of ["Strata", "default", "*", "", null, undefined, "acme/billing", "/Users/me/code/app"])
      expect(normalizeRepo(name)).toBeNull();
  });
});

describe("folders", () => {
  it("normalizes a folder and knows what's inside what", () => {
    expect(normalizePath("/apps/web/")).toBe("apps/web");
    expect(normalizePath(null)).toBe("");
    expect(pathWithin("apps/web/src", "apps/web")).toBe(true);
    expect(pathWithin("apps/web", "apps/web")).toBe(true);
    expect(pathWithin("apps/website", "apps/web")).toBe(false);
    expect(pathWithin("anything", "")).toBe(true);
  });
});

describe("slugCandidates", () => {
  it("starts from the repository's name, then owner and name, then numbers, all URL-safe", () => {
    const slugs = slugCandidates("github.com/Acme/Billing_Service.v2");
    expect(slugs.slice(0, 3)).toEqual(["billing-service-v2", "acme-billing-service-v2", "acme-billing-service-v2-2"]);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("normalizeText and dedupe", () => {
  it("treats findings that differ only in case, spacing and punctuation as the same", () => {
    expect(normalizeText("No docs for the retry-budget.")).toBe(normalizeText("  no DOCS for the retry budget "));
    expect(normalizeText("Ledger rounds per line")).not.toBe(normalizeText("Ledger rounds per invoice"));
  });

  it("keeps the first of each line within a session, and the same line in another session", () => {
    const items = [
      { id: "r1", sessionId: "s1", text: "The ledger rounds per line." },
      { id: "s1", sessionId: "s1", text: "the ledger rounds per line" },
      { id: "s2", sessionId: "s2", text: "The ledger rounds per line." },
      { id: "e", sessionId: "s1", text: "  ...  " },
    ];
    expect(dedupeWithinSession(items).map((i) => i.id)).toEqual(["r1", "s2"]);
  });
});

describe("days and weeks", () => {
  it("cuts time in UTC days and Monday weeks", () => {
    expect(dayKey(new Date("2026-11-14T23:59:00Z"))).toBe("2026-11-14");
    expect(weekStart(new Date("2026-11-14T10:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-09T00:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-15T23:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});

const product = (
  id: string,
  repos: { repo: string; path: string }[],
  mergedInto: string | null = null,
): ProductDoc => ({
  _id: id,
  org: "default",
  name: id,
  repos,
  repoKeys: repos.map((r) => `${r.repo}#${r.path}`),
  mergedInto,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("product resolution", () => {
  const index = indexProducts([
    product("mono", [{ repo: "github.com/acme/mono", path: "" }]),
    product("mono-web", [{ repo: "github.com/acme/mono", path: "apps/web" }]),
    product("billing", [{ repo: "github.com/acme/billing", path: "" }]),
    product("old-billing", [], "billing"),
  ]);

  it("picks the product whose folder holds the work most closely", () => {
    expect(index.resolve("github.com/acme/mono", "apps/web/src")).toBe("mono-web");
    expect(index.resolve("github.com/acme/mono", "apps/api")).toBe("mono");
    expect(index.resolve("github.com/acme/mono")).toBe("mono");
    expect(index.resolve("github.com/acme/other")).toBeNull();
    expect(index.hasFolders("github.com/acme/mono")).toBe(true);
    expect(index.hasFolders("github.com/acme/billing")).toBe(false);
  });

  it("follows a merge, and reads the merged product's old id with the new", () => {
    expect(index.live("old-billing")?._id).toBe("billing");
    expect(index.aliases("billing").sort()).toEqual(["billing", "old-billing"]);
    expect(index.live("nope")).toBeNull();
  });
});

describe("a summary as team records", () => {
  const doc = {
    _id: undefined,
    v: 1,
    userId: "u1",
    authorName: "Ada",
    sessionId: "s1",
    projectId: "p1",
    revision: 2,
    idempotencyKey: "k",
    updatedAt: new Date("2026-11-10T10:00:00Z"),
    receivedAt: new Date("2026-11-10T10:00:00Z"),
    client: null,
    repo: { remote: "git@github.com:acme/billing.git", branch: "PAY-1-x", head: "abc" },
    links: { jira: ["PAY-1"], pr: { number: 12, url: "https://github.com/acme/billing/pull/12" }, noTicket: false },
    summary: {
      title: "Tax rounding",
      built: "Line totals round before summing.",
      why: "Invoices drifted.",
      decisions: ["Round per line"],
      areas: ["tax"],
      open: ["Should credit notes round too?"],
      insights: ["The ledger rounds per line."],
      workflow: [],
      painPoints: ["The integration suite takes 9 minutes."],
      gaps: ["No docs for the retry budget."],
    },
    files: [],
    review: { approved: true, approvedAt: new Date("2026-11-11T09:00:00Z"), edited: false },
  } satisfies SummaryRevisionDoc;

  it("makes one record per line, of the matching kind, with the summary's links", () => {
    const out = fromSummary(doc);
    expect(out.map((r) => r.kind)).toEqual(["summary", "decision", "open", "insight", "pain_point", "context_gap"]);
    expect(out[0]).toMatchObject({
      title: "Tax rounding",
      text: "Line totals round before summing.",
      source: "summary",
    });
    expect(out.every((r) => r.repo === "github.com/acme/billing" && r.sessionId === "s1")).toBe(true);
    expect(out.every((r) => r.at.toISOString() === "2026-11-11T09:00:00.000Z")).toBe(true);
    expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
    expect(summaryRefs(doc)).toEqual([
      { type: "ticket", id: "PAY-1", system: "jira" },
      { type: "pr", id: "12", url: "https://github.com/acme/billing/pull/12", system: "github" },
    ]);
  });
});
