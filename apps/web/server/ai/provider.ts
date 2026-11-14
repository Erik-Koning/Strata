// Embeddings, summaries and record drafts, behind one interface chosen by MEMORY_AI_PROVIDER. `stub` is the default
// everywhere the team runs: deterministic (the same text always gives the same result), offline, and good enough to
// prove the pipeline. Real providers plug in here with their own key names, which stay in the operator's environment.
import type { DraftRecord, Ref } from "@strata/contracts";
import { config } from "../config.ts";

export interface DraftContext {
  sessionID: string;
  project: string;
  prompts: string[];
  replies: string[];
  compactSummary: string | null;
  tools: { tool: string; status: string; command?: { class?: string; exit?: number } }[];
  refs: Ref[];
}

export interface Provider {
  name: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
  summarize(messages: { role: string; text: string }[]): Promise<string | null>;
  // The records a session should become, before the server stores them as drafts.
  draftRecords(context: DraftContext): Promise<DraftRecord[]>;
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

const clean = (text: string, max = 400): string => text.replace(/\s+/g, " ").trim().slice(0, max);

const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => clean(sentence, 400))
    .filter((sentence) => sentence.length >= 12);

// A deterministic draft, so the pipeline and its tests do not need a model. A real provider replaces this.
export function stubDraft(context: DraftContext): DraftRecord[] {
  const records: DraftRecord[] = [];
  const seen = new Set<string>();
  const add = (record: DraftRecord): void => {
    const text = clean(record.text);
    if (!text) return;
    const key = `${record.kind}:${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push({ ...record, text });
  };

  const firstPrompt = context.prompts.find((prompt) => prompt.trim());
  const lastReply = [...context.replies].reverse().find((reply) => reply.trim());
  const summaryText = lastReply ? clean(lastReply, 1500) : firstPrompt ? clean(firstPrompt, 1500) : "";
  if (summaryText) {
    add({
      kind: "summary",
      title: clean(firstPrompt ?? "Session summary", 100) || undefined,
      text: summaryText,
      refs: context.refs,
    });
  }

  for (const text of [...context.prompts, ...context.replies]) {
    for (const sentence of sentences(text)) {
      if (/\b(?:note that|because|the reason|rounds? per line|must|never|always)\b/i.test(sentence)) {
        add({ kind: "insight", text: sentence, refs: context.refs });
      }
      if (/\b(?:run|test|install|first|pnpm|npm|setup|release)\b/i.test(sentence)) {
        add({ kind: "workflow", text: sentence, refs: context.refs });
      }
      if (/\b(?:couldn'?t find|no docs?|not documented|unclear|no record)\b/i.test(sentence)) {
        add({ kind: "context_gap", text: sentence, refs: context.refs });
      }
    }
  }

  const failed = context.tools.filter((tool) => tool.status === "error");
  if (failed.length) {
    const byClass = new Map<string, number>();
    for (const tool of failed) {
      const label = tool.command?.class && tool.command.class !== "other" ? tool.command.class : tool.tool;
      byClass.set(label, (byClass.get(label) ?? 0) + 1);
    }
    for (const [label, count] of byClass) {
      add({
        kind: "pain_point",
        text: `${label} failed ${count} time${count === 1 ? "" : "s"} during this session.`,
        refs: context.refs,
      });
    }
  }

  if (context.compactSummary) {
    add({
      kind: "summary",
      title: "Compaction summary",
      text: clean(context.compactSummary, 1500),
      refs: context.refs,
    });
  }

  return records;
}

const stub: Provider = {
  name: "stub",
  dimensions: STUB_DIMENSIONS,
  embed: async (texts) => texts.map((t) => stubEmbed(t)),
  summarize: async (messages) => stubSummarize(messages),
  draftRecords: async (context) => stubDraft(context),
};

export function provider(): Provider {
  const chosen = config().aiProvider;
  if (chosen === "stub") return stub;
  // The real providers are the team's to add (brief: OpenAI embeddings, Anthropic for compress and drafts).
  throw new Error(`MEMORY_AI_PROVIDER=${chosen} isn't implemented yet; use stub`);
}
