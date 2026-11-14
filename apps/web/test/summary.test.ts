import { describe, expect, it } from "vitest";
import { sanitizeFiles, sanitizeLinks, sanitizeSummary } from "../server/summary/sanitize.ts";

const summary = {
  title: "Tax rounding",
  built: "Rounded line totals.",
  why: "",
  decisions: ["Round per line"],
  areas: ["tax"],
  open: [],
  insights: [],
  workflow: [],
  painPoints: [],
  gaps: [],
};

describe("summary sanitizer", () => {
  it("strips tags, code and secrets, and enforces the field limits", () => {
    const out = sanitizeSummary({
      ...summary,
      title: "T".repeat(300),
      built: `Did \`\`\`rm -rf /\`\`\` and <private>secret</private> with sk-${"q".repeat(30)}`,
      decisions: ["a", "b", "c", "d", "e", "f"],
    });
    expect(out.title).toHaveLength(100);
    expect(out.built).not.toMatch(/rm -rf|private|sk-q/);
    expect(out.built).toContain("[REDACTED:");
    expect(out.decisions).toHaveLength(5);
  });

  it("keeps only valid Jira keys, deduped and uppercase; accepts an https PR", () => {
    const links = sanitizeLinks({
      jira: ["abc-12", "ABC-12", "not a key", "UTF-8"],
      pr: { url: "https://github.com/acme/shop/pull/4", number: 4, title: "Fix" },
      noTicket: false,
    });
    expect(links.jira).toEqual(["ABC-12"]);
    expect(links.pr?.url).toBe("https://github.com/acme/shop/pull/4");
  });

  it("drops a non-https PR and relative, absolute or escaping file paths", () => {
    expect(sanitizeLinks({ jira: [], pr: { url: "javascript:alert(1)" }, noTicket: true }).pr).toBeNull();
    expect(sanitizeFiles(["src/a.ts", "/etc/passwd", "../secret", "C:\\keys.txt", "src/a.ts"])).toEqual(["src/a.ts"]);
  });
});
