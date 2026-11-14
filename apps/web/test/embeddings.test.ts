// The real embedding providers, against a mocked fetch: what they send, what they accept back, and how they fail. No
// network, no real key (the key below is a placeholder that only has to be non-empty).
import { afterEach, describe, expect, it } from "vitest";
import {
  embeddingModelId,
  OPENAI_URL,
  openaiProvider,
  provider,
  VOYAGE_URL,
  voyageProvider,
} from "../server/ai/provider.ts";
import { resetConfig } from "../server/config.ts";

const KEY = "placeholder-not-a-key";

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

// A fetch that answers each request with vectors of `dims`, or with the responses given, in turn.
function mockFetch(dims: number, responses: (() => Response)[] = []) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    const next = responses.shift();
    if (next) return next();
    const input = body.input as string[];
    return Response.json({
      data: input.map((_, index) => ({ object: "embedding", index, embedding: new Array(dims).fill(0.01 * index) })),
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("voyage", () => {
  it("sends the model, 1024 dimensions and the input type: document for memories, query for recall", async () => {
    const { fetcher, calls } = mockFetch(1024);
    const p = voyageProvider({ key: KEY, fetch: fetcher });
    expect(p).toMatchObject({ name: "voyage", model: "voyage-3.5", dimensions: 1024, semantic: true });
    expect(embeddingModelId(p)).toBe("voyage:voyage-3.5:1024");

    const docs = await p.embed(["a", "b"], { purpose: "document" });
    expect(docs).toHaveLength(2);
    expect(docs[0]).toHaveLength(1024);
    await p.embed(["what about a?"], { purpose: "query" });
    await p.embed(["no purpose given"]);

    expect(calls[0]?.url).toBe(VOYAGE_URL);
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(calls[0]?.body).toEqual({
      input: ["a", "b"],
      model: "voyage-3.5",
      input_type: "document",
      output_dimension: 1024,
      output_dtype: "float",
    });
    expect(calls[1]?.body.input_type).toBe("query");
    expect(calls[2]?.body.input_type).toBe("document");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("batches large inputs and keeps the order the API's indexes give", async () => {
    const { fetcher, calls } = mockFetch(8);
    const p = voyageProvider({ key: KEY, dimensions: 8, fetch: fetcher });
    const out = await p.embed(Array.from({ length: 300 }, (_, i) => `t${i}`));
    expect(calls.map((c) => (c.body.input as string[]).length)).toEqual([128, 128, 44]);
    expect(out).toHaveLength(300);
    expect(out[1]?.[0]).toBeCloseTo(0.01);

    const reversed = mockFetch(2, [
      () =>
        Response.json({
          data: [
            { index: 1, embedding: [1, 1] },
            { index: 0, embedding: [0, 0] },
          ],
        }),
    ]);
    const [first, second] = await voyageProvider({ key: KEY, dimensions: 2, fetch: reversed.fetcher }).embed([
      "x",
      "y",
    ]);
    expect(first).toEqual([0, 0]);
    expect(second).toEqual([1, 1]);
  });

  it("refuses vectors of the wrong size, and says which setting to check on a bad key, without the key", async () => {
    const wrong = mockFetch(512);
    await expect(voyageProvider({ key: KEY, fetch: wrong.fetcher }).embed(["x"])).rejects.toThrow(
      "an embedding of 512 dimensions, expected 1024",
    );
    const denied = mockFetch(1024, [() => new Response(`{"detail":"bad key ${KEY}"}`, { status: 401 })]);
    const error = await voyageProvider({ key: KEY, fetch: denied.fetcher })
      .embed(["x"])
      .catch((e: Error) => e);
    expect(String(error)).toContain("HTTP 401 (check VOYAGE_API_KEY)");
    expect(String(error)).not.toContain(KEY);
  });

  it("retries a rate limit for documents, but not for a recall query", async () => {
    const limited = () => new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } });
    const doc = mockFetch(4, [limited]);
    expect(await voyageProvider({ key: KEY, dimensions: 4, fetch: doc.fetcher }).embed(["x"])).toHaveLength(1);
    expect(doc.calls).toHaveLength(2);
    const query = mockFetch(4, [limited]);
    await expect(
      voyageProvider({ key: KEY, dimensions: 4, fetch: query.fetcher }).embed(["x"], { purpose: "query" }),
    ).rejects.toThrow("HTTP 429 (rate limited)");
    expect(query.calls).toHaveLength(1);
  });

  it("gives up on a request that hangs past its timeout", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      )) as unknown as typeof fetch;
    await expect(
      voyageProvider({ key: KEY, timeoutMs: 50, fetch: hang }).embed(["x"], { purpose: "query" }),
    ).rejects.toThrow("no answer within 50 ms");
  });

  it("needs its key", () => {
    expect(() => voyageProvider({ key: null })).toThrow("needs VOYAGE_API_KEY");
  });
});

describe("openai", () => {
  it("sends text-embedding-3-small and expects 1536 dimensions; sends `dimensions` only when asked", async () => {
    const { fetcher, calls } = mockFetch(1536);
    const p = openaiProvider({ key: KEY, fetch: fetcher });
    expect(embeddingModelId(p)).toBe("openai:text-embedding-3-small:1536");
    expect((await p.embed(["a"], { purpose: "query" }))[0]).toHaveLength(1536);
    expect(calls[0]?.url).toBe(OPENAI_URL);
    expect(calls[0]?.body).toEqual({ input: ["a"], model: "text-embedding-3-small", encoding_format: "float" });

    const small = mockFetch(512);
    await openaiProvider({ key: KEY, dimensions: 512, fetch: small.fetcher }).embed(["a"]);
    expect(small.calls[0]?.body.dimensions).toBe(512);
  });

  it("needs its key", () => {
    expect(() => openaiProvider({ key: null })).toThrow("needs OPENAI_API_KEY");
  });
});

describe("choosing a provider", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetConfig();
  });
  const use = (env: Record<string, string>) => {
    process.env = { ...saved, MONGODB_URI: "mongodb://localhost/x", ...env };
    delete process.env.VOYAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, env);
    resetConfig();
  };

  it("is the stub by default, and says it isn't semantic", () => {
    use({});
    delete process.env.MEMORY_AI_PROVIDER;
    resetConfig();
    expect(provider()).toMatchObject({ name: "stub", dimensions: 256, semantic: false, summarizer: "extractive-stub" });
  });

  it("reads the model and dimensions from the environment", () => {
    use({
      MEMORY_AI_PROVIDER: "voyage",
      VOYAGE_API_KEY: KEY,
      MEMORY_EMBED_MODEL: "voyage-3.5-lite",
      MEMORY_EMBED_DIMENSIONS: "512",
    });
    expect(embeddingModelId(provider())).toBe("voyage:voyage-3.5-lite:512");
    use({ MEMORY_AI_PROVIDER: "openai", OPENAI_API_KEY: KEY });
    expect(embeddingModelId(provider())).toBe("openai:text-embedding-3-small:1536");
  });

  it("fails clearly without a key for a real embeddings provider", () => {
    use({ MEMORY_AI_PROVIDER: "voyage" });
    expect(() => provider()).toThrow("needs VOYAGE_API_KEY");
    use({ MEMORY_AI_PROVIDER: "openai" });
    expect(() => provider()).toThrow("needs OPENAI_API_KEY");
  });

  it("anthropic writes text and embeds with the stub, under the stub's model id", () => {
    use({ MEMORY_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: KEY });
    const p = provider();
    expect(p).toMatchObject({ name: "anthropic", dimensions: 256, semantic: false });
    // Memories stored under the stub stay findable after switching to anthropic: same vectors, same id.
    expect(embeddingModelId(p)).toBe("stub:fnv1a-hash:256");
    use({ MEMORY_AI_PROVIDER: "anthropic" });
    expect(provider().name).toBe("stub");
  });
});
