// Client-side redaction, the first line of defence: secrets never leave the engineer's
// machine. The server must redact again. Bounded whitespace (no quadratic backtracking),
// values must contain a letter (so `max_tokens=4096` survives), and bare `token`/`secret`
// words only count in config-shaped positions (so `const token = getToken()` survives).
const MARK = "[redacted]";
const VALUE_CLASS = String.raw`[A-Za-z0-9_.\-+/=~@#$%^*!?]`;
// 8+ value chars with at least one letter, not followed by more value chars or a call paren.
const VALUE = String.raw`(?=${VALUE_CLASS}{8})${VALUE_CLASS}*[A-Za-z]${VALUE_CLASS}*(?![\w.\-+/=~@#$%^*!?]|\()`;
const Q = String.raw`(?:\\{0,3}["'])?`;
const SP = String.raw`\s{0,8}`;

// Patterns that replace the whole match.
const WHOLE = [
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // aws access key
  /\bgh[oprsu]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, // github
  /\bsk-ant-[A-Za-z0-9_-]{20,}(?!\w)/g, // anthropic
  /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}(?!\w)/g, // openai-style
  /\b(?:xox[abeprs]|xapp)-[A-Za-z0-9-]{10,}(?!\w)/g, // slack
  /\bhooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/]{20,}/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?!\w)/g, // jwt
  /\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}|whsec_[A-Za-z0-9]{32,})\b/g, // stripe
  /\bAIza[0-9A-Za-z_-]{35}(?!\w)/g, // google api key
  /\bya29\.(?:c\.)?[0-9A-Za-z_-]{20,}(?!\w)/g, // google oauth
  /\bgl(?:pat|dt|rt)-[A-Za-z0-9_-]{20,}(?!\w)/g, // gitlab
  /\bhf_[A-Za-z0-9]{30,}\b/g, // huggingface
  /\bnpm_[A-Za-z0-9]{36}\b/g, // npm
  /\bdckr_pat_[A-Za-z0-9_-]{27,}(?!\w)/g, // docker
  /\blin_api_[A-Za-z0-9]{40}(?!\w)/g, // linear
  /\bATATT3[A-Za-z0-9_=-]{100,}(?![\w=-])/g, // atlassian (Jira/Confluence) api token
  /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![\w-])/g, // sendgrid
  /\bpypi-AgE[A-Za-z0-9_-]{50,}(?!\w)/g, // pypi
  /\bsbp_[a-f0-9]{40}(?!\w)/g, // supabase
];

// Patterns where only the value (group 2) is replaced, so the key stays readable.
const KEYED = [
  // password in any spelling: DB_PASSWORD=..., "password": "...", passwd: ...
  new RegExp(String.raw`(\b\w*(?:password|passwd|pwd)\w*${Q}${SP}[=:]${SP}${Q})(${VALUE})`, "gi"),
  // *_token / *_secret / *_api_key / *_key style names
  new RegExp(
    String.raw`(\b\w+_(?:token|secret|api_?key|access_?key|private_?key)${Q}${SP}[=:]${SP}${Q})(${VALUE})`,
    "gi",
  ),
  // quoted JSON/YAML key: "secret": "...", "token": "...", "api_key": "..."
  new RegExp(
    String.raw`(\\{0,3}["'](?:token|secret|api_?key|apikey)\\{0,3}["']${SP}:${SP}\\{0,3}["'])(${VALUE})`,
    "gi",
  ),
  // bare env/query assignment with no spaces: token=..., ?api_key=..., export secret=...
  new RegExp(String.raw`((?:^|[\s?&])(?:token|secret|api_?key|apikey)=${Q})(${VALUE})`, "gim"),
  // CLI flags: --token=..., --auth-token ..., --client-secret ...
  new RegExp(String.raw`(--(?:[a-z0-9]+[-_])*(?:token|secret|api[-_]key)(?:=|[ \t]{1,8})${Q})(${VALUE})`, "gi"),
  // Authorization headers
  new RegExp(
    String.raw`(\bAuthorization${Q}${SP}:${SP}${Q}(?:Bearer|Basic|Token)\s{1,8})([A-Za-z0-9._~+/=-]{8,})`,
    "gi",
  ),
  // cookie headers: whatever the cookie is named, the value is a session credential
  new RegExp(String.raw`(\b(?:set-)?cookie${Q}${SP}[=:]${SP}${Q})([^\\\n\r"'\`<]{4,})`, "gi"),
  // credentials embedded in a URL: scheme://user:PASSWORD@host
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"<>]*:)([^\s/@'"<>]+)(?=@)/gi,
  // aws secret key next to its name
  new RegExp(String.raw`(\b(?:aws_secret_access_key|SecretAccessKey)${Q}${SP}[=:]${SP}${Q})([A-Za-z0-9/+=]{40})`, "gi"),
];

const PRIVATE_FREE_SCAN_CAP = 300_000;

// Cut a string back to a whitespace boundary so a truncation never leaves half a secret.
const trimToBoundary = (text, fromStart) => {
  const idx = fromStart ? text.search(/\s/) : text.search(/\s\S*$/);
  return idx > 0 && idx < 200 ? (fromStart ? text.slice(idx) : text.slice(0, idx)) : text;
};

function headTail(text, maxChars) {
  if (text.length <= maxChars) return text;
  const head = trimToBoundary(text.slice(0, Math.floor(maxChars * 0.7)), false);
  const tail = trimToBoundary(text.slice(-Math.floor(maxChars * 0.3)), true);
  return `${head}\n... [${text.length - head.length - tail.length} chars omitted] ...\n${tail}`;
}

/**
 * Caller strips memory/private tags first (tags.mjs). Oversize input is cut BEFORE the
 * regexes run, so a pasted 10 MB log cannot stall a hook, then cut again to the field cap.
 */
export function redact(text, maxChars = 8000) {
  if (!text) return "";
  let out = headTail(String(text), PRIVATE_FREE_SCAN_CAP);
  for (const re of WHOLE) out = out.replace(re, MARK);
  for (const re of KEYED) out = out.replace(re, (_match, key) => `${key}${MARK}`);
  return headTail(out, maxChars);
}

// Every string inside a JSON-like payload, redacted. Keys whose names say "secret" lose their value whatever
// it looks like, so a command or tool input that carries a credential cannot slip through as an object field.
const SECRET_KEY =
  /^(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|client[_-]?secret)$/i;

export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) && typeof item === "string" ? MARK : redactDeep(item);
    }
    return out;
  }
  return value;
}
