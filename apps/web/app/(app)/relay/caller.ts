// The signed-in person as the handoff service knows them. The page and every Relay server action start here.
import "server-only";
import type { Caller } from "../../../server/handoffs/service.ts";
import { requireViewer } from "../../../server/viewer.ts";

export async function requireCaller(): Promise<Caller> {
  const viewer = await requireViewer();
  return {
    userId: viewer.userId,
    name: viewer.name,
    email: viewer.email,
    actor: { kind: "user", id: viewer.userId, label: viewer.name },
  };
}
