"use server";
import { MEMORY_KINDS, MEMORY_TEXT_MAX, MemoryText } from "@strata/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DEFAULT_ORG } from "../../../server/api-auth.ts";
import { indexesReady } from "../../../server/indexes.ts";
import { input, MemoryIds, StatusChange } from "../../../server/inputs.ts";
import { forget } from "../../../server/memory/forget.ts";
import { saveMemory } from "../../../server/memory/save.ts";
import { ALL_PROJECTS } from "../../../server/memory/scope.ts";
import { setStatus } from "../../../server/stats.ts";
import { requireViewer } from "../../../server/viewer.ts";

export async function previewForget(ids: string[]) {
  const viewer = await requireViewer();
  const result = await forget({
    actor: { kind: "user", id: viewer.userId, label: viewer.name },
    owner: { org: DEFAULT_ORG, user: viewer.userId },
    ids: input(MemoryIds, ids),
    dryRun: true,
  });
  return { memories: result.memories, summaries: result.summaries, events: result.events };
}

export async function confirmForget(ids: string[]) {
  const viewer = await requireViewer();
  const result = await forget({
    actor: { kind: "user", id: viewer.userId, label: viewer.name },
    owner: { org: DEFAULT_ORG, user: viewer.userId },
    ids: input(MemoryIds, ids),
    dryRun: false,
  });
  revalidatePath("/memories");
  revalidatePath("/");
  return { memories: result.memories, summaries: result.summaries, events: result.events };
}

export async function changeStatus(rawId: string, rawStatus: "active" | "archived") {
  const viewer = await requireViewer();
  const { id, status } = input(StatusChange, { id: rawId, status: rawStatus });
  const ok = await setStatus(viewer.userId, id, status);
  revalidatePath("/memories");
  revalidatePath("/");
  return ok;
}

export interface AddState {
  error: string | null;
  saved: number;
}

export async function addMemory(prev: AddState, form: FormData): Promise<AddState> {
  const viewer = await requireViewer();
  // The same rule the API's save route applies (SaveRequest.text), so the form and the tool can't disagree.
  const parsed = MemoryText.safeParse(form.get("text") ?? "");
  if (!parsed.success)
    return {
      error:
        parsed.error.issues[0]?.code === "too_big"
          ? `Keep it under ${MEMORY_TEXT_MAX.toLocaleString("en")} characters.`
          : "Write the memory first: a sentence your agents should keep.",
      saved: prev.saved,
    };
  const text = parsed.data;
  const kind = z.enum(MEMORY_KINDS).catch("fact").parse(form.get("kind"));
  const project = String(form.get("project") ?? "").trim() || ALL_PROJECTS;
  await indexesReady();
  await saveMemory({
    actor: { kind: "user", id: viewer.userId, label: viewer.name },
    scope: { org: DEFAULT_ORG, user: viewer.userId, project: project.slice(0, 200) },
    text,
    kind,
    sessionID: null,
    source: "manual",
  });
  revalidatePath("/memories");
  revalidatePath("/");
  return { error: null, saved: prev.saved + 1 };
}
