"use server";
// My Day's actions: a person deciding about their own drafts and suggested memories. The record rules are the same ones
// /api/records uses (server/records/routes.ts): only the author can edit, approve or discard, whatever id is given.
import { revalidatePath } from "next/cache";
import { ApiError } from "../../../server/http.ts";
import {
  approve as approveRecord,
  type Caller,
  discard as discardRecord,
  editRecord,
} from "../../../server/records/routes.ts";
import { setStatus } from "../../../server/stats.ts";
import { requireViewer } from "../../../server/viewer.ts";

export interface Result {
  error: string | null;
}

async function attempt(work: (me: Caller) => Promise<unknown>): Promise<Result> {
  const viewer = await requireViewer();
  try {
    await work({ kind: "user", userId: viewer.userId, label: viewer.name });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500)
      return { error: error.message === "No such record." ? "That draft isn't there any more." : error.message };
    throw error;
  }
  revalidatePath("/my-day");
  revalidatePath("/", "layout");
  return { error: null };
}

const text = (value: unknown): string => String(value ?? "").slice(0, 8000);

// Shares it. Given text is the author's last edit, saved first so what's approved is what they read.
export async function approve(id: string, edited?: string): Promise<Result> {
  return attempt(async (me) => {
    if (edited !== undefined) await editRecord(me, id, { text: text(edited) });
    await approveRecord(me, id);
  });
}

export async function save(id: string, edited: string): Promise<Result> {
  return attempt((me) => editRecord(me, id, { text: text(edited) }));
}

export async function discard(id: string): Promise<Result> {
  return attempt((me) => discardRecord(me, id));
}

// A memory a session suggested: kept (active, so agents get it) or set aside (archived; nothing is deleted).
export async function decideCandidate(id: string, keep: boolean): Promise<Result> {
  return attempt(async (me) => {
    if (me.kind !== "user" || !(await setStatus(me.userId, id, keep ? "active" : "archived")))
      throw new ApiError(404, "not_found", "That memory isn't waiting any more.");
  });
}
