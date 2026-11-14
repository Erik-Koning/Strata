// The small rules the session page shows things by: its address, durations, and which links are safe to follow.
import { describe, expect, it } from "vitest";
import { commitUrl, duration, repoUrl, safeUrl, sessionHref, sessionIdFrom } from "../components/sessions/format.ts";

describe("a session's address", () => {
  it("encodes the id and reads it back", () => {
    expect(sessionHref("0b6e-41aa")).toBe("/sessions/0b6e-41aa");
    expect(sessionHref("a/b c")).toBe("/sessions/a%2Fb%20c");
    expect(sessionIdFrom("a%2Fb%20c")).toBe("a/b c");
    expect(sessionIdFrom("100%")).toBe("100%");
  });
});

describe("duration", () => {
  it("says it the way people do", () => {
    expect(duration(840)).toBe("840 ms");
    expect(duration(4200)).toBe("4.2 s");
    expect(duration(38_000)).toBe("38 s");
    expect(duration(59_700)).toBe("1 min");
    expect(duration(125_000)).toBe("2 min 5 s");
    expect(duration(3_840_000)).toBe("1 h 4 min");
    expect(duration(7_200_000)).toBe("2 h");
    expect(duration(-5)).toBe("0 ms");
  });
});

describe("links", () => {
  it("follows only http and https", () => {
    expect(safeUrl("https://github.com/acme/billing/pull/7")).toBe("https://github.com/acme/billing/pull/7");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });

  it("links repositories and commits on the hosts it knows", () => {
    expect(repoUrl("github.com/acme/billing")).toBe("https://github.com/acme/billing");
    expect(repoUrl("git.internal.example/acme/billing")).toBeNull();
    expect(commitUrl("github.com/acme/billing", "abc1234")).toBe("https://github.com/acme/billing/commit/abc1234");
    expect(commitUrl("gitlab.com/acme/billing", "abc1234")).toBe("https://gitlab.com/acme/billing/-/commit/abc1234");
    expect(commitUrl("github.com/acme/billing", "not a sha")).toBeNull();
  });
});
