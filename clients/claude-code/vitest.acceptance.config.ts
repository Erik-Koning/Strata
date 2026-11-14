// The acceptance list, run against the built plugin (dist/) as Claude Code runs it: a process per hook, JSON on stdin.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test-acceptance/**/*.test.ts"],
    globalSetup: ["test-acceptance/build.setup.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
