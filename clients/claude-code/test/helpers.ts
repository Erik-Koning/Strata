import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeApi } from "../src/api.ts";
import type { Config } from "../src/config.ts";
import { openStore, type Store } from "../src/store.ts";
import { TOKEN } from "./fake-api.ts";

export const tempHome = (): string => mkdtempSync(join(tmpdir(), "strata-test-"));

export function setup(apiUrl: string, home: string = tempHome()): { config: Config; store: Store; home: string } {
  const config: Config = { apiUrl, token: TOKEN, home, project: "github.com/acme/app" };
  return { config, store: openStore(home), home };
}

export const apiFor = (config: Config) => makeApi(config);
