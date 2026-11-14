"use server";
import { MEMORY_KINDS, type MemoryKind } from "@strata/contracts";
import { revalidatePath } from "next/cache";
import { DEFAULT_ORG } from "../../../server/api-auth.ts";
import { indexesReady } from "../../../server/indexes.ts";
import { forget } from "../../../server/memory/forget.ts";
import { saveMemory } from "../../../server/memory/save.ts";
import { ALL_PROJECTS } from "../../../server/memory/scope.ts";
import { setStatus } from "../../../server/stats.ts";
import { requireViewer } from "../../../server/viewer.ts";

const validIds = (ids: string[]): string[] => ids.filter((id) => /^[a-f0-9]{24}$/.test(id)).slice(0, 500);

export async function previewForget(ids: string[]) {
  const viewer = await requireViewer();
  const result = await forget({
    actor: { kind: "user", id: viewer.userId, label: viewer.name },
    owner: { org: DEFAULT_ORG, user: viewer.userId },
    ids: validIds(ids),
    dryRun: true,
  });
  return { memories: result.memories, summaries: result.summaries, events: result.events };
}

export async function confirmForget(ids: string[]) {
  const viewer = await requireViewer();
  const result = await forget({
    actor: { kind: "user", id: viewer.userId, label: viewer.name },
    owner: { org: DEFAULT_ORG, user: viewer.userId },
    ids: validIds(ids),
    dryRun: false,
  });
  revalidatePath("/memories");
  revalidatePath("/");
  return { memories: result.memories, summaries: result.summaries, events: result.events };
}

export async function changeStatus(id: string, status: "active" | "archived") {
  const viewer = await requireViewer();
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
  const text = String(form.get("text") ?? "").trim();
  const kindRaw = String(form.get("kind") ?? "fact");
  const project = String(form.get("project") ?? "").trim() || ALL_PROJECTS;
  if (text.length < 3)
    return { error: "Write the memory first: a sentence your agents should keep.", saved: prev.saved };
  if (text.length > 4000) return { error: "Keep it under 4,000 characters.", saved: prev.saved };
  const kind: MemoryKind = (MEMORY_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as MemoryKind) : "fact";
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
