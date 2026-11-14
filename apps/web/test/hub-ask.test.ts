// Ask Strata's rules that need no database: how a question is cleaned and capped, how it's read (search, recent or
// onboarding), and the hourly guard on questions.
import { describe, expect, it } from "vitest";
import { cleanQuestion, modeOf, QUESTION_MAX, takeQuestion, termsOf, windowDays } from "../server/hub/ask.ts";
import { Refusal } from "../server/people.ts";

describe("the question", () => {
  it("is trimmed, its spacing collapsed", () => {
    expect(cleanQuestion("  Why is   the retry\n budget three?  ")).toBe("Why is the retry budget three?");
  });

  it(`is at most ${QUESTION_MAX} characters, after trimming`, () => {
    const longest = `${"a".repeat(QUESTION_MAX - 1)}?`;
    expect(cleanQuestion(`   ${longest}   `)).toBe(longest);
    expect(() => cleanQuestion(`${longest}b`)).toThrow(Refusal);
    expect(() => cleanQuestion(`${longest}b`)).toThrow(/500 characters/);
  });

  it("must be text with something in it", () => {
    for (const raw of ["", "   \n\t ", undefined, null, 42, { question: "why" }])
      expect(() => cleanQuestion(raw)).toThrow(Refusal);
  });
});

describe("how a question is read", () => {
  it("asks for a first week when someone says they're new", () => {
    for (const q of [
      "I'm new to billing: where do I start?",
      "I am new here, what should I read?",
      "Where should I start with the ledger?",
      "Any onboarding notes for checkout?",
    ])
      expect(modeOf(q)).toBe("onboarding");
  });

  it("reads what was approved lately when asked what changed", () => {
    for (const q of [
      "What changed in billing this week?",
      "What's new in checkout?",
      "Anything shipped recently?",
      "What happened last month in the ledger?",
    ])
      expect(modeOf(q)).toBe("recent");
    expect(windowDays("What changed this week?")).toBe(7);
    expect(windowDays("What changed this month?")).toBe(31);
    expect(windowDays("What landed today?")).toBe(2);
  });

  it("searches otherwise", () => {
    for (const q of ["Why is the retry budget three?", "How do I run the billing tests?", "Who owns the new ledger?"])
      expect(modeOf(q)).toBe("search");
  });

  it("matches words, not small ones or a question's own", () => {
    expect([...termsOf("Why is the retry budget three?")].sort()).toEqual(["budget", "retry", "three"]);
    expect(termsOf("Retries")).toEqual(termsOf("retry's retried retrying"));
  });
});

describe("the hourly guard", () => {
  it("lets a person ask 60 questions an hour, and counts nobody else's", () => {
    const start = Date.UTC(2026, 10, 14, 9);
    for (let i = 0; i < 60; i++) expect(takeQuestion("guard-a", start + i * 1000)).toBe(true);
    expect(takeQuestion("guard-a", start + 61_000)).toBe(false);
    expect(takeQuestion("guard-b", start + 61_000)).toBe(true);
    expect(takeQuestion("guard-a", start + 60 * 60 * 1000 + 1000)).toBe(true);
  });
});
