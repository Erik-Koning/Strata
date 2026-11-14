// The MCP server (strata_record / strata_search) and the log-context skill, registered through OpenCode's
// transforms so they point at this plugin's real root rather than a literal ${CLAUDE_PLUGIN_ROOT}.
import fs from "node:fs";
import path from "node:path";
import { log, mcpPath, pluginRoot } from "./hook.js";

const SKILL_FILE = path.join(pluginRoot(), "skills", "log-context", "SKILL.md");

/** Read the shared log-context skill and split its YAML frontmatter from the body. */
function readSkill() {
  try {
    const raw = fs.readFileSync(SKILL_FILE, "utf8");
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
    if (!match) return null;
    const description = /^description:\s*(.*)$/m
      .exec(match[1])?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    const name =
      /^name:\s*(.*)$/m
        .exec(match[1])?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "") || "log-context";
    return { name, description, content: match[2].trim(), path: SKILL_FILE };
  } catch {
    return null;
  }
}

export async function registerMcpAndSkill(ctx) {
  try {
    await ctx.mcp.transform((editor) => {
      editor.set("strata", {
        type: "local",
        command: [process.execPath, mcpPath()],
        environment: { STRATA_ROOT: pluginRoot() },
      });
    });
  } catch (error) {
    log("warn", "opencode: could not register the Strata MCP server", { error: String(error?.message ?? error) });
  }

  const skill = readSkill();
  if (!skill) return;
  try {
    await ctx.skill.transform((editor) => {
      editor.add({
        id: "strata-log-context",
        name: skill.name,
        description: skill.description,
        autoinvoke: true,
        path: skill.path,
        content: skill.content,
      });
    });
  } catch (error) {
    log("warn", "opencode: could not register the log-context skill", { error: String(error?.message ?? error) });
  }
}
