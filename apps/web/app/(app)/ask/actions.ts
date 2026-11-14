"use server";
// Ask's two steps: which records a question would be answered from (so the page can say how many it's reading), then
// the answer. Each checks the caller and reads the arguments afresh: the answer finds its sources again rather than
// taking them from the page. Nothing asked is kept, except a question nothing answers, as a gap with no name on it.
import { z } from "zod";
import {
  ASK_MODES,
  type AskPreview,
  type AskResult,
  askStrata,
  previewAsk,
  QUESTION_MAX,
  takeQuestion,
} from "../../../server/hub/ask.ts";
import { InvalidInput, input } from "../../../server/inputs.ts";
import { Refusal } from "../../../server/people.ts";
import { requireViewer } from "../../../server/viewer.ts";

export type Outcome<T> = { ok: T; error: null } | { ok: null; error: string };

// The question is checked again in server/hub/ask.ts (trimmed, at most QUESTION_MAX); this only keeps a huge one out.
const Question = z.string().max(QUESTION_MAX * 4);
const Options = z.object({
  productId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
    .nullable()
    .default(null),
  mode: z.enum(ASK_MODES).nullable().default(null),
});

async function attempt<T>(work: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: await work(), error: null };
  } catch (error) {
    if (error instanceof Refusal) return { ok: null, error: error.message };
    if (error instanceof InvalidInput)
      return { ok: null, error: `That can't be asked as it is. Keep the question to ${QUESTION_MAX} characters.` };
    console.error("ask: failed", { error: String(error) });
    return { ok: null, error: "Something went wrong reading the team's work. Try again in a moment." };
  }
}

export async function findSources(rawQuestion: unknown, rawOptions: unknown): Promise<Outcome<AskPreview>> {
  const viewer = await requireViewer();
  return attempt(() => previewAsk(input(Question, rawQuestion), input(Options, rawOptions), viewer));
}

export async function answer(rawQuestion: unknown, rawOptions: unknown): Promise<Outcome<AskResult>> {
  const viewer = await requireViewer();
  return attempt(async () => {
    const question = input(Question, rawQuestion);
    const options = input(Options, rawOptions);
    if (!takeQuestion(viewer))
      throw new Refusal("That's a lot of questions for one hour. Give it a few minutes, then ask again.");
    return askStrata(question, options, viewer);
  });
}
