import { afterEach, describe, expect, it } from "vitest";
import {
  ANTHROPIC_MODEL,
  type AnswerSource,
  anthropicProvider,
  citedAnswer,
  type DraftContext,
  provider,
  STUB_DIMENSIONS,
  stubAnswer,
  stubDraft,
  stubEmbed,
  stubSummarize,
} from "../server/ai/provider.ts";
import { resetConfig } from "../server/config.ts";

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

const SOURCES: AnswerSource[] = [
  {
    id: "r1",
    title: "Invoice retries",
    text: "Invoices retry three times with backoff. The ledger rounds per line, never per invoice.",
  },
  { id: "r2", title: "Releasing", text: "Run pnpm release from main after the tests pass. Tag the commit first." },
  { id: "r3", title: "Staging", text: "The staging database password rotates monthly." },
];

describe("the stub's answers", () => {
  it("quotes the sentences that match, each cited by its source's number", () => {
    const answer = stubAnswer("How does the ledger round invoices?", SOURCES);
    expect(answer?.text).toContain("The ledger rounds per line, never per invoice [1].");
    expect(answer?.cited).toEqual(["r1"]);
  });

  it("cites more than one source when more than one matches", () => {
    const answer = stubAnswer("release tests pnpm and staging database password", SOURCES);
    expect(answer?.text).toMatch(/\[2\]/);
    expect(answer?.text).toMatch(/\[3\]/);
    expect(answer?.cited.sort()).toEqual(["r2", "r3"]);
  });

  it("gives null when nothing is relevant, or there is nothing to answer from", () => {
    expect(stubAnswer("Who owns the mobile app's push notifications?", SOURCES)).toBeNull();
    expect(stubAnswer("How does the ledger round?", [])).toBeNull();
    expect(stubAnswer("how what why", SOURCES)).toBeNull();
  });
});

describe("citations", () => {
  it("keeps citations that point at a source, drops the rest, and lists what is cited in order", () => {
    expect(citedAnswer("Three retries [1][9]. Tag first [2]. Lines [1].", SOURCES)).toEqual({
      text: "Three retries [1]. Tag first [2]. Lines [1].",
      cited: ["r1", "r2"],
    });
  });

  it("treats an answer that cites nothing as no answer", () => {
    expect(citedAnswer("It retries three times.", SOURCES)).toBeNull();
    expect(citedAnswer("It retries [7].", SOURCES)).toBeNull();
  });
});

// ---------- Anthropic, with a fake fetch: no network ----------

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(reply: unknown, status = 200) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const message = (text: string, stop = "end_turn") => ({
  type: "message",
  role: "assistant",
  stop_reason: stop,
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text },
  ],
});

const quiet = () => {};

const CONTEXT: DraftContext = {
  sessionID: "s1",
  project: "github.com/acme/shop",
  prompts: ["Fix the invoice retry. Note that the ledger rounds per line."],
  replies: ["Fixed it. Run pnpm test first."],
  compactSummary: null,
  tools: [{ tool: "Bash", status: "error", command: { class: "test", exit: 1 } }],
  refs: [{ type: "ticket", id: "PAY-412" }],
};

describe("the Anthropic provider", () => {
  it("asks the Messages API with the key, the API version and the default model", async () => {
    const { fetch, calls } = fakeFetch(message("The engineer fixed the retry."));
    const p = anthropicProvider({ apiKey: "test-key", fetch, log: quiet });
    expect(await p.summarize([{ role: "user", text: "Fix the retry" }])).toBe("The engineer fixed the retry.");
    const [call] = calls;
    expect(call?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call?.headers["x-api-key"]).toBe("test-key");
    expect(call?.headers["anthropic-version"]).toBe("2026-10-21");
    expect(call?.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(call?.body.model).toBe(ANTHROPIC_MODEL);
    expect(call?.body.fallbacks).toBe("default");
    expect(call?.body.output_config).toEqual({ effort: "low" });
    expect(call?.body).not.toHaveProperty("temperature");
    expect(call?.body).not.toHaveProperty("thinking");
    expect(JSON.stringify(call?.body.messages)).toContain("Fix the retry");
  });

  it("uses MEMORY_AI_MODEL's model, without settings an older model would refuse", async () => {
    const { fetch, calls } = fakeFetch(message("ok"));
    await anthropicProvider({ apiKey: "k", model: "claude-haiku-4-5", fetch, log: quiet }).summarize([
      { role: "user", text: "hi" },
    ]);
    expect(calls[0]?.body.model).toBe("claude-haiku-4-5");
    expect(calls[0]?.body).not.toHaveProperty("output_config");
    expect(calls[0]?.body).not.toHaveProperty("fallbacks");
    expect(calls[0]?.headers).not.toHaveProperty("anthropic-beta");
  });

  it("keeps embeddings on the stub, so the vector index keeps its dimensions", async () => {
    const { fetch, calls } = fakeFetch(message("unused"));
    const p = anthropicProvider({ apiKey: "k", fetch, log: quiet });
    expect(p.dimensions).toBe(STUB_DIMENSIONS);
    expect(await p.embed(["pnpm, never npm"])).toEqual([stubEmbed("pnpm, never npm")]);
    expect(calls).toHaveLength(0);
  });

  it("drafts records from structured output, with the session's refs", async () => {
    const { fetch, calls } = fakeFetch(
      message(
        JSON.stringify({
          records: [
            { kind: "summary", title: "Invoice retry fixed", text: "Fixed the invoice retry." },
            { kind: "insight", title: "", text: "The ledger rounds per line." },
            { kind: "rumour", title: "", text: "Not a kind we keep." },
            { kind: "workflow", title: "", text: "   " },
          ],
        }),
      ),
    );
    const drafts = await anthropicProvider({ apiKey: "k", fetch, log: quiet }).draftRecords(CONTEXT);
    expect(drafts).toEqual([
      { kind: "summary", title: "Invoice retry fixed", text: "Fixed the invoice retry.", refs: CONTEXT.refs },
      { kind: "insight", text: "The ledger rounds per line.", refs: CONTEXT.refs },
    ]);
    const output = calls[0]?.body.output_config as { format?: { type: string } } | undefined;
    expect(output?.format?.type).toBe("json_schema");
    const sent = JSON.stringify(calls[0]?.body.messages);
    expect(sent).toContain("engineer: Fix the invoice retry");
    expect(sent).toContain("test: 1 run(s), 1 failed");
  });

  it("falls back to the stub's drafts when the call fails or the output isn't usable", async () => {
    for (const { fetch } of [
      fakeFetch({ type: "error", error: { type: "overloaded_error" } }, 529),
      fakeFetch(message("not json")),
      fakeFetch(message('{"records": [', "max_tokens")),
    ]) {
      expect(await anthropicProvider({ apiKey: "k", fetch, log: quiet }).draftRecords(CONTEXT)).toEqual(
        stubDraft(CONTEXT),
      );
    }
  });

  it("falls back to the stub's summary when the call fails", async () => {
    const { fetch } = fakeFetch("<html>bad gateway</html>", 502);
    const messages = [
      { role: "user", text: "Add sign in" },
      { role: "assistant", text: "Added it." },
    ];
    expect(await anthropicProvider({ apiKey: "k", fetch, log: quiet }).summarize(messages)).toBe(
      stubSummarize(messages),
    );
  });

  it("answers from the sources only, cited, and sends them as numbered data", async () => {
    const { fetch, calls } = fakeFetch(
      message(JSON.stringify({ answered: true, answer: "Per line, not per invoice [1]. Releases are tagged [2][5]." })),
    );
    const answer = await anthropicProvider({ apiKey: "k", fetch, log: quiet }).answer(
      "How does the ledger round?",
      SOURCES,
    );
    expect(answer).toEqual({ text: "Per line, not per invoice [1]. Releases are tagged [2].", cited: ["r1", "r2"] });
    const sent = JSON.stringify(calls[0]?.body.messages);
    expect(sent).toContain('<source n=\\"1\\" title=\\"Invoice retries\\">');
    expect(sent).toContain("<question>How does the ledger round?</question>");
    expect(String(calls[0]?.body.system)).toMatch(/only/);
  });

  it("gives null, never an error, when there's no answer", async () => {
    const cases = [
      fakeFetch(message(JSON.stringify({ answered: false, answer: "" }))),
      fakeFetch(message(JSON.stringify({ answered: true, answer: "Uncited claim." }))),
      fakeFetch({ ...message(""), content: [], stop_reason: "refusal" }),
      fakeFetch({ type: "error", error: { type: "authentication_error" } }, 401),
    ];
    for (const { fetch } of cases) {
      expect(await anthropicProvider({ apiKey: "k", fetch, log: quiet }).answer("How?", SOURCES)).toBeNull();
    }
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    expect(await anthropicProvider({ apiKey: "k", fetch: offline, log: quiet }).answer("How?", SOURCES)).toBeNull();
    const { fetch, calls } = fakeFetch(message("unused"));
    expect(await anthropicProvider({ apiKey: "k", fetch, log: quiet }).answer("How?", [])).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("gives up at its time limit", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof globalThis.fetch;
    const logged: string[] = [];
    const p = anthropicProvider({
      apiKey: "k",
      fetch: hang,
      timeouts: { answer: 20, summarize: 20 },
      log: (m, detail) => logged.push(`${m} ${String(detail.error)}`),
    });
    const started = Date.now();
    expect(await p.answer("How does the ledger round?", SOURCES)).toBeNull();
    expect(await p.summarize([{ role: "user", text: "Add sign in" }])).toBe("The user asked: Add sign in");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(logged[0]).toMatch(/TimeoutError/);
  });
});

describe("choosing the provider", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetConfig();
  });

  it("answers with the stub's excerpts when no model is set", async () => {
    process.env.MONGODB_URI = "mongodb://localhost/unused";
    delete process.env.MEMORY_AI_PROVIDER;
    resetConfig();
    const p = provider();
    expect(p.name).toBe("stub");
    expect(await p.answer("How does the ledger round invoices?", SOURCES)).toEqual(
      stubAnswer("How does the ledger round invoices?", SOURCES),
    );
  });

  it("uses Anthropic when it's chosen and a key is set, and the stub until then", () => {
    process.env.MONGODB_URI = "mongodb://localhost/unused";
    process.env.MEMORY_AI_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    resetConfig();
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(provider().name).toBe("stub");
    } finally {
      console.warn = warn;
    }
    process.env.ANTHROPIC_API_KEY = "test-key";
    resetConfig();
    expect(provider().name).toBe("anthropic");
    expect(provider().dimensions).toBe(STUB_DIMENSIONS);
  });
});
