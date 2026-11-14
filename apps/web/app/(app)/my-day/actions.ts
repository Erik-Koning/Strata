"use server";
// My Day's actions: a person deciding about their own drafts and suggested memories. Each one acts only on the
// caller's own, whatever id it's given.
import { revalidatePath } from "next/cache";
import { approveRecord, discardRecord, saveDraft } from "../../../server/records.ts";
import { Refusal } from "../../../server/refusal.ts";
import { setStatus } from "../../../server/stats.ts";
import { requireViewer } from "../../../server/viewer.ts";

export interface Result {
  error: string | null;
}

async function attempt(work: () => Promise<unknown>): Promise<Result> {
  try {
    await work();
  } catch (error) {
    if (error instanceof Refusal) return { error: error.message };
    throw error;
  }
  revalidatePath("/my-day");
  revalidatePath("/", "layout");
  return { error: null };
}

const me = async () => {
  const viewer = await requireViewer();
  return { id: viewer.userId, label: viewer.name };
};

export async function approve(id: string, text?: string): Promise<Result> {
  const actor = await me();
  return attempt(() => approveRecord(actor, id, typeof text === "string" ? text.slice(0, 8000) : undefined));
}

export async function discard(id: string): Promise<Result> {
  const actor = await me();
  return attempt(() => discardRecord(actor, id));
}

export async function save(id: string, text: string): Promise<Result> {
  const actor = await me();
  return attempt(() => saveDraft(actor.id, id, String(text).slice(0, 8000)));
}

// A memory a session suggested: kept (active, so agents get it) or set aside (archived; nothing is deleted).
export async function decideCandidate(id: string, keep: boolean): Promise<Result> {
  const actor = await me();
  return attempt(async () => {
    if (!(await setStatus(actor.id, id, keep ? "active" : "archived")))
      throw new Refusal("That memory isn't waiting any more.");
  });
}
