// Embeddings and summaries, behind one interface chosen by MEMORY_AI_PROVIDER. `stub` is the default everywhere the
// team runs: deterministic (the same text always gives the same vector) and offline, but its vectors are hashed words,
// so its "vector search" is lexical, never semantic. `voyage` (Voyage AI, the default for real use) and `openai` are
// real embedding models; their keys stay in the operator's environment and are read by name only.
// Summaries are extractive for every provider for now (`summarizer` says so).
import { config } from "../config.ts";
import { batches, postEmbeddings } from "./http.ts";

// A stored memory is a "document"; the text a recall searches with is a "query". Voyage embeds the two differently.
export type EmbedPurpose = "document" | "query";
export interface EmbedOptions {
  purpose?: EmbedPurpose;
}

export interface Provider {
  name: string;
  model: string;
  dimensions: number;
  // Whether nearness means meaning: false for the stub, whose vectors only share words.
  semantic: boolean;
  // How summarize works: "extractive-stub" means it picks sentences, no model.
  summarizer: string;
  embed(texts: string[], options?: EmbedOptions): Promise<number[][]>;
  summarize(messages: { role: string; text: string }[]): Promise<string | null>;
}

// What every memory is stamped with, and recall filters on, so vectors from two models are never compared.
export const embeddingModelId = (p: Pick<Provider, "name" | "model" | "dimensions">): string =>
  `${p.name}:${p.model}:${p.dimensions}`;

export const STUB_DIMENSIONS = 256;

const STOP = new Set(
  "a an and are as at be but by do for from has have i in is it its me my of on or our so that the this to was we were will with you your".split(
    " ",
  ),
);

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9_.+#-]*/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

// FNV-1a, 32 bits.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Each word and each pair of neighbouring words lands in one dimension with a sign; then the vector is made unit length.
export function stubEmbed(text: string, dimensions = STUB_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const ws = words(text);
  const terms = [...ws, ...ws.slice(1).map((w, i) => `${ws[i]} ${w}`)];
  for (const term of terms) {
    const h = hash(term);
    const slot = h % dimensions;
    vector[slot] = (vector[slot] ?? 0) + ((h >>> 31) & 1 ? -1 : 1) * (term.includes(" ") ? 0.5 : 1);
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => Number((v / norm).toFixed(6)));
}

// Extractive: what the user asked for, in their first words, and where the conversation ended up.
export function stubSummarize(messages: { role: string; text: string }[]): string | null {
  const said = (m: { text: string }) => m.text.replace(/\s+/g, " ").trim();
  const asks = messages.filter((m) => m.role === "user" && said(m)).map((m) => said(m).slice(0, 160));
  const last = [...messages].reverse().find((m) => m.role === "assistant" && said(m));
  if (!asks.length && !last) return null;
  const parts = [];
  if (asks.length) parts.push(`The user asked: ${asks.slice(0, 6).join(" · ")}`);
  if (last) parts.push(`It ended with: ${said(last).slice(0, 300)}`);
  return parts.join("\n");
}

export const STUB_MODEL = "fnv1a-hash";

const stub: Provider = {
  name: "stub",
  model: STUB_MODEL,
  dimensions: STUB_DIMENSIONS,
  semantic: false,
  summarizer: "extractive-stub",
  embed: async (texts) => texts.map((t) => stubEmbed(t)),
  summarize: async (messages) => stubSummarize(messages),
};

export const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_DEFAULT_MODEL = "voyage-3.5";
export const VOYAGE_DEFAULT_DIMENSIONS = 1024;
// voyage-3.5 takes up to 1000 texts a request; smaller batches keep each under its token limit too.
const VOYAGE_BATCH = 128;

export const OPENAI_URL = "https://api.openai.com/v1/embeddings";
export const OPENAI_DEFAULT_MODEL = "text-embedding-3-small";
export const OPENAI_DEFAULT_DIMENSIONS = 1536;
const OPENAI_BATCH = 256;

// A recall has 800 ms on the client: a query embedding gets a short timeout and no retry, a stored memory gets more.
const QUERY_TIMEOUT_MS = 3000;

interface RealOptions {
  key: string | null;
  model?: string | null;
  dimensions?: number | null;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const extractive = (messages: { role: string; text: string }[]) => Promise.resolve(stubSummarize(messages));

export function voyageProvider(options: RealOptions): Provider {
  const key = options.key;
  if (!key) throw new Error("MEMORY_AI_PROVIDER=voyage needs VOYAGE_API_KEY in the environment");
  const model = options.model ?? VOYAGE_DEFAULT_MODEL;
  const dimensions = options.dimensions ?? VOYAGE_DEFAULT_DIMENSIONS;
  const timeoutMs = options.timeoutMs ?? 15_000;
  return {
    name: "voyage",
    model,
    dimensions,
    semantic: true,
    summarizer: "extractive-stub",
    async embed(texts, { purpose = "document" } = {}) {
      const out: number[][] = [];
      for (const batch of batches(texts, VOYAGE_BATCH))
        out.push(
          ...(await postEmbeddings(
            {
              label: "Voyage AI embeddings",
              url: VOYAGE_URL,
              keyName: "VOYAGE_API_KEY",
              key,
              body: { input: batch, model, input_type: purpose, output_dimension: dimensions, output_dtype: "float" },
              timeoutMs: purpose === "query" ? Math.min(timeoutMs, QUERY_TIMEOUT_MS) : timeoutMs,
              retries: purpose === "query" ? 0 : 2,
              dimensions,
              count: batch.length,
            },
            options.fetch,
          )),
        );
      return out;
    },
    summarize: extractive,
  };
}

export function openaiProvider(options: RealOptions): Provider {
  const key = options.key;
  if (!key) throw new Error("MEMORY_AI_PROVIDER=openai needs OPENAI_API_KEY in the environment");
  const model = options.model ?? OPENAI_DEFAULT_MODEL;
  const dimensions = options.dimensions ?? OPENAI_DEFAULT_DIMENSIONS;
  const timeoutMs = options.timeoutMs ?? 15_000;
  return {
    name: "openai",
    model,
    dimensions,
    semantic: true,
    summarizer: "extractive-stub",
    async embed(texts, { purpose = "document" } = {}) {
      const out: number[][] = [];
      for (const batch of batches(texts, OPENAI_BATCH))
        out.push(
          ...(await postEmbeddings(
            {
              label: "OpenAI embeddings",
              url: OPENAI_URL,
              keyName: "OPENAI_API_KEY",
              key,
              // OpenAI has no query/document distinction; `dimensions` is sent only when it isn't the model's own.
              body: {
                input: batch,
                model,
                encoding_format: "float",
                ...(options.dimensions ? { dimensions } : {}),
              },
              timeoutMs: purpose === "query" ? Math.min(timeoutMs, QUERY_TIMEOUT_MS) : timeoutMs,
              retries: purpose === "query" ? 0 : 2,
              dimensions,
              count: batch.length,
            },
            options.fetch,
          )),
        );
      return out;
    },
    summarize: extractive,
  };
}

export function provider(): Provider {
  const c = config();
  switch (c.aiProvider) {
    case "stub":
      return stub;
    case "voyage":
      return voyageProvider({
        key: c.voyageKey,
        model: c.embedModel,
        dimensions: c.embedDimensions,
        timeoutMs: c.embedTimeoutMs,
      });
    case "openai":
      return openaiProvider({
        key: c.openaiKey,
        model: c.embedModel,
        dimensions: c.embedDimensions,
        timeoutMs: c.embedTimeoutMs,
      });
    default:
      throw new Error(
        `MEMORY_AI_PROVIDER=${c.aiProvider} can't embed (Anthropic has no embeddings API); use voyage, openai or stub`,
      );
  }
}
