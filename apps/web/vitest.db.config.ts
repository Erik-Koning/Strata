import { defineConfig } from "vitest/config";
import { localEnv } from "./server/local-env.ts";

// Database and API tests, on a database of their own on MONGODB_URI's server, removed afterwards. The server is the
// environment's MONGODB_URI, or else .env.local's; nothing else comes from .env.local, so the tests stay the same.
const mongoUri = process.env.MONGODB_URI ?? localEnv().MONGODB_URI;

export default defineConfig({
  test: {
    include: ["test/**/*.db.test.ts"],
    env: mongoUri ? { MONGODB_URI: mongoUri } : {},
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
