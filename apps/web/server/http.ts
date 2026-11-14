// Every API route answers the same way: the body the contract names on success, { error: { code, message } } on
// failure. Bodies are checked against the contract at the edge, before anything else reads them.
import type { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: unknown[];
  constructor(status: number, code: string, message: string, issues?: unknown[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function failure(error: unknown): Response {
  if (error instanceof ApiError)
    return json(
      { error: { code: error.code, message: error.message, ...(error.issues ? { issues: error.issues } : {}) } },
      error.status,
    );
  console.error("api:", error);
  return json({ error: { code: "internal", message: "Something went wrong on our side. Try again." } }, 500);
}

export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "bad_json", "The body isn't JSON.");
  }
  return check(schema, raw);
}

export function check<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ApiError(
      400,
      "invalid",
      parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
      parsed.error.issues,
    );
  return parsed.data;
}

// A route handler with the error envelope around it.
export const route =
  <A extends unknown[]>(handler: (request: Request, ...rest: A) => Promise<Response>) =>
  async (request: Request, ...rest: A): Promise<Response> => {
    try {
      return await handler(request, ...rest);
    } catch (error) {
      return failure(error);
    }
  };
