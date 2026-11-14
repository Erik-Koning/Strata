import { redact } from "./redact.mjs";
import { stripTags } from "./tags.mjs";

// The one shape that leaves the machine. Everything is plain words: no code, no raw
// prompts or replies. The summarizer is told this; this file enforces it no matter what
// the model (or an engineer's edit) produced.
const TEXT = { title: 100, built: 500, why: 300 };
const LISTS = {
  decisions: [5, 160],
  areas: [8, 80],
  open: [5, 160],
  insights: [5, 200],
  workflow: [5, 200],
  painPoints: [5, 200],
  gaps: [5, 200],
};
export const EMPTY_SUMMARY = {
  title: "",
  built: "",
  why: "",
  decisions: [],
  areas: [],
  open: [],
  insights: [],
  workflow: [],
  painPoints: [],
  gaps: [],
};
// Findings an agent or engineer can log live, mapped to the summary list that holds them.
export const FINDING_KINDS = { insight: "insights", workflow: "workflow", "pain-point": "painPoints", gap: "gaps" };

const CODE_FENCE = /```[\s\S]*?(?:```|$)/g;
const LONG_INLINE_CODE = /`[^`\n]{30,}`/g;

function clean(value, max) {
  const text = stripTags(String(value ?? ""))
    .replace(CODE_FENCE, " ")
    .replace(LONG_INLINE_CODE, " ");
  return redact(text, 20_000).replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value, [count, max]) {
  const items = Array.isArray(value) ? value : String(value ?? "").split("\n");
  return items
    .map((item) => clean(item, max))
    .filter(Boolean)
    .slice(0, count);
}

export function sanitizeSummary(input = {}) {
  const out = {};
  for (const [key, max] of Object.entries(TEXT)) out[key] = clean(input[key], max);
  for (const [key, spec] of Object.entries(LISTS)) out[key] = cleanList(input[key], spec);
  return out;
}

export const isEmptySummary = (summary) => !summary.title && !summary.built;
