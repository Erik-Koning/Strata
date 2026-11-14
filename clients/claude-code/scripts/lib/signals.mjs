// Signals a client works out on the machine, so every client works them out the same way. The command itself
// never leaves the machine: only its class, and the hash of its redacted, normalized key.
import { redact } from "./redact.mjs";

const RANK = ["test", "build", "typecheck", "lint", "format", "install", "git"];
const better = (a, b) => (b !== "other" && (a === "other" || RANK.indexOf(b) < RANK.indexOf(a)) ? b : a);

const WRAPPERS = new Set(["sudo", "time", "env", "npx", "bunx", "pnpx", "exec", "nice", "nohup", "command", "timeout"]);
const VALUED = new Set(["--filter", "-F", "-C", "--dir", "--prefix", "--workspace", "--cwd"]);

const TOOLS = {
  vitest: "test",
  jest: "test",
  mocha: "test",
  ava: "test",
  pytest: "test",
  rspec: "test",
  phpunit: "test",
  karma: "test",
  tap: "test",
  ctest: "test",
  eslint: "lint",
  oxlint: "lint",
  flake8: "lint",
  pylint: "lint",
  "golangci-lint": "lint",
  rubocop: "lint",
  shellcheck: "lint",
  stylelint: "lint",
  mypy: "typecheck",
  pyright: "typecheck",
  "vue-tsc": "typecheck",
  "svelte-check": "typecheck",
  black: "format",
  gofmt: "format",
  rustfmt: "format",
  isort: "format",
  webpack: "build",
  rollup: "build",
  esbuild: "build",
  tsup: "build",
  git: "git",
  gh: "git",
};

function byName(name) {
  const n = String(name).toLowerCase();
  if (/(^|[:_-])(test|tests|spec|e2e|it)([:_-]|$)/.test(n) || n.startsWith("test")) return "test";
  if (/typecheck|type-check|check-types|types|tsc/.test(n)) return "typecheck";
  if (/lint|check/.test(n)) return "lint";
  if (/format|fmt|prettier/.test(n)) return "format";
  if (/build|compile|bundle|dist/.test(n)) return "build";
  if (/^(install|i|ci|add|setup|bootstrap|deps)$/.test(n)) return "install";
  return null;
}

const base = (word) => word.slice(word.lastIndexOf("/") + 1);

function positional(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (VALUED.has(arg)) i += 1;
    else if (!arg.startsWith("-")) out.push(arg);
  }
  return out;
}

function packageManager(manager, args) {
  const [sub, next] = positional(args);
  if (!sub) return manager === "yarn" ? "install" : "other";
  if (["install", "i", "ci", "add", "update", "upgrade", "up"].includes(sub)) return "install";
  if (sub === "test" || sub === "t") return "test";
  if (sub === "run" || sub === "run-script") return next ? (byName(next) ?? "other") : "other";
  if (sub === "exec" || sub === "dlx" || sub === "x") return segment(args.slice(args.indexOf(sub) + 1));
  return byName(sub) ?? segment(args.slice(args.indexOf(sub)));
}

function segment(words) {
  let w = words;
  while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0] ?? "") || WRAPPERS.has(w[0] ?? ""))) w = w.slice(1);
  const [first = "", ...args] = w;
  const program = base(first);
  const [sub] = positional(args);
  switch (program) {
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      if (program === "bun" && sub === "build") return "build";
      return packageManager(program, args);
    case "make":
    case "just":
    case "task":
      return sub ? (byName(sub) ?? "other") : program === "make" ? "build" : "other";
    case "turbo":
    case "nx":
      return positional(args)
        .slice(sub === "run" ? 1 : 0)
        .reduce((best, name) => better(best, byName(name) ?? "other"), "other");
    case "python":
    case "python3":
      return args[0] === "-m" ? segment(args.slice(1)) : "other";
    case "uv":
    case "poetry":
    case "pipenv":
    case "hatch":
      if (sub === "run") return segment(args.slice(args.indexOf("run") + 1));
      return sub && ["sync", "install", "add", "lock"].includes(sub) ? "install" : sub === "build" ? "build" : "other";
    case "pip":
    case "pip3":
      return sub === "install" ? "install" : "other";
    case "bundle":
      if (sub === "exec") return segment(args.slice(args.indexOf("exec") + 1));
      return !sub || sub === "install" ? "install" : "other";
    case "cargo":
      if (sub === "test" || sub === "nextest") return "test";
      if (sub === "build") return "build";
      if (sub === "check") return "typecheck";
      if (sub === "clippy") return "lint";
      if (sub === "fmt") return "format";
      return sub === "fetch" ? "install" : "other";
    case "go":
      if (sub === "test") return "test";
      if (sub === "build") return "build";
      if (sub === "vet") return "lint";
      if (sub === "fmt") return "format";
      return sub === "mod" || sub === "get" ? "install" : "other";
    case "mvn":
    case "mvnw":
    case "gradle":
    case "gradlew": {
      const goals = positional(args);
      if (goals.some((g) => /test|check|verify/.test(g))) return "test";
      return goals.some((g) => /build|package|compile|assemble|install/.test(g)) ? "build" : "other";
    }
    case "dotnet":
    case "swift":
      if (sub === "test") return "test";
      if (sub === "build") return "build";
      return sub === "restore" ? "install" : "other";
    case "tsc":
      return args.includes("--noEmit") ? "typecheck" : "build";
    case "docker":
      return sub === "build" ? "build" : "other";
    case "next":
    case "vite":
    case "astro":
    case "nuxt":
      return sub === "build" ? "build" : "other";
    case "playwright":
    case "cypress":
      return sub === "test" || sub === "run" ? "test" : sub === "install" ? "install" : "other";
    case "biome":
      return sub === "format" ? "format" : sub === "check" || sub === "lint" || sub === "ci" ? "lint" : "other";
    case "ruff":
      return sub === "format" ? "format" : "lint";
    case "prettier":
      return args.includes("--check") ? "lint" : "format";
    default:
      return TOOLS[program] ?? "other";
  }
}

export function classifyCommand(command) {
  return String(command)
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0)
    .reduce((best, words) => better(best, segment(words)), "other");
}

export function commandKey(command) {
  return redact(command).trim().replace(/\s+/g, " ");
}

// Upper-case ticket keys in a branch name: PAY-412 in feat/PAY-412-invoice-retry.
const KEY = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6})(?![A-Za-z0-9])/g;

export function ticketRefs(branch) {
  const keys = new Set([...String(branch).matchAll(KEY)].map((match) => match[1] ?? "").filter(Boolean));
  return [...keys].slice(0, 5).map((id) => ({ type: "ticket", id }));
}
