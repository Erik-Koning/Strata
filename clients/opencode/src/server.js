import { Plugin } from "@opencode/plugin";
import { registerCommands } from "./commands.js";
import { log } from "./hook.js";
import { createPlugin } from "./plugin.js";
import { registerMcpAndSkill } from "./registration.js";

// Each registration is independent: a failure in one must not stop the others, and none may break the session.
const attempt = async (label, work) => {
  try {
    return await work();
  } catch (error) {
    log("warn", `opencode: ${label} failed`, { error: String(error?.message ?? error) });
    return null;
  }
};

export default Plugin.define({
  id: "strata",
  async setup(ctx) {
    const stopCapture = await attempt("capture", () => createPlugin(ctx));
    await attempt("commands", () => registerCommands(ctx));
    await attempt("mcp/skill", () => registerMcpAndSkill(ctx));
    return () => stopCapture?.();
  },
});
