// An answer from records, without a model: the records that match, grouped by what they are, in their own words, each
// with its id. The only sentences Strata writes itself are about the search (how many records, of which kinds, what
// wasn't found); every claim about the work is a record's own text with its citation. Pure, so the tests pin it.
import { excerpt, type Reading, rank, readQuestion, tokens } from "./text.ts";
import type { Answer, AnswerSection, SourceCard } from "./types.ts";

const DAY = 24 * 60 * 60 * 1000;
export const MAX_SOURCES = 8;

export const CATEGORY_LABELS: Record<string, { one: string; many: string }> = {
  pain_point: { one: "pain point", many: "Pain points" },
  context_gap: { one: "context gap", many: "Context gaps" },
  decision: { one: "decision", many: "Decisions" },
  insight: { one: "insight", many: "Insights" },
  workflow: { one: "workflow note", many: "Workflow notes" },
  convention: { one: "convention", many: "Conventions" },
  preference: { one: "preference", many: "Preferences" },
  fact: { one: "fact", many: "Facts" },
  summary: { one: "session summary", many: "Session summaries" },
};

const label = (category: string) =>
  CATEGORY_LABELS[category] ?? { one: category.replace(/_/g, " "), many: category.replace(/_/g, " ") };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const quoted = (terms: string[], join = "and") => terms.map((t) => `“${t}”`).join(` ${join} `);

export interface ComposeInput {
  question: string;
  corpus: SourceCard[];
  counts: { memories: number; summaries: number; findings: number; candidates: number };
  // Memories the vector index put near the question, by ref, with their scores.
  vector?: Map<string, number>;
  retrieval: Answer["retrieval"];
  now?: Date;
}

function categoryCounts(cards: SourceCard[]): string {
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  return [...counts.entries()].map(([cat, n]) => plural(n, label(cat).one, label(cat).many.toLowerCase())).join(", ");
}

export function compose(input: ComposeInput): Answer {
  const { question, corpus, counts, retrieval } = input;
  const now = (input.now ?? new Date()).getTime();
  const reading: Reading = readQuestion(question);
  const intent = reading.intent;
  // A question about recent changes with no window of its own looks at the last 14 days.
  const windowDays = reading.windowDays ?? (intent?.name === "changes" && !reading.terms.length ? 14 : null);
  const windowLabel = reading.windowLabel ?? (windowDays ? `the last ${windowDays} days` : null);
  const inWindow = (c: SourceCard) => !windowDays || now - new Date(c.updatedAt).getTime() <= windowDays * DAY;
  const windowed = corpus.filter(inWindow);
  const projects = new Set(corpus.map((c) => c.project).filter((p) => p !== "*")).size;
  const byRef = new Map(corpus.map((c) => [c.ref, c]));

  let relevant: { card: SourceCard; score: number }[] = [];
  if (reading.terms.length) {
    // A word that names a project ("billing" for acme/billing) scopes the question: only records in that project, or
    // that say the word, can answer it; the rest of the topic then ranks them.
    const projectWords = new Set(corpus.flatMap((c) => (c.project === "*" ? [] : tokens(c.project))));
    const scoping = reading.terms.filter((t) => projectWords.has(t));
    const inScope = (c: SourceCard) => {
      const own = new Set(tokens(`${c.text} ${c.project}`));
      return scoping.every((t) => own.has(t));
    };
    const scored = rank(
      windowed.filter(inScope).map((c) => ({ id: c.ref, text: c.text, extra: `${c.project} ${c.category}` })),
      reading.terms,
      { minCoverage: scoping.length ? 0 : 0.5 },
    );
    const seen = new Set<string>();
    for (const s of scored) {
      seen.add(s.id);
      relevant.push({ card: byRef.get(s.id)!, score: s.score });
    }
    // Memories only the vector index found: kept when they're near enough to stand on their own.
    for (const [ref, score] of input.vector ?? []) {
      const card = byRef.get(ref);
      if (card && !seen.has(ref) && inWindow(card)) relevant.push({ card, score: score * 2 });
    }
  } else if (intent) {
    const wanted = new Set(intent.categories);
    relevant = windowed
      .filter((c) => intent.name === "changes" || wanted.has(c.category))
      .map((card) => ({ card, score: new Date(card.updatedAt).getTime() / 1e13 }));
  }

  // What the question asks for leads; then the strongest match; then the newest.
  const order = intent?.categories ?? [];
  const lead = (c: SourceCard) => {
    const i = order.indexOf(c.category);
    return i === -1 ? order.length : i;
  };
  relevant.sort(
    (a, b) => lead(a.card) - lead(b.card) || b.score - a.score || b.card.updatedAt.localeCompare(a.card.updatedAt),
  );
  // When records of the asked-for kind exist, the rest are context around them: a few, not the whole list.
  const direct = relevant.filter((r) => order.includes(r.card.category));
  const context = relevant.filter((r) => !order.includes(r.card.category));
  const picked = direct.length ? [...direct, ...context.slice(0, 3)] : relevant;
  const top = picked.slice(0, MAX_SOURCES);
  // Grouped by kind in the order shown, so the citation numbers read 1, 2, 3 down the answer.
  const sectionOrder = [...new Set([...order, ...top.map((r) => r.card.category)])];
  const chosen = sectionOrder.flatMap((cat) => top.filter((r) => r.card.category === cat).map((r) => r.card));
  const sections: AnswerSection[] = sectionOrder
    .map((category) => ({
      heading: label(category).many,
      points: chosen
        .filter((c) => c.category === category)
        .map((c) => ({ text: excerpt(c.text, c.kind === "summary" ? 260 : 320), refs: [c.ref] })),
    }))
    .filter((s) => s.points.length);

  const searched = {
    memories: counts.memories,
    summaries: counts.summaries,
    findings: counts.findings,
    projects,
  };
  const total = counts.memories + counts.summaries + counts.findings;
  const about = reading.display.length ? ` about ${quoted(reading.display)}` : "";
  const within = windowLabel ? ` from ${windowLabel}` : "";
  const gaps: string[] = [];
  let leadLine: string;

  if (!reading.terms.length && !intent) {
    leadLine = "That question doesn't name a topic Strata can look for.";
    gaps.push(
      "Ask about a project, a service or an area of the code (“billing”, “auth”), or about blockers, decisions, discoveries, recent changes, unfinished work or setup.",
    );
  } else if (!chosen.length) {
    leadLine = total ? `Nothing in your records${about}${within} answers this.` : "There are no records to search yet.";
    if (total)
      gaps.push(
        `Searched ${plural(total, "record")}: ${plural(counts.memories, "active memory", "active memories")}, ${plural(counts.summaries, "session summary", "session summaries")} and ${plural(counts.findings, "finding")}. None ${reading.terms.length ? `mentions ${quoted(reading.display, "or")}` : `is a ${intent ? label(intent.categories[0]!).one : "match"}`}${within}.`,
      );
    else
      gaps.push(
        "Records appear once a connected Claude Code session saves a memory, compacts, or logs a finding with record_finding.",
      );
    if (windowDays) {
      const older = reading.terms.length
        ? rank(
            corpus
              .filter((c) => !inWindow(c))
              .map((c) => ({ id: c.ref, text: c.text, extra: `${c.project} ${c.category}` })),
            reading.terms,
          ).length
        : corpus.filter((c) => !inWindow(c) && (intent?.name === "changes" || intent?.categories.includes(c.category)))
            .length;
      if (older)
        gaps.push(
          `${plural(older, "older record")} would match outside ${windowLabel}. Ask without the time to see them.`,
        );
    }
  } else {
    leadLine = `${plural(chosen.length, "record")}${about}${within}: ${categoryCounts(chosen)}.`;
    if (relevant.length > chosen.length)
      leadLine += ` Showing the ${chosen.length} most relevant of ${relevant.length}.`;
    if (direct.length && context.length)
      leadLine = `${plural(Math.min(direct.length, chosen.length), "record")}${about}${within} answer this directly, with ${chosen.length - Math.min(direct.length, chosen.length)} more for context: ${categoryCounts(chosen)}.`;
    if (
      (intent?.name === "blockers" || intent?.name === "unfinished") &&
      !chosen.some((c) => order.includes(c.category))
    )
      gaps.push(
        `None of these records is logged as a pain point or a context gap, so Strata can't say anything here is blocked or unfinished.`,
      );
    if (intent?.name === "why" && !chosen.some((c) => c.category === "decision"))
      gaps.push("None of these records is a decision, so the reason behind the approach isn't recorded.");
  }
  if (intent?.name === "blockers" || intent?.name === "unfinished")
    gaps.push(
      "Ticket and pull request status isn't connected to Strata: whether work is done is only known where a record says so.",
    );
  if (chosen.some((c) => c.kind === "finding"))
    gaps.push("Findings are drafts your agent logged while it worked. Nobody has reviewed them yet.");
  if (counts.candidates)
    gaps.push(
      `${plural(counts.candidates, "candidate memory", "candidate memories")} ${counts.candidates === 1 ? "waits" : "wait"} for your review and ${counts.candidates === 1 ? "wasn't" : "weren't"} used.`,
    );

  return {
    question,
    mode: "extractive",
    reading: {
      intent: intent?.name ?? null,
      intentLabel: intent?.label ?? null,
      terms: reading.display,
      window: windowLabel,
    },
    lead: leadLine,
    sections,
    gaps,
    sources: chosen,
    searched,
    retrieval,
  };
}
