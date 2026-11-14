import { describe, expect, it } from "vitest";
import { classifyCommand, commandKey, ticketRefs } from "../src/signals.ts";

describe("classifyCommand", () => {
  it.each([
    ["npm test", "test"],
    ["pnpm test", "test"],
    ["pnpm --filter @acme/web run test:unit", "test"],
    ["yarn jest --watch=false", "test"],
    ["npx vitest run src/a.test.ts", "test"],
    ["CI=1 pnpm exec vitest", "test"],
    ["./node_modules/.bin/jest", "test"],
    ["python -m pytest -x", "test"],
    ["uv run pytest tests/", "test"],
    ["go test ./...", "test"],
    ["cargo nextest run", "test"],
    ["./gradlew test", "test"],
    ["make test", "test"],
    ["pnpm playwright test", "test"],
    ["npm run build", "build"],
    ["pnpm build", "build"],
    ["tsc -p .", "build"],
    ["docker build -t app .", "build"],
    ["make", "build"],
    ["tsc --noEmit", "typecheck"],
    ["pnpm typecheck", "typecheck"],
    ["cargo check", "typecheck"],
    ["mypy src", "typecheck"],
    ["biome check .", "lint"],
    ["npx eslint src", "lint"],
    ["ruff check .", "lint"],
    ["prettier --check .", "lint"],
    ["prettier --write .", "format"],
    ["cargo fmt", "format"],
    ["pnpm install --frozen-lockfile", "install"],
    ["npm ci", "install"],
    ["yarn", "install"],
    ["pip install -r requirements.txt", "install"],
    ["bundle install", "install"],
    ["git status", "git"],
    ["gh pr view 12", "git"],
    ["cd services/invoices && pnpm test", "test"],
    ["pnpm install && pnpm build && pnpm test", "test"],
    ["git add -A && git commit -m 'x'", "git"],
    ["ls -la", "other"],
    ["cat .env", "other"],
    ["curl -s https://example.com | jq .", "other"],
    ["", "other"],
  ])("%s is %s", (command, expected) => {
    expect(classifyCommand(command)).toBe(expected);
  });
});

describe("commandKey", () => {
  it("redacts before anything else, so a secret never reaches the fingerprint", () => {
    const key = commandKey("curl -H 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789' api");
    expect(key).not.toContain("ghp_");
    expect(key).toContain("[REDACTED:");
  });

  it("gives the same key however the command was spaced", () => {
    expect(commandKey("  pnpm   test\n --run ")).toBe(commandKey("pnpm test --run"));
  });
});

describe("ticketRefs", () => {
  it("finds upper-case ticket keys, once each", () => {
    expect(ticketRefs("feat/PAY-412-invoice-retry")).toEqual([{ type: "ticket", id: "PAY-412" }]);
    expect(ticketRefs("PAY-412+PAY-413/PAY-412")).toEqual([
      { type: "ticket", id: "PAY-412" },
      { type: "ticket", id: "PAY-413" },
    ]);
  });

  it("ignores lower-case look-alikes and keys inside words", () => {
    expect(ticketRefs("fix-2-flaky-tests")).toEqual([]);
    expect(ticketRefs("main")).toEqual([]);
    expect(ticketRefs("xPAY-412")).toEqual([]);
  });
});
