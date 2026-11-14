// The API, as the plugin uses it: every call has a time budget, and every failure is an error the caller decides about
// (a hook fails open; the flusher backs off). The wire shapes are the contracts package's.
import type {
  CompressRequest,
  CompressResponse,
  EventsResponse,
  ForgetRequest,
  ForgetResponse,
  FrozenResponse,
  MemoryEvent,
  RecallRequest,
  RecallResponse,
  SaveRequest,
  SaveResponse,
} from "@strata/contracts";
import { CLIENT, type Config } from "./config.ts";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// What the plugin needs of the API. The tests hand the hooks a fake with the same shape.
export interface Api {
  events(batch: MemoryEvent[], ms: number): Promise<EventsResponse>;
  recall(body: Omit<RecallRequest, "k"> & { k?: number }, ms: number): Promise<RecallResponse>;
  frozen(query: { sessionID: string; project: string }, ms: number): Promise<FrozenResponse>;
  compress(body: CompressRequest, ms: number): Promise<CompressResponse>;
  forget(body: Partial<ForgetRequest> & Pick<ForgetRequest, "scope">, ms: number): Promise<ForgetResponse>;
  save(body: Partial<SaveRequest> & Pick<SaveRequest, "scope" | "text">, ms: number): Promise<SaveResponse>;
}

export function makeApi(config: Pick<Config, "apiUrl" | "token">): Api {
  async function call<T>(method: "GET" | "POST", path: string, body: unknown, ms: number): Promise<T> {
    const response = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        "x-memory-client": CLIENT,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(ms),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
      throw new ApiError(response.status, typeof message === "string" ? message : `HTTP ${response.status}`);
    }
    return parsed as T;
  }
  return {
    events: (batch, ms) => call("POST", "/api/memory/events", { batch }, ms),
    recall: (body, ms) => call("POST", "/api/memory/recall", body, ms),
    frozen: ({ sessionID, project }, ms) =>
      call("GET", `/api/memory/frozen?${new URLSearchParams({ sessionID, project }).toString()}`, undefined, ms),
    compress: (body, ms) => call("POST", "/api/memory/compress", body, ms),
    forget: (body, ms) => call("POST", "/api/memory/forget", body, ms),
    save: (body, ms) => call("POST", "/api/memory/save", body, ms),
  };
}
