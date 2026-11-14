"use server";
import { revalidatePath } from "next/cache";
import { indexesReady } from "../../../server/indexes.ts";
import { input, RefId } from "../../../server/inputs.ts";
import { createKey, revokeKey } from "../../../server/keys.ts";
import { requireViewer } from "../../../server/viewer.ts";

export interface KeyState {
  key: string | null;
  name: string;
  error: string | null;
}

export async function makeKey(_: KeyState, form: FormData): Promise<KeyState> {
  const viewer = await requireViewer();
  const name = String(form.get("name") ?? "").trim() || "Claude Code";
  await indexesReady();
  const { key, doc } = await createKey(viewer.userId, name);
  revalidatePath("/connect");
  return { key, name: doc.name, error: null };
}

export async function revoke(id: string): Promise<void> {
  const viewer = await requireViewer();
  await revokeKey(viewer.userId, input(RefId, id));
  revalidatePath("/connect");
  revalidatePath("/");
}
