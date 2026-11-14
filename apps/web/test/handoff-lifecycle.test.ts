// The handoff lifecycle's pure rules: who reads, who acts, and when a continuation counts as verified.
import { describe, expect, it } from "vitest";
import {
  canRead,
  canResume,
  exclusionFor,
  isVerified,
  partyOf,
  RULES,
  testerFor,
} from "../server/handoffs/lifecycle.ts";

const h = (status: "draft" | "approved" | "claimed" | "completed" | "revoked", recipient: string | null = "b") => ({
  status,
  sender: { id: "a" },
  recipient: recipient ? { id: recipient } : null,
});

describe("who reads a handoff", () => {
  it("lets the sender read it in every status", () => {
    for (const s of ["draft", "approved", "claimed", "completed", "revoked"] as const)
      expect(canRead(h(s), "a")).toBe(true);
  });

  it("lets the recipient read it from approval until revoked, never a draft", () => {
    expect(canRead(h("draft"), "b")).toBe(false);
    expect(canRead(h("approved"), "b")).toBe(true);
    expect(canRead(h("claimed"), "b")).toBe(true);
    expect(canRead(h("completed"), "b")).toBe(true);
    expect(canRead(h("revoked"), "b")).toBe(false);
  });

  it("lets nobody else read it", () => {
    for (const s of ["draft", "approved", "claimed", "completed", "revoked"] as const)
      expect(canRead(h(s), "c")).toBe(false);
    expect(partyOf(h("approved"), "c")).toBeNull();
    expect(partyOf(h("draft", null), "b")).toBeNull();
  });
});

describe("who acts", () => {
  it("gives each step to one party, from the statuses the lifecycle draws", () => {
    expect(RULES.approve).toEqual({ party: "sender", from: ["draft"] });
    expect(RULES.claim).toEqual({ party: "recipient", from: ["approved"] });
    expect(RULES.complete).toEqual({ party: "recipient", from: ["claimed"] });
    expect(RULES.revoke.from).not.toContain("completed");
  });

  it("lets the sender record tests while drafting, the recipient once claimed", () => {
    expect(testerFor("draft", "sender")).toBe("sender");
    expect(testerFor("approved", "sender")).toBeNull();
    expect(testerFor("approved", "recipient")).toBeNull();
    expect(testerFor("claimed", "recipient")).toBe("recipient");
    expect(testerFor("completed", "recipient")).toBeNull();
  });

  it("lets the sender preview a resume any time, the recipient while it's theirs to work on", () => {
    expect(canResume("draft", "sender")).toBe(true);
    expect(canResume("approved", "recipient")).toBe(true);
    expect(canResume("claimed", "recipient")).toBe(true);
    expect(canResume("completed", "recipient")).toBe(false);
  });
});

describe("verification", () => {
  const claimedAt = new Date("2026-11-14T10:00:00Z");
  const at = (min: number) => new Date(claimedAt.getTime() + min * 60_000);
  const run = (
    command: string,
    status: "pass" | "fail",
    min: number,
    verified = true,
    by: "sender" | "recipient" = "recipient",
  ) => ({
    command,
    status,
    verified,
    by,
    at: at(min),
  });

  it("needs every command's latest verified recipient run since the claim to pass", () => {
    const cmds = ["pnpm test", "pnpm lint"];
    expect(isVerified(cmds, [run("pnpm test", "pass", 1), run("pnpm lint", "pass", 2)], claimedAt)).toBe(true);
    expect(isVerified(cmds, [run("pnpm test", "pass", 1)], claimedAt)).toBe(false);
    expect(
      isVerified(
        cmds,
        [run("pnpm test", "fail", 1), run("pnpm test", "pass", 3), run("pnpm lint", "pass", 2)],
        claimedAt,
      ),
    ).toBe(true);
    expect(
      isVerified(
        cmds,
        [run("pnpm test", "pass", 1), run("pnpm test", "fail", 3), run("pnpm lint", "pass", 2)],
        claimedAt,
      ),
    ).toBe(false);
  });

  it("doesn't count claims, the sender's runs, or runs from before the claim", () => {
    const cmds = ["pnpm test"];
    expect(isVerified(cmds, [run("pnpm test", "pass", 1, false)], claimedAt)).toBe(false);
    expect(isVerified(cmds, [run("pnpm test", "pass", 1, true, "sender")], claimedAt)).toBe(false);
    expect(isVerified(cmds, [run("pnpm test", "pass", -5)], claimedAt)).toBe(false);
    // A later claim of failure doesn't undo a verified pass; only a verified run does.
    expect(isVerified(cmds, [run("pnpm test", "pass", 1), run("pnpm test", "fail", 2, false)], claimedAt)).toBe(true);
  });

  it("is never true with nothing to verify, or before a claim", () => {
    expect(isVerified([], [], claimedAt)).toBe(false);
    expect(isVerified(["pnpm test"], [run("pnpm test", "pass", 1)], null)).toBe(false);
  });
});

describe("shared memories, as they stand now", () => {
  const owner = { org: "default", user: "a" };
  const now = new Date("2026-11-14T10:00:00Z");
  const m = (over: Partial<{ status: string; expiresAt: Date | null; user: string }> = {}) => ({
    status: over.status ?? "active",
    expiresAt: over.expiresAt ?? null,
    scope: { org: "default", user: over.user ?? "a" },
  });

  it("names why one isn't returned", () => {
    expect(exclusionFor(m(), owner, now)).toBeNull();
    expect(exclusionFor(null, owner, now)).toBe("forgotten");
    expect(exclusionFor(m({ status: "archived" }), owner, now)).toBe("archived");
    expect(exclusionFor(m({ status: "superseded" }), owner, now)).toBe("superseded");
    expect(exclusionFor(m({ status: "candidate" }), owner, now)).toBe("not_active");
    expect(exclusionFor(m({ expiresAt: new Date(now.getTime() - 1) }), owner, now)).toBe("expired");
    expect(exclusionFor(m({ expiresAt: new Date(now.getTime() + 60_000) }), owner, now)).toBeNull();
    expect(exclusionFor(m({ user: "c" }), owner, now)).toBe("not_owned");
  });
});
