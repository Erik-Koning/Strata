// Where the plugin talks to, and who it shows its token to. No server, no network, no browser.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "../..");

// The store reads STRATA_HOME when it loads, so set it first.
process.env.STRATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "strata-config-"));
delete process.env.STRATA_URL;
const store = await import("../scripts/lib/store.mjs");

afterEach(() => {
  delete process.env.STRATA_URL;
  store.clearAuth();
  fs.rmSync(store.p("config.json"), { force: true });
});

test("with no setting, the plugin talks to the app's own default address", () => {
  const dev = JSON.parse(fs.readFileSync(path.join(REPO, "apps/web/package.json"), "utf8")).scripts.dev;
  const port = /\$\{PORT:-(\d+)\}/.exec(dev)?.[1];
  assert.ok(port, `apps/web's dev script names a default port: ${dev}`);
  const config = fs.readFileSync(path.join(REPO, "apps/web/server/config.ts"), "utf8");
  assert.equal(
    /\bPORT: z\.coerce\.number\(\)[^\n]*\.default\((\d+)\)/.exec(config)?.[1],
    port,
    "server/config.ts agrees",
  );
  assert.equal(store.DEFAULT_SERVER_URL, `http://localhost:${port}`);
  assert.equal(store.serverUrl(), store.DEFAULT_SERVER_URL);
});

test("STRATA_URL wins over config.json, and config.json over the default", () => {
  store.writeJson(store.p("config.json"), { serverUrl: "http://localhost:9326" });
  assert.equal(store.serverUrl(), "http://localhost:9326");
  process.env.STRATA_URL = "https://strata.example.com";
  assert.equal(store.serverUrl(), "https://strata.example.com");
});

test("a token goes only to the server that issued it", () => {
  store.setAuth({ token: "t", user: { name: "Ada" }, serverUrl: "http://localhost:9316/" });
  assert.equal(store.getAuth()?.token, "t", "the same server, written with a trailing slash");
  assert.equal(store.signedInElsewhere(), null);

  process.env.STRATA_URL = "https://strata.example.com";
  assert.equal(store.getAuth(), null, "pointed elsewhere, the plugin reads as signed out");
  assert.equal(store.signedInElsewhere(), "http://localhost:9316/");

  process.env.STRATA_URL = "HTTP://LOCALHOST:9316";
  assert.equal(store.getAuth()?.token, "t", "pointed back, the sign-in is there again");
});

test("a sign-in saved without its server is treated as signed out", () => {
  store.setAuth({ token: "t", user: { name: "Ada" } });
  assert.equal(store.getAuth(), null);
  assert.equal(store.signedInElsewhere(), "a server it didn't record");
});
