// Ask Strata: one question, answered from the asking person's own records (sources.ts says which), with every point
// cited. No model writes the answer: the AI provider is a stub, so the answer is extractive and says so.
import { compose } from "./answer.ts";
import { loadCorpus, vectorHits } from "./sources.ts";
import { readQuestion } from "./text.ts";
import type { Answer } from "./types.ts";

export const MAX_QUESTION = 500;

export async function ask(userId: string, raw: string, now = new Date()): Promise<Answer> {
  const question = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
  const reading = readQuestion(question);
  const [corpus, vector] = await Promise.all([
    loadCorpus(userId),
    reading.terms.length
      ? vectorHits(userId, question)
      : Promise.resolve({ scores: new Map<string, number>(), available: false }),
  ]);
  return compose({
    question,
    corpus: corpus.cards,
    counts: corpus.counts,
    vector: vector.scores,
    retrieval: vector.available ? "vector+text" : "text",
    now,
  });
}
