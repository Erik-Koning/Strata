import { describe, expect, it } from "vitest";
import { loadConfig, normalizeRemote } from "../src/config.ts";
import { parseTranscript } from "../src/transcript.ts";
import { ulid } from "../src/ulid.ts";

describe("config", () => {
  it("is inert without both an address and a token", () => {
    expect(loadConfig({ MEMORY_API_URL: "http://x" }, "/tmp")).toBeNull();
    expect(loadConfig({ MEMORY_API_TOKEN: "t" }, "/tmp")).toBeNull();
    // An option Claude Code left unfilled arrives as its own placeholder.
    const placeholder = ["$", "{user_config.api_url}"].join("");
    expect(loadConfig({ STRATA_API_URL: placeholder, STRATA_API_TOKEN: "t" }, "/tmp")).toBeNull();
  });

  it("takes the environment first, then the plugin's options", () => {
    const env = {
      MEMORY_API_URL: "http://env:1/",
      CLAUDE_PLUGIN_OPTION_API_URL: "http://option:2",
      CLAUDE_PLUGIN_OPTION_API_TOKEN: "from-option",
      MEMORY_HOME: "/tmp/am",
      MEMORY_PROJECT: "acme/app",
    };
    expect(loadConfig(env, "/tmp")).toEqual({
      apiUrl: "http://env:1",
      token: "from-option",
      home: "/tmp/am",
      project: "acme/app",
    });
  });

  it("names a project by its git origin, however it's written", () => {
    for (const remote of [
      "git@github.com:acme/app.git",
      "https://github.com/acme/app.git",
      "https://ada@github.com/acme/app",
      "ssh://git@github.com/acme/app.git",
      "https://GitHub.com/acme/app/",
    ])
      expect(normalizeRemote(remote)).toBe("github.com/acme/app");
    expect(normalizeRemote("")).toBeNull();
  });
});

describe("the transcript", () => {
  it("keeps what the user typed and what Claude wrote, and leaves out tool results and meta lines", () => {
    const lines = [
      { type: "user", uuid: "u1", message: { role: "user", content: "Use pnpm." } },
      { type: "user", uuid: "u2", message: { role: "user", content: [{ type: "tool_result", content: "SECRET=1" }] } },
      { type: "user", isMeta: true, message: { role: "user", content: "<command-name>/clear</command-name>" } },
      {
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "OK." },
            { type: "tool_use", name: "Bash" },
          ],
        },
      },
      { type: "summary", summary: "x" },
    ];
    const jsonl = `${lines.map((l) => JSON.stringify(l)).join("\n")}\nnot json\n`;
    expect(parseTranscript(jsonl)).toEqual([
      { role: "user", text: "Use pnpm.", id: "u1" },
      { role: "assistant", text: "OK.", id: "a1" },
    ]);
  });
});

describe("ulid", () => {
  it("increases within one millisecond and across them", () => {
    const ids = [ulid(1000), ulid(1000), ulid(1000), ulid(2000), ulid(1500)];
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every((id) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toBe(true);
  });
});
