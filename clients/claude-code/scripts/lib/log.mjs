import fs from "node:fs";
import { p } from "./store.mjs";

const MAX_BYTES = 512 * 1024;

// Hooks are silent by design, so a log file is the only way to diagnose them.
// Metadata only: never prompt, reply or file content.
export function log(level, message, meta = {}) {
  if (level === "debug" && process.env.STRATA_DEBUG !== "1") return;
  try {
    const file = p("strata.log");
    fs.mkdirSync(p(), { recursive: true, mode: 0o700 });
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      // no log yet
    }
    fs.appendFileSync(file, `${JSON.stringify({ t: new Date().toISOString(), level, message, ...meta })}\n`, {
      mode: 0o600,
    });
  } catch {
    // logging must never break a hook
  }
}
