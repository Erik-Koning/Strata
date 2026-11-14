import { describe, expect, it } from "vitest";
import { redact, redactDeep } from "../src/redact.ts";

describe("redact", () => {
  const cases: [string, string, string][] = [
    ["an Anthropic key", "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123", "[REDACTED:anthropic-key]"],
    ["an OpenAI project key", "use sk-proj-abcdefghijklmnopqrstuvwx1234 here", "[REDACTED:openai-key]"],
    ["a GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[REDACTED:github-token]"],
    ["an AWS access key", "AKIAABCDEFGHIJKLMNOP", "[REDACTED:aws-access-key]"],
    ["a memory API key", "am_abcdefghijklmnopqrstuvwxyz012345", "[REDACTED:memory-api-key]"],
    ["an env assignment", "MEMORY_API_TOKEN=abcdef0123456789", "MEMORY_API_TOKEN=[REDACTED:secret]"],
    ["a JSON password", '"password": "hunter2hunter2"', '"password": "[REDACTED:secret]"'],
    ["a bearer header", "Authorization: Bearer abcdefghijklmnopqrstuvwx", "Bearer [REDACTED:bearer]"],
  ];
  for (const [what, input, expected] of cases) {
    it(`removes ${what}`, () => {
      const out = redact(input);
      expect(out).toContain(expected);
    });
  }

  it("keeps a connection string's user and host, and drops its password", () => {
    expect(redact("mongodb+srv://ada:s3cretpass@cluster0.example.net/db")).toBe(
      "mongodb+srv://ada:[REDACTED:url-password]@cluster0.example.net/db",
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "Use pnpm, not npm. Tests live next to the code they test; the token budget is 800ms.";
    expect(redact(text)).toBe(text);
  });

  it("changes nothing on a second pass", () => {
    const once = redact(
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 and sk-ant-api03-abcdefghijklmnopqrstuvwx",
    );
    expect(redact(once)).toBe(once);
  });

  it("redacts every string in a payload, and the value of a key named like a secret", () => {
    const out = redactDeep({
      text: "my key is sk-ant-api03-abcdefghijklmnopqrstuvwx",
      headers: { authorization: "x" },
      n: 3,
    });
    expect(out).toEqual({
      text: "my key is [REDACTED:anthropic-key]",
      headers: { authorization: "[REDACTED:secret]" },
      n: 3,
    });
  });
});
