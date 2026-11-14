// Embeddings and summaries, behind one interface chosen by MEMORY_AI_PROVIDER. `stub` is the default everywhere the
// team runs: deterministic (the same text always gives the same vector), offline, and good enough to prove recall.
// Real providers plug in here with their own key names, which stay in the operator's environment.
import { config } from "../config.ts";

export interface Provider {
  name: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
  summarize(messages: { role: string; text: string }[]): Promise<string | null>;
}

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

const stub: Provider = {
  name: "stub",
  dimensions: STUB_DIMENSIONS,
  embed: async (texts) => texts.map((t) => stubEmbed(t)),
  summarize: async (messages) => stubSummarize(messages),
};

export function provider(): Provider {
  const chosen = config().aiProvider;
  if (chosen === "stub") return stub;
  // The real providers are the team's to add (brief: OpenAI embeddings, Anthropic for compress and extract).
  throw new Error(`MEMORY_AI_PROVIDER=${chosen} isn't implemented yet; use stub`);
}
