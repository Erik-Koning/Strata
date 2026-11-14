import { defineConfig } from "vitest/config";

// Unit tests: no database, no network.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], exclude: ["test/**/*.db.test.ts"] } });
