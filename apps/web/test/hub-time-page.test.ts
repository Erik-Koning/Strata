// The time page's pure parts: the filters read from the address, how time is written, which pain points a command
// gets, and the ticket it copies.
import { describe, expect, it } from "vitest";
import {
  classNoun,
  formatDay,
  formatDuration,
  formatLost,
  mentionsClass,
  painPointsFor,
  parseTimeFilters,
  type TicketInput,
  ticketMarkdown,
  timeHref,
} from "../server/hub/time-page.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("the filters", () => {
  it("reads the range and the product, falling back to 30 days and every product", () => {
    expect(parseTimeFilters({})).toEqual({ days: 30, productId: null });
    expect(parseTimeFilters({ range: "7", product: "billing" })).toEqual({ days: 7, productId: "billing" });
    expect(parseTimeFilters({ range: ["90", "7"] })).toEqual({ days: 90, productId: null });
    expect(parseTimeFilters({ range: "14" }).days).toBe(30);
    expect(parseTimeFilters({ range: "abc" }).days).toBe(30);
  });

  it("refuses a product that can't be a product's id", () => {
    for (const product of ["", " ", "Billing", "../x", "a b", "{$ne:1}", "-billing", "x".repeat(101)])
      expect(parseTimeFilters({ product }).productId).toBeNull();
    expect(parseTimeFilters({ product: "acme-billing-2" }).productId).toBe("acme-billing-2");
  });

  it("writes the page's address without the defaults", () => {
    expect(timeHref({ days: 30, productId: null })).toBe("/time");
    expect(timeHref({ days: 7, productId: null })).toBe("/time?range=7");
    expect(timeHref({ days: 90, productId: "billing" })).toBe("/time?product=billing&range=90");
    expect(timeHref({ days: 30, productId: "billing" })).toBe("/time?product=billing");
  });
});

describe("writing time", () => {
  it("writes time lost in hours, then minutes", () => {
    expect(formatLost(0)).toBe("none");
    expect(formatLost(20_000)).toBe("under 1 min");
    expect(formatLost(42 * MIN)).toBe("42 min");
    expect(formatLost(59.7 * MIN)).toBe("1.0 h");
    expect(formatLost(12.44 * HOUR)).toBe("12.4 h");
    expect(formatLost(1234 * HOUR)).toBe("1,234 h");
  });

  it("writes one run's length", () => {
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(2_400)).toBe("2.4 s");
    expect(formatDuration(38_000)).toBe("38 s");
    expect(formatDuration(200_000)).toBe("3 min 20 s");
    expect(formatDuration(180_000)).toBe("3 min");
    expect(formatDuration(65 * MIN)).toBe("1 h 5 min");
  });

  it("writes days in UTC", () => {
    expect(formatDay("2026-11-03")).toBe("3 Nov");
    expect(formatDay(new Date("2026-11-03T23:30:00Z"), true)).toBe("3 Nov 2026");
    expect(formatDay("2026-11-02T00:00:00.000Z")).toBe("2 Nov");
  });

  it("names a class's runs, known or not", () => {
    expect(classNoun("typecheck")).toBe("type checks");
    expect(classNoun("deploy")).toBe("deploy commands");
  });
});

describe("pain points for a command", () => {
  it("knows when a pain point talks about a kind of command, by whole words", () => {
    expect(mentionsClass("The Vitest suite is flaky on CI", "test")).toBe(true);
    expect(mentionsClass("Type-check takes forever", "typecheck")).toBe(true);
    expect(mentionsClass("node_modules gets corrupted", "install")).toBe(true);
    expect(mentionsClass("Contest entries are slow", "test")).toBe(false);
    expect(mentionsClass("Deploys are manual", "deploy")).toBe(false);
    expect(mentionsClass("Every deploy is manual", "deploy")).toBe(true);
  });

  it("puts those about the command first, then its repository's, then the newest", () => {
    const at = (days: number) => new Date(Date.UTC(2026, 10, 14 - days));
    const records = [
      { id: "a", text: "Docs are thin", sessionId: "s1", at: at(0), repo: "github.com/acme/billing" },
      { id: "b", text: "Tests are flaky", sessionId: "s2", at: at(5), repo: "github.com/acme/other" },
      { id: "c", text: "Login is confusing", sessionId: "s3", at: at(1), repo: "github.com/acme/other" },
      { id: "d", text: "Vitest hangs", sessionId: "s4", at: at(9), repo: "github.com/acme/billing" },
      { id: "e", text: "Slow review", sessionId: "s5", at: at(2), repo: "github.com/acme/billing" },
    ];
    const picked = painPointsFor(records, { class: "test", repo: "github.com/acme/billing" });
    expect(picked.map((p) => p.id)).toEqual(["d", "b", "a", "e"]);
    expect(picked[0]).toEqual({
      id: "d",
      text: "Vitest hangs",
      sessionId: "s4",
      at: at(9).toISOString(),
      mentions: true,
    });
    expect(picked.filter((p) => p.mentions).map((p) => p.id)).toEqual(["d", "b"]);
    expect(painPointsFor([], { class: "test", repo: "x" })).toEqual([]);
  });
});

describe("the ticket", () => {
  const input: TicketInput = {
    class: "test",
    repo: "github.com/acme/billing",
    fp: "9b2c4e6f8a0d1c3e",
    productId: "billing",
    productName: "billing",
    runs: 34,
    failures: 5,
    reruns: 1,
    medianMs: 80_000,
    lost: { failedMs: 1.5 * HOUR, rerunMs: 30 * MIN, slowMs: 6 * MIN, totalMs: 2.1 * HOUR },
    trend: [
      { weekStart: "2026-11-02T00:00:00.000Z", lostMs: 0.5 * HOUR, runs: 10, failures: 1, reruns: 0 },
      { weekStart: "2026-11-09T00:00:00.000Z", lostMs: 1.6 * HOUR, runs: 24, failures: 4, reruns: 1 },
    ],
    painPoints: [
      {
        id: "p1",
        text: "The billing tests\nare flaky",
        sessionId: "abc 1",
        at: "2026-11-10T00:00:00.000Z",
        mentions: true,
      },
    ],
    days: 30,
    since: new Date("2026-10-15T12:00:00Z"),
    until: new Date("2026-11-14T12:00:00Z"),
    baseURL: "https://strata.example.com/",
  };

  it("has the title, the hours, the runs and failures, the trend and the pain points, with links", () => {
    expect(ticketMarkdown(input)).toBe(
      [
        "## Cut time lost to test runs in billing",
        "",
        "**2.1 h lost** to one test command (fingerprint `9b2c4e6f8a0d`) in github.com/acme/billing over the last 30 " +
          "days (15 Oct to 14 Nov 2026).",
        "",
        "- Runs: 34, of which 5 failed and 1 re-run",
        "- Where the time went: failed runs 1.5 h, re-runs 30 min, slow first runs 6 min",
        "- Typical run: 1 min 20 s",
        "",
        "### Time lost per week",
        "",
        "- Week of 2 Nov: 30 min",
        "- Week of 9 Nov: 1.6 h",
        "",
        "### What sessions said",
        "",
        "- The billing tests are flaky ([session](https://strata.example.com/sessions/abc%201))",
        "",
        "Measured by Strata on the command, never on people: https://strata.example.com/time?product=billing",
      ].join("\n"),
    );
  });

  it("leaves out the sections it has nothing for, and names the repository when there's no product", () => {
    const text = ticketMarkdown({ ...input, productId: null, productName: null, trend: [], painPoints: [], days: 7 });
    expect(text).toContain("## Cut time lost to test runs in github.com/acme/billing");
    expect(text).not.toContain("### Time lost per week");
    expect(text).not.toContain("### What sessions said");
    expect(text).toContain("https://strata.example.com/time?range=7");
  });
});
