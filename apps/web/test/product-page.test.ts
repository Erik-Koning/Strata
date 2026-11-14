// The products pages' pure rules: which refs become chips and links, how a week's work is grouped by session, and how
// durations and weeks are written.
import { describe, expect, it } from "vitest";
import { durationLabel, refLinks, repoUrl, sessionsOfWeek, webUrl, weekLabel } from "../server/hub/product-page.ts";
import type { TeamRecord } from "../server/hub/team-records.ts";
import { HOUR_MS } from "../server/hub/time-math.ts";

const at = (iso: string) => new Date(iso);

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
  author: { id: "a", name: "Ada" },
  at: at(when),
  source: "summary",
  ...extra,
});

describe("refLinks", () => {
  it("keeps tickets and pull requests, each once, and drops the rest", () => {
    const links = refLinks([
      { type: "ticket", id: "PAY-1", system: "jira" },
      { type: "ticket", id: "pay-1" },
      { type: "pr", id: "7", url: "https://github.com/acme/shop/pull/7" },
      { type: "pr", id: "7", url: "https://github.com/acme/shop/pull/7" },
      { type: "commit", id: "abc1234" },
      { type: "doc", id: "adr-3", url: "https://example.com/adr-3" },
    ]);
    expect(links).toEqual([
      { key: "ticket:PAY-1", kind: "ticket", label: "PAY-1", url: null },
      {
        key: "pr:https://github.com/acme/shop/pull/7",
        kind: "pr",
        label: "PR #7",
        url: "https://github.com/acme/shop/pull/7",
      },
    ]);
  });

  it("names a pull request from its address when its id is the address", () => {
    const url = "https://gitlab.com/acme/shop/-/merge_requests/12";
    expect(refLinks([{ type: "pr", id: url, url }])[0]?.label).toBe("PR #12");
    expect(refLinks([{ type: "pr", id: "https://example.com/review/x" }])[0]?.label).toBe("Pull request");
  });

  it("never links anything but http and https", () => {
    const links = refLinks([
      { type: "pr", id: "1", url: "javascript:alert(1)" },
      { type: "ticket", id: "PAY-2", url: "data:text/html,hi" },
    ]);
    expect(links.map((l) => l.url)).toEqual([null, null]);
    expect(webUrl("https://github.com/acme/shop/pull/7")).toBe("https://github.com/acme/shop/pull/7");
    expect(webUrl("not a url")).toBeNull();
    expect(webUrl(undefined)).toBeNull();
  });
});

describe("repoUrl", () => {
  it("links the hosts whose page is the repository's name", () => {
    expect(repoUrl("github.com/acme/billing")).toBe("https://github.com/acme/billing");
    expect(repoUrl("gitlab.com/acme/group/app")).toBe("https://gitlab.com/acme/group/app");
    expect(repoUrl("git.internal.example/acme/app")).toBeNull();
  });
});

describe("durationLabel", () => {
  it("says durations as people do", () => {
    expect(durationLabel(0)).toBe("none");
    expect(durationLabel(20_000)).toBe("under a minute");
    expect(durationLabel(40 * 60_000)).toBe("40 min");
    expect(durationLabel(2.54 * HOUR_MS)).toBe("2.5 h");
    expect(durationLabel(14.4 * HOUR_MS)).toBe("14 h");
  });
});

describe("weekLabel", () => {
  const now = at("2026-11-14T12:00:00Z"); // a Saturday; its week starts Monday 9 November
  it("names this week and last week, and dates the others", () => {
    expect(weekLabel(at("2026-11-09T00:00:00Z"), now)).toBe("This week");
    expect(weekLabel(at("2026-11-02T00:00:00Z"), now)).toBe("Last week");
    expect(weekLabel(at("2026-10-26T00:00:00Z"), now)).toBe("Week of 26 October");
  });
});

describe("sessionsOfWeek", () => {
  it("puts each session's findings under its summary, newest session first", () => {
    const s1 = rec("summary", "s1", "2026-11-10T10:00:00Z", {
      title: "Retry with backoff",
      refs: [{ type: "ticket", id: "PAY-1" }],
    });
    const s2 = rec("summary", "s2", "2026-11-12T10:00:00Z", { title: "Checkout tax" });
    const insight = rec("insight", "s1", "2026-11-10T11:00:00Z");
    const decision = rec("decision", "s1", "2026-11-10T09:00:00Z");
    const loose = rec("pain_point", "s3", "2026-11-11T09:00:00Z", { refs: [{ type: "ticket", id: "PAY-9" }] });
    const sessions = sessionsOfWeek([s1, s2], [insight, decision, loose]);
    expect(sessions.map((s) => s.sessionId)).toEqual(["s2", "s3", "s1"]);
    const first = sessions.find((s) => s.sessionId === "s1");
    expect(first?.summary?.title).toBe("Retry with backoff");
    // Decisions before insights, whatever their order in time.
    expect(first?.findings.map((f) => f.kindLabel)).toEqual(["Decision", "Insight"]);
    expect(first?.refs.map((r) => r.label)).toEqual(["PAY-1"]);
    expect(first?.at).toBe("2026-11-10T11:00:00.000Z");
    // A session with findings and no summary this week stands alone, with its findings' refs.
    const alone = sessions.find((s) => s.sessionId === "s3");
    expect(alone?.summary).toBeNull();
    expect(alone?.refs.map((r) => r.label)).toEqual(["PAY-9"]);
  });

  it("shows a few findings and says how many more there are", () => {
    const findings = Array.from({ length: 7 }, (_, i) => rec("insight", "s1", `2026-11-10T0${i}:00:00Z`));
    const [session] = sessionsOfWeek([rec("summary", "s1", "2026-11-10T08:00:00Z")], findings);
    expect(session?.findings).toHaveLength(4);
    expect(session?.moreFindings).toBe(3);
  });

  it("gives dates as strings, ready for a client component", () => {
    const [session] = sessionsOfWeek([rec("summary", "s1", "2026-11-10T08:00:00Z")], []);
    expect(JSON.parse(JSON.stringify(session))).toEqual(session);
  });
});
