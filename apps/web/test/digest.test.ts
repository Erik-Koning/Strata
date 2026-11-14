// The weekly digest's pure rules: which week ?week= means (Monday to Sunday, UTC, ISO weeks), the digest's address,
// how a week's work is grouped into In progress, and the email it renders: links absolute, text escaped in the HTML,
// and people named only beside the work they did, never counted.
import { describe, expect, it } from "vitest";
import {
  type Digest,
  digestHref,
  digestSummary,
  digestWeek,
  isoWeekOf,
  parseProducts,
  parseWeek,
  rangeLabel,
  renderDigestEmail,
  workOfWeek,
} from "../server/hub/digest.ts";
import type { TeamRecord } from "../server/hub/team-records.ts";
import { HOUR_MS } from "../server/hub/time-math.ts";

const at = (iso: string) => new Date(iso);
// A Saturday: this week runs from Monday 9 to Sunday 15 November 2026.
const NOW = at("2026-11-14T10:00:00Z");

describe("parseWeek", () => {
  it("takes any day of a week to its Monday, 00:00 UTC", () => {
    expect(parseWeek("2026-11-11", NOW).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(parseWeek("2026-11-09", NOW).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    // A Sunday belongs to the week that started the Monday before.
    expect(parseWeek("2026-11-08", NOW).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(parseWeek(["2026-10-01", "2026-11-11"], NOW).toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  it("takes ISO weeks, including a 53rd week only in years that have one", () => {
    expect(parseWeek("2026-W46", NOW).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(parseWeek("2026W45", NOW).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    // Week 1 of 2025 starts on Monday 30 December 2024.
    expect(parseWeek("2025-W01", NOW).toISOString()).toBe("2024-12-30T00:00:00.000Z");
    expect(parseWeek("2020-W53", NOW).toISOString()).toBe("2020-12-28T00:00:00.000Z");
    // 2025 has 52 weeks: no week 53, so this week.
    expect(parseWeek("2025-W53", NOW).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(parseWeek("2026-W00", NOW).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("falls back to this week for a missing, unreadable or future week", () => {
    const thisWeek = "2026-11-09T00:00:00.000Z";
    for (const value of [undefined, "", "last", "2026-02-30", "2026-13-01", "1999-12-27", "2026-11-16", "2027-W01"])
      expect(parseWeek(value, NOW).toISOString()).toBe(thisWeek);
  });
});

describe("weeks", () => {
  it("names ISO weeks across a year's turn", () => {
    expect(isoWeekOf(at("2026-11-09T00:00:00Z"))).toBe("2026-W46");
    expect(isoWeekOf(at("2026-11-15T23:59:59.999Z"))).toBe("2026-W46");
    expect(isoWeekOf(at("2024-12-30T00:00:00Z"))).toBe("2025-W01");
    expect(isoWeekOf(at("2021-01-03T12:00:00Z"))).toBe("2020-W53");
  });

  it("writes a week's days, within a month, across months and across years", () => {
    expect(rangeLabel(at("2026-11-09T00:00:00Z"))).toBe("9 to 15 November 2026");
    expect(rangeLabel(at("2026-10-26T00:00:00Z"))).toBe("26 October to 1 November 2026");
    expect(rangeLabel(at("2025-12-29T00:00:00Z"))).toBe("29 December 2025 to 4 January 2026");
  });

  it("knows this week, last week and earlier ones, and pages between them", () => {
    const thisWeek = digestWeek(at("2026-11-15T23:59:59.999Z"), NOW);
    expect(thisWeek).toMatchObject({
      start: "2026-11-09T00:00:00.000Z",
      end: "2026-11-16T00:00:00.000Z",
      key: "2026-11-09",
      isoWeek: "2026-W46",
      label: "This week",
      current: true,
      weeksAgo: 0,
      previous: "2026-11-02",
      next: null,
    });
    const last = digestWeek(at("2026-11-08T23:59:59.999Z"), NOW);
    expect(last).toMatchObject({ key: "2026-11-02", label: "Last week", current: false, weeksAgo: 1 });
    expect(last.next).toBe("2026-11-09");
    expect(digestWeek(at("2026-10-19T00:00:00Z"), NOW)).toMatchObject({ label: "Week of 19 October", weeksAgo: 3 });
  });
});

describe("addresses", () => {
  it("leaves out this week and every product", () => {
    expect(digestHref({})).toBe("/digest");
    expect(digestHref({ week: "2026-11-02" })).toBe("/digest?week=2026-11-02");
    expect(digestHref({ week: null, productIds: ["billing", "shop"] })).toBe("/digest?product=billing&product=shop");
  });

  it("reads ?product= as given, each once, trimmed", () => {
    expect(parseProducts(undefined)).toEqual([]);
    expect(parseProducts("billing")).toEqual(["billing"]);
    expect(parseProducts(["billing", " shop ", "billing", ""])).toEqual(["billing", "shop"]);
  });
});

let n = 0;
const rec = (
  kind: TeamRecord["kind"],
  sessionId: string,
  when: string,
  extra: Partial<TeamRecord> = {},
): TeamRecord => ({
  id: `r${++n}`,
  kind,
  status: "approved",
  title: null,
  text: `${kind} ${n}`,
  productId: "billing",
  repo: "github.com/acme/billing",
  sessionId,
  refs: [],
  areas: [],
  author: { id: "a", name: "Ada Lovelace" },
  at: at(when),
  source: "summary",
  ...extra,
});

describe("workOfWeek", () => {
  it("groups the week's sessions by ticket, else pull request, else session, newest first", () => {
    const work = workOfWeek([
      rec("summary", "s1", "2026-11-10T10:00:00Z", { title: "Retry", refs: [{ type: "ticket", id: "PAY-1" }] }),
      rec("open", "s1", "2026-11-10T10:00:00Z", { text: "Refunds too?" }),
      rec("summary", "s2", "2026-11-11T10:00:00Z", {
        refs: [{ type: "ticket", id: "PAY-1" }],
        author: { id: "b", name: "Bo Diddley" },
      }),
      rec("summary", "s3", "2026-11-12T10:00:00Z", {
        title: "Tax",
        refs: [{ type: "pr", id: "7", url: "https://github.com/acme/shop/pull/7" }],
      }),
      rec("workflow", "s4", "2026-11-09T00:00:00Z", { text: "Cap retries at three.", author: null }),
    ]);
    expect(work.map((w) => w.key)).toEqual(["pr:https://github.com/acme/shop/pull/7", "ticket:PAY-1", "session:s4"]);
    const pay1 = work[1];
    expect(pay1).toMatchObject({ title: "Retry", sessionIds: ["s2", "s1"], people: ["Ada Lovelace", "Bo Diddley"] });
    expect(pay1?.open.map((o) => o.text)).toEqual(["Refunds too?"]);
    expect(work[2]).toMatchObject({ title: "Cap retries at three.", people: [] });
  });
});

const BASE = "https://strata.example.com/";

function sampleDigest(): Digest {
  return {
    week: digestWeek(at("2026-11-02T00:00:00Z"), NOW),
    picked: [{ id: "billing", name: "billing" }],
    unknown: [],
    products: [
      {
        id: "billing",
        name: "billing",
        sessions: [
          {
            sessionId: "sess-0001-abcdef",
            at: "2026-11-03T10:00:00.000Z",
            summary: {
              id: "r1",
              kind: "summary",
              kindLabel: "Summary",
              title: "Retry <with> backoff",
              text: "Payments retry with backoff & a cap.",
              refs: [],
              sessionId: "sess-0001-abcdef",
              at: "2026-11-03T10:00:00.000Z",
            },
            findings: [
              {
                id: "r2",
                kind: "decision",
                kindLabel: "Decision",
                title: null,
                text: "Cap retries at three.",
                refs: [],
                sessionId: "sess-0001-abcdef",
                at: "2026-11-03T10:00:00.000Z",
              },
            ],
            moreFindings: 2,
            refs: [
              { key: "ticket:PAY-1", kind: "ticket", label: "PAY-1", url: null },
              { key: "pr:x", kind: "pr", label: "PR #7", url: "https://github.com/acme/billing/pull/7" },
            ],
          },
        ],
        moreSessions: 3,
        work: [
          {
            key: "ticket:PAY-1",
            kind: "ticket",
            title: "Retry <with> backoff",
            refs: [{ key: "ticket:PAY-1", kind: "ticket", label: "PAY-1", url: null }],
            sessionIds: ["sess-0001-abcdef"],
            moreSessions: 0,
            people: ["Ada Lovelace", "Bo Diddley"],
            lastAt: "2026-11-03T10:00:00.000Z",
            open: [
              {
                id: "r3",
                kind: "open",
                kindLabel: "Open question",
                title: null,
                text: "Should refunds retry too?",
                refs: [],
                sessionId: "sess-0001-abcdef",
                at: "2026-11-03T10:00:00.000Z",
              },
            ],
          },
        ],
        moreWork: 0,
      },
    ],
    time: {
      top: [
        {
          key: "k1",
          class: "test",
          fp: "1111111111111111",
          repo: "github.com/acme/billing",
          productId: "billing",
          productName: "billing",
          lostMs: 3 * HOUR_MS,
          failedMs: 3 * HOUR_MS,
          rerunMs: 0,
          slowMs: 0,
        },
      ],
      totalMs: 3 * HOUR_MS,
      commands: 1,
    },
    gaps: {
      opened: [
        {
          id: "0123456789abcdef01234567",
          text: "No docs for the retry budget",
          productId: "billing",
          productName: "billing",
          sessions: 2,
          asked: 1,
          owner: "Ada Lovelace",
          at: "2026-11-04T00:00:00.000Z",
          resolution: null,
        },
      ],
      resolved: [
        {
          id: "0123456789abcdef01234568",
          text: "Where do refunds live?",
          productId: "billing",
          productName: "billing",
          sessions: 1,
          asked: 0,
          owner: null,
          at: "2026-11-05T00:00:00.000Z",
          resolution: { url: "https://docs.example.com/refunds", note: "" },
        },
      ],
      moreOpened: 0,
      moreResolved: 0,
    },
    href: "/digest?week=2026-11-02&product=billing",
  };
}

const PERSON_COUNT =
  /\b\d+\s+(?:other\s+)?(?:people|persons?|engineers?|contributors?|members?|authors?|developers?|teammates?)\b/i;

describe("renderDigestEmail", () => {
  const email = renderDigestEmail(sampleDigest(), { baseUrl: BASE });

  it("has a subject naming the week and the products", () => {
    expect(email.subject).toBe("Strata weekly digest for billing: 2 to 8 November 2026");
  });

  it("links everything absolutely, from the app's address", () => {
    const hrefs = [...email.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) expect(href).toMatch(/^https?:\/\//);
    expect(hrefs).toContain("https://strata.example.com/products/billing");
    expect(hrefs).toContain("https://strata.example.com/sessions/sess-0001-abcdef");
    expect(hrefs).toContain("https://strata.example.com/gaps/0123456789abcdef01234567");
    // Escaped as HTML attributes are: the browser reads &amp; as &.
    expect(hrefs).toContain("https://strata.example.com/digest?week=2026-11-02&amp;product=billing");
    // Every address in the text part is absolute too, and there's no path left on its own.
    expect(email.text).toContain("https://strata.example.com/digest?week=2026-11-02&product=billing");
    expect(email.text).toContain("https://strata.example.com/sessions/sess-0001-abcdef");
    expect(email.text).not.toMatch(/(^|[\s(])\/(products|sessions|gaps|digest|time)\b/m);
  });

  it("says the same in text and HTML, with the HTML escaped", () => {
    for (const part of ["Retry <with> backoff", "Cap retries at three.", "Should refunds retry too?", "3 h"])
      expect(email.text).toContain(part);
    expect(email.html).toContain("Retry &lt;with&gt; backoff");
    expect(email.html).toContain("backoff &amp; a cap");
    expect(email.html).not.toContain("<with>");
    expect(email.text).toContain("PR #7 (https://github.com/acme/billing/pull/7)");
    expect(email.text).toContain("Answered by https://docs.example.com/refunds");
  });

  it("names people beside the work they did, and never counts them", () => {
    expect(email.text).toContain("with Ada Lovelace and Bo Diddley");
    expect(email.text).not.toMatch(PERSON_COUNT);
    expect(email.html).not.toMatch(PERSON_COUNT);
    expect(email.text).not.toMatch(/asked \d+ times|\d+ questions?/i);
  });

  it("refuses an address that isn't absolute http(s)", () => {
    expect(() => renderDigestEmail(sampleDigest(), { baseUrl: "/relative" })).toThrow(/absolute/);
    expect(() => renderDigestEmail(sampleDigest(), { baseUrl: "javascript:alert(1)" })).toThrow(/http/);
    const sub = renderDigestEmail(sampleDigest(), { baseUrl: "https://example.com/strata/" });
    expect(sub.text).toContain("https://example.com/strata/products/billing");
  });

  it("says plainly when a week had nothing in it", () => {
    const empty: Digest = {
      ...sampleDigest(),
      picked: [],
      products: [],
      time: { top: [], totalMs: 0, commands: 0 },
      gaps: { opened: [], resolved: [], moreOpened: 0, moreResolved: 0 },
      href: "/digest?week=2026-11-02",
    };
    const quiet = renderDigestEmail(empty, { baseUrl: BASE });
    expect(quiet.subject).toBe("Strata weekly digest: 2 to 8 November 2026");
    expect(quiet.text).toContain("Nothing was approved this week.");
    expect(quiet.text).toContain("No time lost to tools this week.");
    expect(quiet.text).toContain("No gap was opened or resolved this week.");
    expect(digestSummary(empty)).toBe("No sessions shared, no time lost to tools, no gaps opened or resolved");
  });
});
