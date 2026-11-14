// The one way the real providers call an embeddings API: a timeout on every request, a couple of retries for rate
// limits and server errors, batches of a size the API accepts, and errors that say which setting to check without ever
// repeating the key.

export interface EmbedRequest {
  // For messages: "Voyage AI embeddings".
  label: string;
  url: string;
  // The env var the key came from, named in errors (never its value).
  keyName: string;
  key: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  retries: number;
  dimensions: number;
  count: number;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

export async function postEmbeddings(request: EmbedRequest, fetcher: typeof fetch = fetch): Promise<number[][]> {
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetcher(request.url, {
        method: "POST",
        headers: { authorization: `Bearer ${request.key}`, "content-type": "application/json" },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (attempt < request.retries) {
        await backoff(attempt++);
        continue;
      }
      throw new Error(
        timedOut
          ? `${request.label}: no answer within ${request.timeoutMs} ms`
          : `${request.label}: request failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (res.ok) return parse(request, await res.json());
    if (RETRYABLE.has(res.status) && attempt < request.retries) {
      await backoff(attempt++, res.headers.get("retry-after"));
      continue;
    }
    const detail = (await res.text().catch(() => "")).slice(0, 300).replaceAll(request.key, "[key]");
    const hint =
      res.status === 401 || res.status === 403
        ? ` (check ${request.keyName})`
        : res.status === 429
          ? " (rate limited)"
          : res.status === 400
            ? " (check MEMORY_EMBED_MODEL and MEMORY_EMBED_DIMENSIONS)"
            : "";
    throw new Error(`${request.label}: HTTP ${res.status}${hint}${detail ? `: ${detail}` : ""}`);
  }
}

// Both APIs answer { data: [{ embedding, index }] }; put them back in input order and check every one.
function parse(request: EmbedRequest, json: unknown): number[][] {
  const data = (json as { data?: { embedding?: unknown; index?: number }[] } | null)?.data;
  if (!Array.isArray(data) || data.length !== request.count)
    throw new Error(
      `${request.label}: expected ${request.count} embeddings, got ${Array.isArray(data) ? data.length : "none"}`,
    );
  const out = new Array<number[]>(request.count);
  data.forEach((d, i) => {
    const v = d.embedding;
    if (!Array.isArray(v) || v.length !== request.dimensions || typeof v[0] !== "number")
      throw new Error(
        `${request.label}: an embedding of ${Array.isArray(v) ? v.length : "no"} dimensions, expected ${request.dimensions}`,
      );
    out[typeof d.index === "number" ? d.index : i] = v as number[];
  });
  if (out.some((v) => !v)) throw new Error(`${request.label}: embeddings came back with missing indexes`);
  return out;
}

function backoff(attempt: number, retryAfter?: string | null): Promise<void> {
  const seconds = Number(retryAfter);
  const ms = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : 250 * 2 ** attempt;
  return new Promise((r) => setTimeout(r, ms));
}

export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
