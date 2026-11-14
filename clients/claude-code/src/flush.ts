// The background flusher (dist/flush.mjs): started detached by the hooks, it sends the outbox until it's empty, the
// API fails (the outbox then backs off), or another flusher holds the lock. Exits 0 whatever happened.
import { makeApi } from "./api.ts";
import { loadConfig } from "./config.ts";
import { flush } from "./outbox.ts";
import { openStore } from "./store.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config) return;
  await flush(openStore(config.home), makeApi(config), { home: config.home, force: process.argv.includes("--force") });
}

main()
  .catch(() => undefined)
  .finally(() => {
    process.exitCode = 0;
  });
