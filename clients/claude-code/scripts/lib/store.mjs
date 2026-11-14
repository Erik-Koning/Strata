import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = process.env.STRATA_HOME || path.join(os.homedir(), ".strata");
export const p = (...segments) => path.join(HOME, ...segments);

// This plugin used to be called delivery-hub and kept its data in ~/.delivery-hub. Move it over once,
// so sessions, sign-in and settings survive the rename. Only for the default location.
if (!process.env.STRATA_HOME) {
  const legacy = path.join(os.homedir(), ".delivery-hub");
  try {
    if (!fs.existsSync(HOME) && fs.existsSync(legacy)) fs.renameSync(legacy, HOME);
  } catch {
    // another hook moved it first, or it is not ours to move: start fresh rather than fail
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return fallback;
  }
}

// Write-then-rename so a hook killed mid-write never leaves a half-written file.
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export const settings = () => readJson(p("config.json"), {});
export const serverUrl = () => process.env.STRATA_URL || settings().serverUrl || "http://localhost:8787";

// The token is a bearer credential: user identity comes from it on the server,
// never from anything this client claims.
export const getAuth = () => readJson(p("auth.json"), null);
export const setAuth = (auth) => writeJson(p("auth.json"), auth);
export const clearAuth = () => fs.rmSync(p("auth.json"), { force: true });

// Bindings are keyed by the repo's shared git dir, so every worktree and subfolder
// of one repo maps to the same project. They stay local, never committed.
export const getBinding = (repoKey) => readJson(p("bindings.json"), {})[repoKey] ?? null;
export function setBinding(repoKey, binding) {
  const all = readJson(p("bindings.json"), {});
  all[repoKey] = binding;
  writeJson(p("bindings.json"), all);
}

export const allBindings = () => readJson(p("bindings.json"), {});
export function removeBinding(repoKey) {
  const all = allBindings();
  delete all[repoKey];
  writeJson(p("bindings.json"), all);
}

const safeId = (id) => id.replace(/[^\w.-]/g, "_");
export const getSession = (id) => readJson(p("sessions", `${safeId(id)}.json`), { turn: 0, private: false });
export const setSession = (id, state) => writeJson(p("sessions", `${safeId(id)}.json`), state);

// Upload health, so repeated failures are surfaced to the engineer instead of
// silently losing days of context.
export const getHealth = () => readJson(p("health.json"), { failures: 0, authExpired: false });
export const setHealth = (health) => writeJson(p("health.json"), health);
export function recordSuccess() {
  const health = getHealth();
  if (health.failures === 0 && !health.authExpired) return;
  setHealth({ failures: 0, authExpired: false, lastSuccessAt: new Date().toISOString() });
}
export function recordFailure(err) {
  const health = getHealth();
  setHealth({
    ...health,
    failures: (health.failures ?? 0) + 1,
    authExpired: health.authExpired || err.status === 401,
    lastError: String(err.message || err).slice(0, 200),
    lastErrorAt: new Date().toISOString(),
  });
}

// "Mention once" nags are rate-limited per kind, so a /clear or a restart does not repeat them.
export function noticeDue(kind, ttlMs = DAY_MS) {
  const notices = readJson(p("notices.json"), {});
  if (Date.now() - (notices[kind] ?? 0) < ttlMs) return false;
  notices[kind] = Date.now();
  writeJson(p("notices.json"), notices);
  return true;
}

export function pruneDir(dir, maxAgeMs) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (Date.now() - fs.statSync(file).mtimeMs > maxAgeMs) fs.rmSync(file, { force: true });
    }
  } catch {
    // directory does not exist yet
  }
}
