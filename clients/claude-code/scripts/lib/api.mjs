import { serverUrl } from "./store.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// A bearer token and a team's work context must not cross the network in the clear.
function checkTransport(base) {
  const url = new URL(base);
  if (url.protocol === "https:" || LOCAL_HOSTS.has(url.hostname) || process.env.STRATA_ALLOW_INSECURE === "1") return;
  throw Object.assign(new Error(`refusing to send credentials to ${url.origin} over plain http; use https`), {
    code: "insecure_url",
  });
}

export async function api(method, route, body, { token, timeoutMs = 10_000, headers = {} } = {}) {
  const base = serverUrl();
  checkTransport(base);
  const res = await fetch(base + route, {
    method,
    // A redirect could carry the request somewhere that was never approved.
    redirect: "error",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = null; // not JSON: a proxy or captive-portal page, never a server answer
  }
  if (!res.ok) {
    throw Object.assign(new Error(json?.error_description || json?.error || res.statusText), {
      status: res.status,
      code: json?.error,
    });
  }
  if (json === null) throw Object.assign(new Error("response was not JSON"), { status: 502, code: "not_json" });
  return json;
}

/** POST /api/memory/events: a batch of versioned events, deduped by the server on each event's id. */
export const apiEvents = (batch, token, timeoutMs = 10_000) =>
  api("POST", "/api/memory/events", { batch }, { token, timeoutMs });
