import { describe, expect, it } from "vitest";
import { renderFrozen, renderRecall } from "../src/render.ts";

const a = { _id: "6750a0000000000000000001", kind: "preference", text: "Prefers pnpm over npm." };
const b = { _id: "6750a0000000000000000002", kind: "convention", text: "Tests sit next to the code.\n\nAlways." };

describe("renderFrozen", () => {
  it("gives the same bytes whatever order the memories arrive in", () => {
    expect(renderFrozen([b, a])).toBe(renderFrozen([a, b]));
  });

  it("is sorted by _id, one line each, with whitespace collapsed", () => {
    expect(renderFrozen([b, a]).split("\n").slice(2, 4)).toEqual([
      "- [preference] Prefers pnpm over npm.",
      "- [convention] Tests sit next to the code. Always.",
    ]);
  });

  it("is empty for no memories, so the client sends nothing", () => {
    expect(renderFrozen([])).toBe("");
  });

  it("holds no dates or numbers it didn't get", () => {
    expect(renderFrozen([a])).not.toMatch(/\d{4}-\d{2}-\d{2}|\d+ memories/);
  });

  it("cuts a long memory the same way every time", () => {
    const long = { ...a, text: "x".repeat(2000) };
    expect(renderFrozen([long])).toBe(renderFrozen([long]));
    expect(renderFrozen([long]).length).toBeLessThan(800);
  });
});

describe("renderRecall", () => {
  it("wraps what was recalled in a memory tag", () => {
    expect(renderRecall([a])).toBe(
      "<memory>\nRecalled for this message:\n- [preference] Prefers pnpm over npm.\n</memory>",
    );
    expect(renderRecall([])).toBe("");
  });
});
