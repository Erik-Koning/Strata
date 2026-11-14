// Who's calling the API: a person's API key (made on /connect), or the service token (MEMORY_API_TOKEN), which covers
// every scope. A missing or wrong token gets 401 before anything is read. The scope a request names is checked against
// the caller: a key covers its own person, in the one organisation this install has, and any project.
import { createHash, timingSafeEqual } from "node:crypto";
import { CLIENT_HEADER, type Scope, type WireScope } from "@strata/contracts";
import { type ApiKeyDoc, apiKeys } from "./collections.ts";
import { config } from "./config.ts";
import { ApiError } from "./http.ts";

export const DEFAULT_ORG = "default";

export type Principal =
  | { kind: "service"; label: string; client: string | null }
  | { kind: "key"; userId: string; keyId: string; label: string; client: string | null };

export const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// How often a key's "last used" is written: enough to show a client is connected, without a write per request.
const TOUCH_EVERY_MS = 30_000;

export async function authenticate(request: Request): Promise<Principal> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) throw new ApiError(401, "unauthorized", "Send your API key as: Authorization: Bearer <key>.");
  const client = request.headers.get(CLIENT_HEADER)?.slice(0, 80) ?? null;
  const service = config().serviceToken;
  if (service && sameSecret(token, service)) return { kind: "service", label: "service token", client };
  if (!token.startsWith("am_")) throw new ApiError(401, "unauthorized", "That token isn't valid.");
  const key = await apiKeys().findOne({ hash: hashKey(token), revokedAt: null });
  if (!key) throw new ApiError(401, "unauthorized", "That API key isn't valid, or it was revoked.");
  void touch(key, client);
  return { kind: "key", userId: key.userId, keyId: key._id.toHexString(), label: key.name, client };
}

async function touch(key: ApiKeyDoc, client: string | null): Promise<void> {
  const now = new Date();
  if (key.lastUsedAt && now.getTime() - key.lastUsedAt.getTime() < TOUCH_EVERY_MS && key.lastClient === client) return;
  await apiKeys()
    .updateOne({ _id: key._id }, { $set: { lastUsedAt: now, lastClient: client } })
    .catch(() => undefined);
}

// The full scope a request acts in. A key may leave org and user out; it may not name others.
export function scopeFor(principal: Principal, wire: WireScope): Scope {
  if (principal.kind === "service")
    return { org: wire.org ?? DEFAULT_ORG, project: wire.project, user: wire.user ?? "service" };
  if (wire.org && wire.org !== DEFAULT_ORG)
    throw new ApiError(403, "forbidden_scope", `This key doesn't cover the organisation "${wire.org}".`);
  if (wire.user && wire.user !== principal.userId)
    throw new ApiError(403, "forbidden_scope", "This key covers only its own person's memory.");
  return { org: DEFAULT_ORG, project: wire.project, user: principal.userId };
}

export function actorOf(principal: Principal): { kind: "service" | "key"; id: string; label: string } {
  return principal.kind === "service"
    ? { kind: "service", id: "service", label: principal.label }
    : { kind: "key", id: principal.keyId, label: principal.label };
}
