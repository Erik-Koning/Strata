// The first job of the pipeline (extract > dedupe > embed > summarize > score > policy), in its simplest form: a
// sentence where someone states a preference, a convention, a decision or a fact to remember becomes a memory.
// What the user said in their own turn becomes active at once; anything else (the assistant's words, a tool's output, a
// transcript) is only a candidate, which a person or a later job promotes. The rule is the brief's: only user-turn
// content auto-promotes to active.
import type { MemoryKind, MemoryStatus } from "@strata/contracts";

export interface Extracted {
  text: string;
  kind: MemoryKind;
  confidence: number;
}

const CUES: { kind: MemoryKind; re: RegExp; confidence: number }[] = [
  { kind: "fact", re: /\b(?:remember|note|keep in mind|don't forget)\b(?:\s+that)?/i, confidence: 0.85 },
  { kind: "decision", re: /\b(?:we (?:decided|agreed|chose)|let'?s go with|the decision is)\b/i, confidence: 0.75 },
  { kind: "preference", re: /\bI (?:prefer|like|want|love|hate|dislike|don'?t (?:like|want))\b/i, confidence: 0.7 },
  {
    kind: "convention",
    re: /\b(?:always|never|from now on|going forward|by default|in this (?:repo|project|codebase))\b/i,
    confidence: 0.65,
  },
];

// Sentences, roughly: a stop, a question or exclamation mark, or a new line.
const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 400);

export function extract(text: string): Extracted[] {
  const found: Extracted[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences(text)) {
    if (/^(?:[-*>]|\d+\.)\s|```|^\s*\/\//.test(sentence) || sentence.endsWith("?")) continue;
    const cue = CUES.find((c) => c.re.test(sentence));
    if (!cue) continue;
    const text = clean(sentence);
    const key = normalize(text);
    if (text.length < 8 || seen.has(key)) continue;
    seen.add(key);
    found.push({ text, kind: cue.kind, confidence: cue.confidence });
  }
  return found.slice(0, 5);
}

// The memory without the request around it: "Please remember that we use pnpm" keeps "We use pnpm".
const LEAD_IN =
  /^(?:(?:please|pls|also|and|ok(?:ay)?|so)[,:\s]+)*(?:remember|note|keep in mind|don'?t forget)(?:\s+that)?[:,\s]+/i;

function clean(sentence: string): string {
  const stripped = sentence.replace(LEAD_IN, "").trim();
  return stripped ? stripped[0]!.toUpperCase() + stripped.slice(1) : sentence;
}

export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim();

export function statusFor(role: string | undefined, kind: string): MemoryStatus {
  return kind === "prompt" && role === "user" ? "active" : "candidate";
}
