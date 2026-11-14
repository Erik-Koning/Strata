// The signals a client works out on the machine, so every client works them out the same way. Pure, and without zod,
// so a plugin can bundle them cheaply.
//
//   classifyCommand   what kind of shell command it was: test, build, typecheck, lint, format, install, git or other
//   commandKey        the command, redacted and normalized, for the client to hash into a fingerprint (fp)
//   ticketRefs        the ticket keys a branch name carries
//
// The command itself never leaves the machine: only its class, and the hash of its key.
import { redact } from "./redact.ts";
import type { CommandClass, Ref } from "./schemas.ts";

// When one line runs several commands, the one that says the most about where time goes wins.
const RANK: CommandClass[] = ["test", "build", "typecheck", "lint", "format", "install", "git"];
const better = (a: CommandClass, b: CommandClass): CommandClass =>
  b !== "other" && (a === "other" || RANK.indexOf(b) < RANK.indexOf(a)) ? b : a;

// Words in front of the command that don't change what it is.
const WRAPPERS = new Set(["sudo", "time", "env", "npx", "bunx", "pnpx", "exec", "nice", "nohup", "command", "timeout"]);
// Package-manager flags that take a value, so the value isn't read as the subcommand.
const VALUED = new Set(["--filter", "-F", "-C", "--dir", "--prefix", "--workspace", "--cwd"]);

const TOOLS: Record<string, CommandClass> = {
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

// A script or make target, by its name.
function byName(name: string): CommandClass | null {
  const n = name.toLowerCase();
  if (/(^|[:_-])(test|tests|spec|e2e|it)([:_-]|$)/.test(n) || n.startsWith("test")) return "test";
  if (/typecheck|type-check|check-types|types|tsc/.test(n)) return "typecheck";
  if (/lint|check/.test(n)) return "lint";
  if (/format|fmt|prettier/.test(n)) return "format";
  if (/build|compile|bundle|dist/.test(n)) return "build";
  if (/^(install|i|ci|add|setup|bootstrap|deps)$/.test(n)) return "install";
  return null;
}

const base = (word: string): string => word.slice(word.lastIndexOf("/") + 1);

// The arguments that aren't flags, with the values of the flags that take one left out.
function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (VALUED.has(arg)) i++;
    else if (!arg.startsWith("-")) out.push(arg);
  }
  return out;
}

function packageManager(manager: string, args: string[]): CommandClass {
  const [sub, next] = positional(args);
  if (!sub) return manager === "yarn" ? "install" : "other";
  if (["install", "i", "ci", "add", "update", "upgrade", "up"].includes(sub)) return "install";
  if (sub === "test" || sub === "t") return "test";
  if (sub === "run" || sub === "run-script") return next ? (byName(next) ?? "other") : "other";
  if (sub === "exec" || sub === "dlx" || sub === "x") return segment(args.slice(args.indexOf(sub) + 1));
  // A script by its name (pnpm lint), else a tool the manager runs directly (yarn jest, pnpm playwright test).
  return byName(sub) ?? segment(args.slice(args.indexOf(sub)));
}

function segment(words: string[]): CommandClass {
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
        .reduce<CommandClass>((best, name) => better(best, byName(name) ?? "other"), "other");
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

// Quotes aren't parsed: a separator inside a quoted argument splits it, which is close enough for a class.
export function classifyCommand(command: string): CommandClass {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0)
    .reduce<CommandClass>((best, words) => better(best, segment(words)), "other");
}

// What a client hashes for a command's fingerprint: redacted first, so a secret on the command line never reaches the
// hash, then with its spacing normalized, so the same command typed twice has one key.
export function commandKey(command: string): string {
  return redact(command).trim().replace(/\s+/g, " ");
}

// Ticket keys in a branch name, as Jira and Linear write them: PAY-412 in feat/PAY-412-invoice-retry. Only upper case
// counts, since in a lower-case branch "fix-2" would pass for a key; the API can match lower-case keys later against
// the projects an organisation actually has.
const KEY = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6})(?![A-Za-z0-9])/g;

export function ticketRefs(branch: string): Ref[] {
  const keys = new Set([...branch.matchAll(KEY)].map((m) => m[1] ?? "").filter(Boolean));
  return [...keys].slice(0, 5).map((id) => ({ type: "ticket", id }));
}
