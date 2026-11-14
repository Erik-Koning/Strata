import { defineConfig } from "vitest/config";

// Database and API tests, on a database of their own on MONGODB_URI's server, dropped afterwards.
export default defineConfig({
  test: { include: ["test/**/*.db.test.ts"], testTimeout: 60_000, hookTimeout: 180_000, fileParallelism: false },
});
