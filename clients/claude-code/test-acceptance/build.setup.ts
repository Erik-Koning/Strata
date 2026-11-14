// Builds dist/ before the acceptance tests, so they always run against what's in src/.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync(process.execPath, [join(root, "build.ts")], { cwd: root, stdio: "inherit" });
}
