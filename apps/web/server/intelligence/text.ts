// Reading a question and ranking records against it. Pure: no database, no model, the same answer every time, so the
// tests can pin it down. Ranking is BM25 over the person's own records; a question's wording picks an intent (what's
// blocking, what changed, why…) and a time window, which decide which kinds of record lead.
import { words } from "../ai/provider.ts";
import type { IntentName } from "./types.ts";

// Question words that carry no topic. Intent words are taken out separately, below.
const QUESTION_WORDS = new Set(
  (
    "what whats what's which who whom whose when where how why does did done do doing can could should would " +
    "there any anything something about tell show give list explain know we us team our their they them " +
    "currently current right now been being get got please also just still again into across yet need needs " +
    "implement implemented use used using work working make made way thing things stuff that those these i'm im"
  ).split(" "),
);

export interface IntentRule {
  name: IntentName;
  label: string;
  // Words that signal it, stemmed. They're dropped from the topic terms…
  cues: string[];
  // …except these, which can also be the topic ("what changed in the build?"): kept unless they're all there is.
  soft?: string[];
  // The record categories that answer it, most direct first.
  categories: string[];
}

export const INTENTS: IntentRule[] = [
  {
    name: "blockers",
    label: "Blockers and pain points",
    cues: ["block", "stuck", "pain", "problem", "issu", "broken", "fail", "slow", "friction", "risk"],
    soft: ["broken", "fail", "slow", "risk"],
    categories: ["pain_point", "context_gap"],
  },
  {
    name: "unfinished",
    label: "Unfinished work and open gaps",
    cues: ["unfinish", "open", "todo", "remain", "left", "pend", "incomplet", "outstand", "unresolv"],
    soft: ["open"],
    categories: ["context_gap", "pain_point"],
  },
  {
    name: "why",
    label: "Decisions and their reasons",
    cues: ["why", "reason", "decid", "decision", "approach", "chos", "rational", "tradeoff"],
    categories: ["decision", "insight", "convention"],
  },
  {
    name: "discoveries",
    label: "Discoveries and insights",
    cues: ["discover", "learn", "learnt", "found", "insight", "find", "realiz", "surpris"],
    categories: ["insight", "workflow", "fact"],
  },
  {
    name: "setup",
    label: "Setup and how-to",
    cues: ["setup", "set", "install", "run", "start", "config", "deploy", "build", "local", "onboard"],
    soft: ["install", "config", "deploy", "build", "local"],
    categories: ["workflow", "convention", "preference", "fact"],
  },
  {
    name: "changes",
    label: "Recent changes",
    cues: ["chang", "recent", "recently", "new", "updat", "latest", "happen", "ship", "modifi"],
    soft: ["new"],
    categories: ["decision", "summary", "insight", "fact"],
  },
];

const WINDOWS: { pattern: RegExp; days: number; label: string }[] = [
  { pattern: /\btoday\b/i, days: 1, label: "today" },
  { pattern: /\byesterday\b/i, days: 2, label: "since yesterday" },
  { pattern: /\b(this|last|past) week\b/i, days: 7, label: "the last 7 days" },
  { pattern: /\b(this|last|past) month\b/i, days: 30, label: "the last 30 days" },
  { pattern: /\b(recent|recently|lately|latest)\b/i, days: 14, label: "the last 14 days" },
];
const WINDOW_WORDS = new Set([
  "today",
  "yesterday",
  "week",
  "month",
  "recent",
  "recently",
  "lately",
  "latest",
  "last",
  "past",
  "this",
]);

// The same thing under its usual names, after stemming.
const CANONICAL: Record<string, string> = {
  authentic: "auth",
  authn: "auth",
  repositori: "repo",
  configur: "config",
  environment: "env",
  databas: "db",
  kubernet: "k8s",
  dependenci: "dep",
  depend: "dep",
};

// A crude, predictable stem: enough that "blocking", "blocked" and "blocks" meet, and "services" finds "service".
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 5 && w.endsWith("ies")) w = `${w.slice(0, -3)}i`;
  else
    for (const suffix of ["ations", "ation", "ing", "ers", "ed", "er", "es", "s", "e"]) {
      if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
        w = w.slice(0, -suffix.length);
        // running > runn > run; but billing stays bill, and pass stays pass.
        if (["ing", "ed", "er", "ers"].includes(suffix) && /([^aeiouls])\1$/.test(w)) w = w.slice(0, -1);
        break;
      }
    }
  return CANONICAL[w] ?? w;
}

export const tokens = (text: string): string[] =>
  words(text.replace(/[/_]/g, " "))
    .map((w) => stem(w.replace(/[.+#-]+$/, "")))
    .filter((w) => w.length > 1);

export interface Reading {
  intent: IntentRule | null;
  // The topic, stemmed: what a record has to be about. Empty for a question that's only an intent ("what's blocked?").
  terms: string[];
  // The topic as the person wrote it, for saying what wasn't found.
  display: string[];
  windowDays: number | null;
  windowLabel: string | null;
}

const isCue = (cues: string[] | undefined, s: string) => Boolean(cues?.some((c) => s === c || s === stem(c)));

export function readQuestion(question: string): Reading {
  const window = WINDOWS.find((w) => w.pattern.test(question)) ?? null;
  const raw = words(question.replace(/[/_]/g, " "));
  let intent: IntentRule | null = null;
  const terms: string[] = [];
  const display: string[] = [];
  const soft = new Set<string>();
  for (const word of raw) {
    if (QUESTION_WORDS.has(word) || WINDOW_WORDS.has(word)) continue;
    const s = stem(word.replace(/[.+#-]+$/, ""));
    const cued = INTENTS.find((i) => isCue(i.cues, s));
    if (cued) {
      // The first cue decides: "how do I get the build running" is setup, "what changed in the build" is changes.
      intent ??= cued;
      if (!isCue(cued.soft, s)) continue;
      soft.add(s);
    }
    if (s.length < 2 || terms.includes(s)) continue;
    terms.push(s);
    display.push(word);
  }
  // "What's failing?" is a question about blockers, not about the word "fail".
  const topical = terms.some((t) => !soft.has(t));
  return {
    intent,
    terms: topical ? terms : [],
    display: topical ? display : [],
    windowDays: window?.days ?? null,
    windowLabel: window?.label ?? null,
  };
}

export interface Doc {
  id: string;
  text: string;
  // Searched as if it were part of the text: the project, the category.
  extra: string;
}

export interface Scored {
  id: string;
  score: number;
  // The share of the question's topic (weighted by how rare each term is) the record covers.
  coverage: number;
  matched: string[];
}

// BM25 over the docs. A record counts as relevant when it covers at least half the topic's weight: "billing service"
// doesn't match a record that only says "service".
export function rank(docs: Doc[], terms: string[], { minCoverage = 0.5 } = {}): Scored[] {
  if (!terms.length || !docs.length) return [];
  const k1 = 1.2;
  const b = 0.75;
  const tokenized = docs.map((d) => tokens(`${d.text} ${d.extra}`));
  const avg = tokenized.reduce((n, t) => n + t.length, 0) / tokenized.length || 1;
  const df = new Map<string, number>();
  for (const t of tokenized) for (const term of new Set(t)) df.set(term, (df.get(term) ?? 0) + 1);
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
  };
  // A term no record has weighs the most of all, so asking about "billing" when nothing mentions billing isn't
  // answered with whatever matches the rest of the question.
  const weight = (term: string) => Math.max(idf(term), 0.01);
  const total = terms.reduce((n, term) => n + weight(term), 0);
  const scored: Scored[] = [];
  tokenized.forEach((t, i) => {
    const tf = new Map<string, number>();
    for (const term of t) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    let covered = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      matched.push(term);
      covered += weight(term);
      score += idf(term) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avg)));
    }
    const coverage = total ? covered / total : 0;
    if (matched.length && coverage >= minCoverage) scored.push({ id: docs[i]!.id, score, coverage, matched });
  });
  return scored.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
}

// A record's words, shortened for a list: whole sentences while they fit, else whole words, then an ellipsis.
export function excerpt(text: string, max = 320): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > max) break;
    out += s;
  }
  if (out.trim().length >= max * 0.5) return out.trim();
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).trim()}…`;
}
