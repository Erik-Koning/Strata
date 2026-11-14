// The /v1 surface the Strata clients speak. It is deliberately separate from /api/memory: the
// plugin's contract uses OAuth-style error strings (`{ error: "invalid_token" }`), while the
// memory API uses a nested error object. Both share the same bearer key store underneath.
import type { z } from "zod";
import { authenticate, type Principal } from "./api-auth.ts";
import { ApiError } from "./http.ts";

export class V1Error extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const v1Json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function v1Failure(error: unknown): Response {
  if (error instanceof V1Error)
    return v1Json(
      { error: error.code, ...(error.message !== error.code ? { error_description: error.message } : {}) },
      error.status,
    );
  if (error instanceof ApiError)
    return v1Json(
      { error: error.status === 401 ? "invalid_token" : error.code, error_description: error.message },
      error.status,
    );
  console.error("v1:", error);
  return v1Json({ error: "server_error", error_description: "Something went wrong on our side." }, 500);
}

export const v1Route =
  <A extends unknown[]>(handler: (request: Request, ...rest: A) => Promise<Response>) =>
  async (request: Request, ...rest: A): Promise<Response> => {
    try {
      return await handler(request, ...rest);
    } catch (error) {
      return v1Failure(error);
    }
  };

export interface V1User {
  userId: string;
  keyId: string;
  label: string;
  client: string | null;
}

// Only a person's key can act here; the service token has no author to attribute a summary to.
export async function requireUser(request: Request): Promise<V1User> {
  let principal: Principal;
  try {
    principal = await authenticate(request);
  } catch (error) {
    if (error instanceof ApiError)
      throw new V1Error(
        error.status === 401 ? 401 : error.status,
        error.status === 401 ? "invalid_token" : error.code,
        error.message,
      );
    throw error;
  }
  if (principal.kind !== "key")
    throw new V1Error(403, "forbidden", "This route needs a person's API key, not the service token.");
  return { userId: principal.userId, keyId: principal.keyId, label: principal.label, client: principal.client };
}

export async function readObject(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new V1Error(400, "invalid_request", "The body isn't JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new V1Error(400, "invalid_request", "The body must be a JSON object.");
  return raw as Record<string, unknown>;
}

export function parseV1<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new V1Error(
      400,
      "invalid_request",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "),
    );
  return parsed.data;
}
