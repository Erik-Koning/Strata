"use server";
// The Intelligence page's two calls. Each checks who's asking on every call (a server action can be called without
// the page), and reads only that person's records.
import { ask, MAX_QUESTION } from "../../../server/intelligence/ask.ts";
import { evidenceFor } from "../../../server/intelligence/evidence.ts";
import type { Answer, Evidence } from "../../../server/intelligence/types.ts";
import { getViewer } from "../../../server/viewer.ts";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function askStrata(question: unknown): Promise<Result<Answer>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session ended. Sign in again to ask." };
  if (typeof question !== "string" || question.trim().length < 2)
    return { ok: false, error: "Ask a question first: a sentence about the work." };
  if (question.length > MAX_QUESTION) return { ok: false, error: `Keep it under ${MAX_QUESTION} characters.` };
  try {
    return { ok: true, value: await ask(viewer.userId, question) };
  } catch (error) {
    console.error("intelligence.ask:", error);
    return { ok: false, error: "Strata couldn't search your records just now. Try again." };
  }
}

export async function openEvidence(ref: unknown, cited: unknown = false): Promise<Result<Evidence>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session ended. Sign in again." };
  if (typeof ref !== "string" || ref.length > 100) return { ok: false, error: "That isn't a source id." };
  try {
    const evidence = await evidenceFor(viewer.userId, ref, cited === true);
    // Not there, or not this person's: the same answer, so nothing about anyone else's records leaks.
    return evidence ? { ok: true, value: evidence } : { ok: false, error: "No record you can see has that id." };
  } catch (error) {
    console.error("intelligence.evidence:", error);
    return { ok: false, error: "Strata couldn't load that record just now. Try again." };
  }
}
