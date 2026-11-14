"use server";
// Relay's mutations from the web: drafting by hand, editing and approving a draft, and revoking. Claiming, recording
// tests and completing happen from Claude Code; the page only shows their results. Every action checks the caller
// again, whatever the page showed, and the service enforces who may do what.
import type { UpdateHandoffRequest } from "@strata/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  approveHandoff,
  createHandoff,
  getHandoff,
  revokeHandoff,
  updateHandoff,
} from "../../../server/handoffs/service.ts";
import { ApiError } from "../../../server/http.ts";
import { requireCaller } from "./caller.ts";

export interface FormState {
  error: string | null;
  saved: number;
}

const text = (form: FormData, key: string): string => String(form.get(key) ?? "").trim();
// One item per line, for the list fields.
const lines = (form: FormData, key: string): string[] =>
  text(form, key)
    .split("\n")
    .map((l) => l.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean);

const message = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;
  console.error("relay:", error);
  return "Something went wrong on our side. Try again.";
};

const fields = (form: FormData): UpdateHandoffRequest => ({
  title: text(form, "title"),
  summary: text(form, "summary"),
  completed: lines(form, "completed"),
  remaining: lines(form, "remaining"),
  blockers: lines(form, "blockers"),
  failedApproaches: lines(form, "failedApproaches"),
  decisions: lines(form, "decisions"),
  nextAction: text(form, "nextAction"),
  testCommands: lines(form, "testCommands"),
  changedFiles: lines(form, "changedFiles"),
});

export async function createDraft(prev: FormState, form: FormData): Promise<FormState> {
  const caller = await requireCaller();
  const project = text(form, "project");
  const title = text(form, "title");
  if (!project || !title) return { error: "A handoff needs a project and a title.", saved: prev.saved };
  let id: string;
  try {
    const handoff = await createHandoff(caller, { project, ...fields(form), title });
    id = handoff._id;
  } catch (error) {
    return { error: message(error), saved: prev.saved };
  }
  revalidatePath("/relay");
  redirect(`/relay?id=${id}`);
}

// One form, two buttons: "Save draft" keeps the edits; "Approve & share" keeps them and approves, with the recipient
// and the memories ticked. Nothing is shared until then.
export async function saveOrApprove(prev: FormState, form: FormData): Promise<FormState> {
  const caller = await requireCaller();
  const id = text(form, "id");
  const intent = text(form, "intent");
  if (!text(form, "title")) return { error: "The title can't be empty.", saved: prev.saved };
  try {
    // Only what changed, so approving an untouched draft doesn't put an edit on its timeline.
    const current = await getHandoff(caller, id);
    const patch = Object.fromEntries(
      Object.entries(fields(form)).filter(
        ([k, v]) => JSON.stringify(v) !== JSON.stringify(current[k as keyof typeof current]),
      ),
    ) as UpdateHandoffRequest;
    if (Object.keys(patch).length) await updateHandoff(caller, id, patch);
    if (intent === "approve") {
      const recipientId = text(form, "recipientId");
      if (!recipientId) {
        revalidatePath("/relay");
        return { error: "Choose who you're handing this to. Your edits are saved.", saved: prev.saved + 1 };
      }
      const memoryIds = form
        .getAll("memoryIds")
        .map(String)
        .filter((m) => /^[a-f0-9]{24}$/.test(m));
      await approveHandoff(caller, id, { recipientId, memoryIds });
    }
  } catch (error) {
    revalidatePath("/relay");
    return { error: message(error), saved: prev.saved };
  }
  revalidatePath("/relay");
  return { error: null, saved: prev.saved + 1 };
}

export async function revoke(id: string, reason: string): Promise<{ error: string | null }> {
  const caller = await requireCaller();
  try {
    await revokeHandoff(caller, id, { reason: reason.trim().slice(0, 500) });
  } catch (error) {
    return { error: message(error) };
  }
  revalidatePath("/relay");
  return { error: null };
}
