"use server";
// The gap page's three decisions. Each checks who's asking and what the hub allows (server/hub/gaps.ts), so a refused
// change comes back as words for the page, never a crash.
import { revalidatePath } from "next/cache";
import { reopenGap, resolveGap, takeGap } from "../../../server/hub/gaps.ts";
import { Refusal } from "../../../server/people.ts";
import { requireViewer } from "../../../server/viewer.ts";

export interface Result {
  error: string | null;
}

async function attempt(id: string, work: (viewerId: string) => Promise<unknown>): Promise<Result> {
  const viewer = await requireViewer();
  try {
    await work(viewer.userId);
  } catch (error) {
    if (error instanceof Refusal) return { error: error.message };
    throw error;
  }
  revalidatePath("/gaps");
  revalidatePath(`/gaps/${id}`);
  return { error: null };
}

export const take = async (id: string) => attempt(id, (viewer) => takeGap(id, viewer));
export const reopen = async (id: string) => attempt(id, (viewer) => reopenGap(id, viewer));
export const resolve = async (id: string, url: string, note: string) =>
  attempt(id, (viewer) => resolveGap(id, viewer, { url: url || null, note }));
