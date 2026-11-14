// Bundles the plugin's three entries into dist/ (committed), so it installs and runs from the repository with no
// install step and no dependencies: hook.mjs (every hook), flush.mjs (the background flusher), mcp.mjs (the tools).
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")) as {
  version: string;
};

rmSync(join(root, "dist"), { recursive: true, force: true });
await build({
  entryPoints: { hook: "src/hook.ts", flush: "src/flush.ts", mcp: "src/mcp.ts" },
  absWorkingDir: root,
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: "// Strata for Claude Code. Built from src/ by build.ts: edit those, not this." },
  logLevel: "warning",
});
console.log(`built dist/ (strata ${version})`);
