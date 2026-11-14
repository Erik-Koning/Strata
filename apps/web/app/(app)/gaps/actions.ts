"use server";
// The gaps page's actions: taking a gap on, resolving it with what answers it, and reopening it. A server action can be
// called without the page, so each one checks the caller on every call (signed in, not suspended) and reads its
// arguments as untrusted; the data layer (server/hub/gaps.ts) checks the caller again before it writes.
import { ObjectIdHex } from "@strata/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reopenGap as reopen, resolveGap as resolve, takeGap as take } from "../../../server/hub/gaps.ts";
import { InvalidInput, input } from "../../../server/inputs.ts";
import { Refusal } from "../../../server/people.ts";
import { getViewer, type Viewer } from "../../../server/viewer.ts";

export interface Result {
  error: string | null;
}

const GONE = "That gap doesn't exist any more.";

async function attempt(rawId: unknown, work: (id: string, viewer: Viewer) => Promise<unknown>): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Sign in to do that." };
  try {
    await work(input(ObjectIdHex, rawId), viewer);
  } catch (error) {
    if (error instanceof InvalidInput) return { error: GONE };
    if (error instanceof Refusal) return { error: error.message };
    throw error;
  }
  revalidatePath("/gaps", "layout");
  revalidatePath("/products", "layout");
  revalidatePath("/audit");
  return { error: null };
}

const webAddress = (value: string): boolean => {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
};

// What answers a gap: a note saying what it is or where it's written down, always; a link to it when there is one.
const Resolution = z.object({
  url: z
    .string({ error: "Give the link as text." })
    .trim()
    .max(2000, { error: "That link is too long." })
    .optional()
    .transform((url) => url || null)
    .refine((url) => url === null || webAddress(url), {
      error: "Give the link as a web address, starting with https://.",
    }),
  note: z
    .string({ error: "Write a note." })
    .trim()
    .min(1, { error: "Write a note: what answers it, or where it's written down." })
    .max(1000, { error: "Keep the note under 1,000 characters." }),
});

// The viewer takes the gap on, from whoever had it.
export async function takeGap(rawId: string): Promise<Result> {
  return attempt(rawId, (id, viewer) => take(id, viewer));
}

// Resolved, with what answers it.
export async function resolveGap(rawId: string, raw: { url?: string; note: string }): Promise<Result> {
  const parsed = Resolution.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Write a note." };
  return attempt(rawId, (id, viewer) => resolve(id, viewer, parsed.data));
}

// Open again: what answered it didn't. Its resolution goes; the audit log keeps who resolved it and with what link.
export async function reopenGap(rawId: string): Promise<Result> {
  return attempt(rawId, (id, viewer) => reopen(id, viewer));
}
