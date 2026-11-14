// One headless model call for the summarizer, behind one function. The Claude Code client calls the `claude`
// CLI; the OpenCode client calls `opencode run`. Both are the engineer's own tooling and their own model
// subscription, so Strata ships no key and pays for nothing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { p, settings } from "./store.mjs";

const CALL_TIMEOUT_MS = 120_000;

export const claudeBin = () => process.env.STRATA_CLAUDE_BIN || settings().claudeBin || "claude";
export const opencodeBin = () => process.env.STRATA_OPENCODE_BIN || settings().opencodeBin || "opencode";
export const summaryModel = () => settings().summaryModel || "haiku";
export const summarizerBackend = () => {
  const configured = process.env.STRATA_SUMMARIZER_BACKEND || settings().summarizerBackend;
  return configured === "opencode" ? "opencode" : "claude";
};

// Own empty working directory, so no repo files are picked up.
const runIn = (bin, args, { env, input }) =>
  new Promise((resolve, reject) => {
    const cwd = p("summarizer");
    fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("summarizer timed out"));
    }, CALL_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new Error(`the ${bin} CLI was not found`) : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`summarizer exited ${code}: ${err.slice(0, 160)}`));
      resolve(out);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });

/**
 * Ask the engineer's own agent CLI for one model reply. No tools, no slash commands, no project settings,
 * and STRATA_INTERNAL so the summarizer is never itself summarized.
 */
export async function runModel(prompt, system) {
  if (summarizerBackend() === "opencode") {
    // `opencode run` takes the prompt as an argument; the system text is prepended, since the CLI has no
    // separate system-prompt flag.
    const text = `${system}\n\n${prompt}`;
    const out = await runIn(opencodeBin(), ["run", "--model", summaryModel(), text], {
      env: { STRATA_INTERNAL: "1" },
    });
    return out.trim();
  }
  const out = await runIn(
    claudeBin(),
    [
      "-p",
      "--model",
      summaryModel(),
      "--tools",
      "",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--setting-sources",
      "local",
      "--max-budget-usd",
      "0.05",
      "--system-prompt",
      system,
    ],
    { env: { STRATA_INTERNAL: "1" }, input: prompt },
  );
  try {
    const doc = JSON.parse(out);
    if (doc.is_error || typeof doc.result !== "string")
      throw new Error(String(doc.result ?? "no result").slice(0, 160));
    return doc.result;
  } catch (e) {
    throw new Error(`unreadable summarizer output: ${e.message}`);
  }
}
