import { describe, expect, it } from "vitest";
import { extract, statusFor } from "../server/memory/extract.ts";

describe("extract", () => {
  it("keeps what the user asked to remember, without the request around it", () => {
    expect(extract("Please remember that we deploy from the release branch.")).toEqual([
      { text: "We deploy from the release branch.", kind: "fact", confidence: 0.85 },
    ]);
  });

  it("drops a lead-in however it's punctuated", () => {
    expect(extract("Also: remember that we always run the linter before committing.")[0]?.text).toBe(
      "We always run the linter before committing.",
    );
  });

  it("finds preferences, conventions and decisions", () => {
    const found = extract(
      "I prefer tabs over spaces. In this repo tests sit next to the code. We decided to use Better Auth.",
    );
    expect(found.map((f) => f.kind)).toEqual(["preference", "convention", "decision"]);
  });

  it("ignores questions, code and ordinary chatter", () => {
    expect(extract("Should we always use pnpm?\n```\nalways();\n```\nLet me look at the failing test.")).toEqual([]);
  });

  it("promotes only what the user said in their own turn", () => {
    expect(statusFor("user", "prompt")).toBe("active");
    expect(statusFor("assistant", "assistant")).toBe("candidate");
    expect(statusFor("user", "transcript")).toBe("candidate");
    expect(statusFor(undefined, "tool")).toBe("candidate");
  });
});
