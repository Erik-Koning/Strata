import { describe, expect, it } from "vitest";
import { STUB_DIMENSIONS, stubEmbed, stubSummarize } from "../server/ai/provider.ts";

const cosine = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

describe("the stub provider", () => {
  it("gives the same unit vector for the same text, every time", () => {
    const a = stubEmbed("We always use pnpm in this repository");
    expect(a).toEqual(stubEmbed("We always use pnpm in this repository"));
    expect(a).toHaveLength(STUB_DIMENSIONS);
    expect(Math.abs(cosine(a, a) - 1)).toBeLessThan(1e-3);
  });

  it("puts related texts nearer than unrelated ones", () => {
    const memory = stubEmbed("We always use pnpm, never npm");
    expect(cosine(memory, stubEmbed("which package manager: pnpm or npm?"))).toBeGreaterThan(
      cosine(memory, stubEmbed("the staging database password rotates monthly")),
    );
  });

  it("summarizes extractively, and gives nothing for nothing", () => {
    expect(
      stubSummarize([
        { role: "user", text: "Add sign in" },
        { role: "assistant", text: "Added it." },
      ]),
    ).toBe("The user asked: Add sign in\nIt ended with: Added it.");
    expect(stubSummarize([])).toBeNull();
  });
});
