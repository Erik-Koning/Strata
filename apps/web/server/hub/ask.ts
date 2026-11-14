// Ask Strata: a question answered only from approved work the asker may see, every claim cited as [n].
//
// What it may read comes from the team read model (team-records.ts), so the privacy rules are the read model's: approved
// work only (a draft, the asker's own included, is never a source), nothing at all for a suspended person. The text
// indexes on records and summary revisions only rank: a hit that isn't in the read model's approved work is ignored.
// Without the indexes (a database db:indexes hasn't reached), matching the question's words does the ranking alone.
//
// Three ways of reading a question:
// - search: the records that best match its words;
// - recent ("what changed this week?"): what was approved in the window, summaries first;
// - onboarding ("I'm new to billing: where do I start?"): a first-week path from the product's newest workflow findings,
//   summaries and insights, and who has worked where (by name, never how much).
//
// Questions aren't stored. One nothing could answer becomes a gap's text (recordAskGap, which keeps no asker).
import { ObjectId } from "mongodb";
import { type Answer, type AnswerSource, citedAnswer, type Provider, provider } from "../ai/provider.ts";
import { DEFAULT_ORG } from "../api-auth.ts";
import { records, summaryRevisions } from "../collections.ts";
import { Refusal } from "../people.ts";
import { recordAskGap } from "./gaps.ts";
import { getProduct, listProducts, type Product } from "./products.ts";
import { reader, type ViewerRef, viewerIdOf } from "./reader.ts";
import { contributorsFor, recordsFor, type TeamRecord, type TeamRecordKind } from "./team-records.ts";
import { DAY_MS } from "./text.ts";

export const QUESTION_MAX = 500;
// How many records an answer is drawn from, and how many of them may come from one session.
export const SOURCE_LIMIT = 8;
const PER_SESSION = 3;
// The newest approved work the question is matched against.
const UNIVERSE = 1000;
const TEXT_HITS = 200;
// The provider gives up on an answer after 30 s and returns null, which looks like "nothing answers". A null that late
// is a timeout, and a question isn't a gap because the model was slow. Past ANSWER_WAIT_MS nobody waits.
const ANSWER_WAIT_MS = 33_000;
const SLOW_AFTER_MS = 29_000;
// Questions per person per hour: each one is a model call.
export const ASK_LIMIT_PER_HOUR = 60;

export const ASK_MODES = ["search", "recent", "onboarding"] as const;
export type AskMode = (typeof ASK_MODES)[number];

export interface AskOptions {
  productId?: string | null;
  // How to read the question; worked out from its words when not given.
  mode?: AskMode | null;
}

export interface AskSource {
  // Its number in the answer: [n].
  n: number;
  id: string;
  kind: TeamRecordKind | "people";
  label: string;
  title: string | null;
  text: string;
  product: { id: string; name: string } | null;
  sessionId: string | null;
  author: string | null;
  // ISO time it was shared.
  at: string | null;
  refs: { type: string; id: string; url: string | null }[];
  cited: boolean;
}

export interface AskPreview {
  question: string;
  mode: AskMode;
  product: { id: string; name: string } | null;
  // ISO start of the window a recent question reads.
  since: string | null;
  sources: AskSource[];
}

export interface AskResult extends AskPreview {
  // answered: cited text; unanswered: nothing answers it, and it's a gap now (gap, unless keeping it failed);
  // quiet: a recent question in a window nothing was approved in; slow: the model took too long, try again.
  status: "answered" | "unanswered" | "quiet" | "slow";
  answer: Answer | null;
  gap: { id: string; created: boolean } | null;
  // No model is set up: the answer is the closest sentences, quoted.
  excerpts: boolean;
}

export interface AskUsing {
  provider?: Pick<Provider, "answer" | "name">;
  now?: Date;
  waitMs?: number;
  slowAfterMs?: number;
}

const KIND_LABELS: Record<TeamRecordKind | "people", string> = {
  summary: "Summary",
  decision: "Decision",
  insight: "Insight",
  workflow: "Workflow",
  pain_point: "Pain point",
  context_gap: "Context gap",
  open: "Open question",
  people: "Who to ask",
};

// ---------- The question ----------

// The question as it's read: trimmed, its spacing collapsed, at most QUESTION_MAX characters. Anything else is refused.
export function cleanQuestion(raw: unknown): string {
  if (typeof raw !== "string") throw new Refusal("Ask a question.");
  const question = raw.replace(/\s+/g, " ").trim();
  if (!question) throw new Refusal("Ask a question.");
  if (question.length > QUESTION_MAX)
    throw new Refusal(`Keep the question to ${QUESTION_MAX} characters; this one has ${question.length}.`);
  return question;
}

const ONBOARDING =
  /\b(?:i'?m|i am|we'?re|we are)\s+(?:new|starting)\b|\bnew\s+(?:joiner|starter|hire|here|to)\b|\bwhere\s+(?:do|should|can)\s+i\s+(?:start|begin)\b|\bonboard|\bfirst\s+week\b|\bgetting\s+started\b/i;
const RECENT =
  /\b(?:this|last|past)\s+(?:week|month|few\s+days)\b|\bwhat(?:'s|\s+is|\s+has|\s+have)?\s+(?:changed|new|shipped|happened|landed)\b|\brecent(?:ly)?\b|\blately\b|\btoday\b|\byesterday\b/i;

export function modeOf(question: string): AskMode {
  if (ONBOARDING.test(question)) return "onboarding";
  if (RECENT.test(question)) return "recent";
  return "search";
}

// How far back a recent question reads.
export function windowDays(question: string): number {
  if (/\bmonth\b/i.test(question)) return 31;
  if (/\b(?:today|yesterday)\b/i.test(question)) return 2;
  return 7;
}

const STOP = new Set(
  (
    "a an and are as at be been but by do does did for from has have i im in is it its me my of on or our so that the " +
    "this to was we were will with you your they them their there here not no can could should would how what why " +
    "where when which who whom whose about any some get got way ive weve dont isnt"
  ).split(" "),
);
// Words that say when or how much changed, not what: a recent question's own words, left out of matching.
const TIME_WORDS = new Set(
  "change changed changes new shipped ship happen happened landed week weeks month today yesterday recent recently lately last past days"
    .split(" ")
    .map((w) => stem(w)),
);

// Rough, and the same for the question and the records: retry, retries, retried and retrying are one word.
function stem(word: string): string {
  if (word.length <= 4) return word;
  if (/ie[sd]$/.test(word)) return `${word.slice(0, -3)}y`;
  return word.replace(/(?:ments?|ings?|ions?|ers?|ed|es|s)$/, "");
}

// The words of a text, as they're compared: lower case, without small words, roughly stemmed.
export function wordsOf(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/'/g, "")
      .match(/[\p{L}\p{N}][\p{L}\p{N}_]*/gu) ?? []
  ).filter((w) => w.length > 1 && !STOP.has(w));
}

export const termsOf = (text: string): Set<string> => new Set(wordsOf(text).map(stem));

// ---------- Finding the sources ----------

interface Hits {
  // A record's id, and a summary revision's id, each with its text score.
  records: Map<string, number>;
  summaries: Map<string, number>;
}

// What the text indexes score highest for these words. Only a ranking: visibility comes from the read model.
async function textHits(words: string[]): Promise<Hits> {
  const none: Hits = { records: new Map(), summaries: new Map() };
  if (!words.length) return none;
  const search = [...new Set(words)].slice(0, 30).join(" ");
  const score = { score: { $meta: "textScore" } } as const;
  try {
    const [recordHits, summaryHits] = await Promise.all([
      records()
        .find({ $text: { $search: search }, status: "approved", "scope.org": DEFAULT_ORG })
        .project<{ _id: ObjectId; score: number }>(score)
        .sort(score)
        .limit(TEXT_HITS)
        .toArray(),
      summaryRevisions()
        .find({ $text: { $search: search } })
        .project<{ _id: ObjectId; score: number }>(score)
        .sort(score)
        .limit(TEXT_HITS)
        .toArray(),
    ]);
    return {
      records: new Map(recordHits.map((d) => [d._id.toHexString(), d.score])),
      summaries: new Map(summaryHits.map((d) => [d._id.toHexString(), d.score])),
    };
  } catch {
    // No text index here yet: the words alone rank.
    return none;
  }
}

// The summary revision a summary line came from (its id is s.<revision>.<field>.<index>).
const revisionOf = (record: TeamRecord): string | null =>
  record.source === "summary" ? (record.id.split(".")[1] ?? null) : null;

const recordWords = (r: TeamRecord): Set<string> => termsOf([r.title ?? "", r.text, r.areas.join(" ")].join(" "));

// How well a record matches: the share of the question's words it has, plus its text index score (scaled to the best
// hit). A summary's score is for the whole summary, so it counts for the lines that share a word with the question, and
// half for the summary line itself, which stands for the session.
function relevance(record: TeamRecord, asked: Set<string>, hits: Hits, best: { records: number; summaries: number }) {
  const said = recordWords(record);
  const shared = asked.size ? [...asked].filter((w) => said.has(w)).length / asked.size : 0;
  let indexed = 0;
  if (record.source === "record") indexed = (hits.records.get(record.id) ?? 0) / (best.records || 1);
  else {
    const score = hits.summaries.get(revisionOf(record) ?? "") ?? 0;
    const share = shared > 0 ? 1 : record.kind === "summary" ? 0.5 : 0;
    indexed = (score / (best.summaries || 1)) * share;
  }
  return shared + indexed;
}

// The first `limit`, with no more than PER_SESSION from one session.
function spread(sorted: TeamRecord[], limit: number): TeamRecord[] {
  const perSession = new Map<string, number>();
  const out: TeamRecord[] = [];
  for (const record of sorted) {
    if (out.length >= limit) break;
    const seen = perSession.get(record.sessionId) ?? 0;
    if (seen >= PER_SESSION) continue;
    perSession.set(record.sessionId, seen + 1);
    out.push(record);
  }
  return out;
}

const KIND_ORDER: TeamRecordKind[] = [
  "summary",
  "decision",
  "insight",
  "workflow",
  "pain_point",
  "context_gap",
  "open",
];
const newestFirst = (a: TeamRecord, b: TeamRecord) => b.at.getTime() - a.at.getTime();

function bySearch(universe: TeamRecord[], asked: Set<string>, hits: Hits): TeamRecord[] {
  const best = { records: Math.max(0, ...hits.records.values()), summaries: Math.max(0, ...hits.summaries.values()) };
  const scored = universe
    .map((record) => ({ record, score: relevance(record, asked, hits, best) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || newestFirst(a.record, b.record));
  return spread(
    scored.map((s) => s.record),
    SOURCE_LIMIT,
  );
}

// What was approved in the window: the records that match what's asked about first, then summaries, then the rest,
// newest first.
function byRecent(universe: TeamRecord[], asked: Set<string>, since: Date): TeamRecord[] {
  const kindRank = (r: TeamRecord) => KIND_ORDER.indexOf(r.kind);
  const shared = (r: TeamRecord) => {
    const said = recordWords(r);
    return [...asked].filter((w) => said.has(w)).length;
  };
  const sorted = universe
    .filter((r) => r.at >= since)
    .map((record) => ({ record, shared: shared(record) }))
    .sort((a, b) => b.shared - a.shared || kindRank(a.record) - kindRank(b.record) || newestFirst(a.record, b.record));
  return spread(
    sorted.map((s) => s.record),
    SOURCE_LIMIT,
  );
}

// A first-week path: the newest workflow findings first, then summaries of recent work, then insights.
function byOnboarding(universe: TeamRecord[]): TeamRecord[] {
  const of = (kind: TeamRecordKind) => universe.filter((r) => r.kind === kind).sort(newestFirst);
  const workflow = of("workflow");
  const summaries = of("summary");
  const insights = of("insight");
  const first = [...workflow.slice(0, 4), ...summaries.slice(0, 2), ...insights.slice(0, 2)];
  const rest = [...workflow.slice(4), ...insights.slice(2), ...summaries.slice(2)];
  return [...first, ...rest].slice(0, SOURCE_LIMIT);
}

// The product a question names, when it names one: "I'm new to billing".
function productNamedIn(question: string, products: Product[]): Product | null {
  const asked = ` ${wordsOf(question).join(" ")} `;
  const named = products
    .filter((p) => {
      const name = wordsOf(p.name).join(" ");
      return name && asked.includes(` ${name} `);
    })
    .sort((a, b) => b.name.length - a.name.length);
  return named[0] ?? null;
}

interface Gathered {
  question: string;
  mode: AskMode;
  product: Product | null;
  since: Date | null;
  picked: TeamRecord[];
  people: AnswerSource | null;
  // What the model is asked: the question, with how to answer it for a recent or onboarding question.
  prompt: string;
  // The question's own words, as matched.
  asked: Set<string>;
  names: Map<string, string>;
}

const day = (at: Date) => at.toISOString().slice(0, 10);

// Who has worked on the product recently, as a source the answer can cite: names and areas, never how much.
async function peopleSource(product: Product, viewer: ViewerRef): Promise<AnswerSource | null> {
  const { people, areas } = await contributorsFor(product.id, viewer);
  if (!people.length) return null;
  const list = (ps: { name: string }[]) => ps.map((p) => p.name).join(", ");
  const lines = [`People who have worked on ${product.name} recently: ${list(people)}.`];
  if (areas.length) {
    lines.push("Who worked on each area, the most recently worked on area first:");
    for (const area of areas.slice(0, 10)) lines.push(`${area.area}: ${list(area.people)}.`);
  }
  return { id: `people:${product.id}`, title: `Who has worked on ${product.name} recently`, text: lines.join("\n") };
}

async function gather(question: string, options: AskOptions, viewer: ViewerRef, now: Date): Promise<Gathered> {
  const products = await listProducts(viewer);
  const names = new Map(products.map((p) => [p.id, p.name]));
  let product: Product | null = null;
  if (options.productId) {
    product = await getProduct(options.productId, viewer);
    if (!product) throw new Refusal("That product isn't listed any more. Pick another, or ask across all of them.");
    names.set(product.id, product.name);
  }
  const mode = options.mode ?? modeOf(question);
  if (!product && mode !== "search") product = productNamedIn(question, products);

  const productWords = product ? termsOf(product.name) : new Set<string>();
  const asked = new Set(
    [...termsOf(question)].filter((w) => !productWords.has(w) && (mode === "search" || !TIME_WORDS.has(w))),
  );
  const [universe, hits] = await Promise.all([
    recordsFor({ productId: product?.id, limit: UNIVERSE }, viewer),
    mode === "search"
      ? textHits(wordsOf(question))
      : Promise.resolve<Hits>({ records: new Map(), summaries: new Map() }),
  ]);
  const approved = universe.filter((r) => r.status === "approved");

  if (mode === "recent") {
    const since = new Date(now.getTime() - windowDays(question) * DAY_MS);
    const where = product ? ` in ${product.name}` : "";
    return {
      question,
      mode,
      product,
      since,
      picked: byRecent(approved, asked, since),
      people: null,
      asked,
      prompt: `${question}\n\nToday is ${day(now)}. Answer from what was approved${where} since ${day(since)}: what was built or changed, and any decisions, newest first.`,
      names,
    };
  }
  if (mode === "onboarding") {
    const where = product ? ` in ${product.name}` : "";
    return {
      question,
      mode,
      product,
      since: null,
      picked: byOnboarding(approved),
      people: product ? await peopleSource(product, viewer) : null,
      asked,
      prompt: `${question}\n\nAnswer as a first-week path${where} for someone new to the team, in this order: how to set it up and run it, the main areas of the code, the things that catch people out, and whom to ask about each area. Name only people the sources name.`,
      names,
    };
  }
  return {
    question,
    mode,
    product,
    since: null,
    picked: bySearch(approved, asked, hits),
    people: null,
    asked,
    prompt: question,
    names,
  };
}

// The summary's reason, for summary lines: the read model's line carries what was built, not why.
async function reasons(picked: TeamRecord[]): Promise<Map<string, string>> {
  const ids = picked
    .filter((r) => r.kind === "summary")
    .map(revisionOf)
    .filter((id): id is string => Boolean(id && /^[a-f0-9]{24}$/.test(id)));
  if (!ids.length) return new Map();
  const docs = await summaryRevisions()
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
    .project<{ _id: ObjectId; summary?: { why?: string } }>({ "summary.why": 1 })
    .toArray();
  return new Map(
    docs.flatMap((d) => (d.summary?.why?.trim() ? [[d._id.toHexString(), d.summary.why.trim()] as const] : [])),
  );
}

function sourceOf(record: TeamRecord, names: Map<string, string>, why: string | undefined): AnswerSource {
  const productName = record.productId ? (names.get(record.productId) ?? null) : null;
  const tickets = record.refs.filter((r) => r.type === "ticket").map((r) => r.id);
  const where = productName ?? (record.repo || null);
  const shared = [
    `Shared ${day(record.at)}`,
    record.author ? `by ${record.author.name}` : null,
    where ? `in ${where}` : null,
  ].filter(Boolean);
  const lines = [record.text];
  if (why) lines.push(`Why: ${why}`);
  if (record.kind === "summary" && record.areas.length) lines.push(`Areas: ${record.areas.join(", ")}.`);
  lines.push(`(${shared.join(" ")}${tickets.length ? `; tickets ${tickets.join(", ")}` : ""}.)`);
  return { id: record.id, title: record.title ?? KIND_LABELS[record.kind], text: lines.join("\n") };
}

const webUrl = (url: unknown): string | null =>
  typeof url === "string" && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;

function cardOf(n: number, record: TeamRecord, names: Map<string, string>, cited: Set<string>): AskSource {
  const name = record.productId ? names.get(record.productId) : undefined;
  return {
    n,
    id: record.id,
    kind: record.kind,
    label: KIND_LABELS[record.kind],
    title: record.title,
    text: record.text,
    product: record.productId && name ? { id: record.productId, name } : null,
    sessionId: record.sessionId || null,
    author: record.author?.name ?? null,
    at: record.at.toISOString(),
    refs: [
      ...new Map(
        record.refs.map((r) => [`${r.type}:${r.id}`, { type: String(r.type), id: String(r.id), url: webUrl(r.url) }]),
      ).values(),
    ].slice(0, 6),
    cited: cited.has(record.id),
  };
}

function peopleCard(n: number, source: AnswerSource, product: Product, cited: Set<string>): AskSource {
  return {
    n,
    id: source.id,
    kind: "people",
    label: KIND_LABELS.people,
    title: source.title,
    text: source.text,
    product: { id: product.id, name: product.name },
    sessionId: null,
    author: null,
    at: null,
    refs: [],
    cited: cited.has(source.id),
  };
}

interface Prepared {
  gathered: Gathered;
  sources: AnswerSource[];
  cards: (cited: Set<string>) => AskSource[];
}

async function prepare(rawQuestion: unknown, options: AskOptions, viewer: ViewerRef, now: Date): Promise<Prepared> {
  const question = cleanQuestion(rawQuestion);
  if (!(await reader(viewer))) throw new Refusal("This account can't read the team's work.");
  const gathered = await gather(question, options, viewer, now);
  if (gathered.mode === "search" && !gathered.asked.size)
    throw new Refusal("Say a little more: name the thing you want to know about.");
  const why = await reasons(gathered.picked);
  const sources = gathered.picked.map((r) => sourceOf(r, gathered.names, why.get(revisionOf(r) ?? "")));
  if (gathered.people) sources.push(gathered.people);
  const cards = (cited: Set<string>) => {
    const out = gathered.picked.map((r, i) => cardOf(i + 1, r, gathered.names, cited));
    if (gathered.people && gathered.product)
      out.push(peopleCard(out.length + 1, gathered.people, gathered.product, cited));
    return out;
  };
  return { gathered, sources, cards };
}

const productView = (product: Product | null) => (product ? { id: product.id, name: product.name } : null);

// The records a question would be answered from, before the model reads them: the page shows how many it's reading.
export async function previewAsk(rawQuestion: unknown, options: AskOptions, viewer: ViewerRef): Promise<AskPreview> {
  const { gathered, cards } = await prepare(rawQuestion, options, viewer, new Date());
  return {
    question: gathered.question,
    mode: gathered.mode,
    product: productView(gathered.product),
    since: gathered.since?.toISOString() ?? null,
    sources: cards(new Set()),
  };
}

// A question nothing could answer, kept as a gap for the team. Who asked isn't kept.
async function keepGap(question: string, productId: string | null): Promise<AskResult["gap"]> {
  try {
    return await recordAskGap(question, productId);
  } catch (error) {
    if (!(error instanceof Refusal)) console.warn("ask: couldn't keep the gap", { error: String(error) });
    return null;
  }
}

async function answerWithin(
  using: Pick<Provider, "answer">,
  prompt: string,
  sources: AnswerSource[],
  waitMs: number,
  slowAfterMs: number,
): Promise<Answer | null | "slow"> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"slow">((resolve) => {
    timer = setTimeout(() => resolve("slow"), waitMs);
  });
  try {
    const answer = await Promise.race([using.answer(prompt, sources).catch(() => null), late]);
    if (answer === null && Date.now() - started >= slowAfterMs) return "slow";
    return answer;
  } finally {
    clearTimeout(timer);
  }
}

// Answers a question from the approved work the viewer may see. Refuses a question that's empty or too long, and a
// viewer who can't read the team's work.
export async function askStrata(
  rawQuestion: unknown,
  options: AskOptions,
  viewer: ViewerRef,
  using: AskUsing = {},
): Promise<AskResult> {
  const now = using.now ?? new Date();
  const { gathered, sources, cards } = await prepare(rawQuestion, options, viewer, now);
  const answerer = using.provider ?? provider();
  const base = {
    question: gathered.question,
    mode: gathered.mode,
    product: productView(gathered.product),
    since: gathered.since?.toISOString() ?? null,
    excerpts: answerer.name === "stub",
    answer: null,
    gap: null,
  };
  const productId = gathered.product?.id ?? null;
  if (!sources.length) {
    // A quiet week isn't something the team doesn't know.
    if (gathered.mode === "recent") return { ...base, status: "quiet", sources: [] };
    return { ...base, status: "unanswered", sources: [], gap: await keepGap(gathered.question, productId) };
  }
  const reply = await answerWithin(
    answerer,
    gathered.prompt,
    sources,
    using.waitMs ?? ANSWER_WAIT_MS,
    using.slowAfterMs ?? SLOW_AFTER_MS,
  );
  if (reply === "slow") return { ...base, status: "slow", sources: cards(new Set()) };
  // Only citations of a source given count; an answer citing none is no answer.
  const answer = reply ? citedAnswer(reply.text, sources) : null;
  if (!answer)
    return {
      ...base,
      status: "unanswered",
      sources: cards(new Set()),
      gap: await keepGap(gathered.question, productId),
    };
  return { ...base, status: "answered", answer, sources: cards(new Set(answer.cited)) };
}

// ---------- How often ----------

const questionTimes = new Map<string, number[]>();
const HOUR_MS = 60 * 60 * 1000;

// Whether this person may ask another question now; counts it when they may. Kept in memory only, per server process:
// a guard on cost, not a record of who asked what.
export function takeQuestion(viewer: ViewerRef, now = Date.now()): boolean {
  const id = viewerIdOf(viewer);
  const recent = (questionTimes.get(id) ?? []).filter((at) => now - at < HOUR_MS);
  if (recent.length >= ASK_LIMIT_PER_HOUR) {
    questionTimes.set(id, recent);
    return false;
  }
  recent.push(now);
  questionTimes.set(id, recent);
  if (questionTimes.size > 10_000)
    for (const [key, times] of questionTimes) if (!times.some((at) => now - at < HOUR_MS)) questionTimes.delete(key);
  return true;
}
