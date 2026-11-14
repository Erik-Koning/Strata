import { afterEach, describe, expect, it } from "vitest";
import {
  ANTHROPIC_MODEL,
  type AnswerSource,
  anthropicProvider,
  citedAnswer,
  type DraftContext,
  MAX_ANSWER_SENTENCES,
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

describe("the stub's answers, long and short", () => {
  const LONG: AnswerSource[] = [
    {
      id: "w1",
      title: "First week in billing",
      text: [
        "Billing week one, Monday: clone the billing repo and run pnpm install.",
        "Billing week one, Tuesday: read the ledger ADR before touching invoices.",
        "Billing week one, Wednesday: pair on a retry ticket.",
        "Billing week one, Thursday: ship a small fix behind a flag.",
        "Billing week one, Friday: write down what you couldn't find.",
      ].join(" "),
    },
  ];

  it("quotes three sentences by default, and more for a walk-through", () => {
    const question = "What happens in billing week one?";
    expect(stubAnswer(question, LONG)?.text.match(/\[1\]/g)).toHaveLength(3);
    expect(stubAnswer(question, LONG, { maxSentences: 5 })?.text.match(/\[1\]/g)).toHaveLength(5);
    expect(stubAnswer(question, LONG, { maxSentences: 1 })?.text.match(/\[1\]/g)).toHaveLength(1);
    // Nonsense is ignored rather than trusted.
    expect(stubAnswer(question, LONG, { maxSentences: Number.NaN })?.text.match(/\[1\]/g)).toHaveLength(3);
    expect(stubAnswer(question, LONG, { maxSentences: -4 })?.text.match(/\[1\]/g)).toHaveLength(1);
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

// ---------- Anthropic, through LangChain's ChatAnthropic with a fake fetch: no network ----------

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
      headers: Object.fromEntries(new Headers(init?.headers)),
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
  it("asks the Messages API with the key, the API version and the default model, and no other credential", async () => {
    const { fetch, calls } = fakeFetch(message("The engineer fixed the retry."));
    const p = anthropicProvider({ apiKey: "test-key", fetch, log: quiet });
    expect(await p.summarize([{ role: "user", text: "Fix the retry" }])).toBe("The engineer fixed the retry.");
    const [call] = calls;
    expect(call?.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages(?:\?beta=true)?$/);
    expect(call?.headers["x-api-key"]).toBe("test-key");
    expect(call?.headers).not.toHaveProperty("authorization");
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
      fakeFetch(message(JSON.stringify({ records: [{ kind: "rumour", title: "", text: "Not a kind we keep." }] }))),
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

describe("the Anthropic provider's answers, with why", () => {
  const p = (fetch: typeof globalThis.fetch, timeouts?: { answer: number }) =>
    anthropicProvider({ apiKey: "k", fetch, log: quiet, ...(timeouts ? { timeouts } : {}) });

  it("answers, and says so", async () => {
    const { fetch } = fakeFetch(message(JSON.stringify({ answered: true, answer: "Per line [1]." })));
    expect(await p(fetch).answerWithReason("How does the ledger round?", SOURCES)).toEqual({
      answer: { text: "Per line [1].", cited: ["r1"] },
      reason: "answered",
    });
  });

  it("says there was nothing to answer from, without a call", async () => {
    const { fetch, calls } = fakeFetch(message("unused"));
    expect(await p(fetch).answerWithReason("How does the ledger round?", [])).toEqual({
      answer: null,
      reason: "no_sources",
    });
    expect(calls).toHaveLength(0);
  });

  it("says the sources don't answer it: the model said so, cited nothing, or the question asks nothing", async () => {
    for (const reply of [
      { answered: false, answer: "" },
      { answered: true, answer: "Uncited claim." },
      { answered: true, answer: "A source that isn't there [9]." },
    ]) {
      const { fetch } = fakeFetch(message(JSON.stringify(reply)));
      expect(await p(fetch).answerWithReason("How does the ledger round?", SOURCES), JSON.stringify(reply)).toEqual({
        answer: null,
        reason: "nothing_relevant",
      });
    }
    const { fetch, calls } = fakeFetch(message("unused"));
    expect((await p(fetch).answerWithReason("   ", SOURCES)).reason).toBe("nothing_relevant");
    expect(calls).toHaveLength(0);
  });

  it("says the call failed: an HTTP error, a refusal, a cut-off, output that isn't an answer, no network", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    for (const fetch of [
      fakeFetch({ type: "error", error: { type: "overloaded_error" } }, 529).fetch,
      fakeFetch({ type: "error", error: { type: "authentication_error" } }, 401).fetch,
      fakeFetch("<html>bad gateway</html>", 502).fetch,
      fakeFetch({ ...message(""), content: [], stop_reason: "refusal" }).fetch,
      fakeFetch(message('{"answered": true, "answer": "Per li', "max_tokens")).fetch,
      fakeFetch(message("not json")).fetch,
      fakeFetch(message(JSON.stringify({ answer: "Per line [1]." }))).fetch,
      offline,
    ])
      expect(await p(fetch).answerWithReason("How does the ledger round?", SOURCES)).toEqual({
        answer: null,
        reason: "failed",
      });
  });

  it("says it ran out of time", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof globalThis.fetch;
    expect(await p(hang, { answer: 20 }).answerWithReason("How does the ledger round?", SOURCES)).toEqual({
      answer: null,
      reason: "timeout",
    });
  });

  it("keeps answer() as it was: the answer, or null whatever the reason", async () => {
    const { fetch } = fakeFetch(message(JSON.stringify({ answered: true, answer: "Per line [1]." })));
    expect(await p(fetch).answer("How does the ledger round?", SOURCES)).toEqual({
      text: "Per line [1].",
      cited: ["r1"],
    });
    const failing = fakeFetch({ type: "error", error: { type: "overloaded_error" } }, 529);
    expect(await p(failing.fetch).answer("How does the ledger round?", SOURCES)).toBeNull();
  });

  it("asks for a few sentences by default, and makes room for a walk-through when asked", async () => {
    const reply = message(JSON.stringify({ answered: true, answer: "Clone it first [1]." }));
    const brief = fakeFetch(reply);
    await p(brief.fetch).answerWithReason("How does the ledger round?", SOURCES);
    expect(String(brief.calls[0]?.body.system)).toContain("a few sentences");
    expect(brief.calls[0]?.body.max_tokens).toBe(4_000);

    const short = fakeFetch(reply);
    await p(short.fetch).answer("How does the ledger round?", SOURCES, { maxSentences: 2 });
    expect(String(short.calls[0]?.body.system)).toContain("at most 2 sentences");

    const walk = fakeFetch(reply);
    const outcome = await p(walk.fetch).answerWithReason("I'm new to billing: where do I start?", SOURCES, {
      maxSentences: 15,
    });
    expect(outcome.reason).toBe("answered");
    const system = String(walk.calls[0]?.body.system);
    expect(system).toContain("up to 15 sentences");
    expect(system).not.toContain("a few sentences");
    expect(system).toMatch(/only/);
    expect(walk.calls[0]?.body.max_tokens).toBe(8_000);

    const huge = fakeFetch(reply);
    await p(huge.fetch).answerWithReason("Where do I start?", SOURCES, { maxSentences: 10_000 });
    expect(String(huge.calls[0]?.body.system)).toContain(`up to ${MAX_ANSWER_SENTENCES} sentences`);
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

  it("says why the stub has no answer: nothing to answer from, or nothing relevant", async () => {
    process.env.MONGODB_URI = "mongodb://localhost/unused";
    delete process.env.MEMORY_AI_PROVIDER;
    resetConfig();
    const p = provider();
    expect(await p.answerWithReason("How does the ledger round?", [])).toEqual({ answer: null, reason: "no_sources" });
    expect(await p.answerWithReason("Who owns the mobile app's push notifications?", SOURCES)).toEqual({
      answer: null,
      reason: "nothing_relevant",
    });
    expect(await p.answerWithReason("How does the ledger round invoices?", SOURCES)).toEqual({
      answer: stubAnswer("How does the ledger round invoices?", SOURCES),
      reason: "answered",
    });
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
