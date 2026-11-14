// Redaction: the one function the clients run before anything is queued, and the API runs again on ingest. It replaces
// what looks like a secret with a marker naming its kind, so what's stored still reads ("[REDACTED:github-token]") and a
// second pass changes nothing. Pure, and free of dependencies, so a client can bundle it as it is.

interface Pattern {
  kind: string;
  re: RegExp;
  // The part of a match to keep, before the marker (an assignment keeps its name, a URL keeps its user).
  keep?: (match: string, ...groups: string[]) => string;
}

const PATTERNS: Pattern[] = [
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "stripe-key", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { kind: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "memory-api-key", re: /\bam_[A-Za-z0-9_-]{24,}/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // Credentials in a connection string: the user stays, the password goes.
  {
    kind: "url-password",
    re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi,
    keep: (_m, before) => before ?? "",
  },
  { kind: "bearer", re: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/g, keep: (_m, before) => before ?? "" },
  // NAME_TOKEN=value, "password": "value", secret: value, api-key = value
  {
    kind: "secret",
    re: /\b((?:[A-Z][A-Z0-9_]*_)?(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CLIENT_?SECRET)|(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret))(["']?\s*[:=]\s*["']?)([^\s"',;]{8,})/gi,
    keep: (_m, name, sep) => `${name ?? ""}${sep ?? ""}`,
  },
];

const MARKER = /\[REDACTED:[a-z-]+\]/;

export function redact(text: string): string {
  let out = text;
  for (const { kind, re, keep } of PATTERNS) {
    out = out.replace(re, (match: string, ...rest: unknown[]) => {
      if (MARKER.test(match)) return match;
      const groups = rest.filter((g): g is string => typeof g === "string");
      return `${keep ? keep(match, ...groups) : ""}[REDACTED:${kind}]${kind === "url-password" ? (groups[2] ?? "@") : ""}`;
    });
  }
  return out;
}

// Every string inside a JSON-like value, redacted; keys whose names say "secret" lose their value whatever it looks like.
const SECRET_KEY =
  /^(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|client[_-]?secret)$/i;

export function redactDeep<T>(value: T): T {
  return walk(value, null) as T;
}

function walk(value: unknown, key: string | null): unknown {
  if (typeof value === "string") return key && SECRET_KEY.test(key) && value ? "[REDACTED:secret]" : redact(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, null));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
    return out;
  }
  return value;
}
