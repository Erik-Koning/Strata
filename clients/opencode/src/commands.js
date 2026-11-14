// All eleven Claude Code slash commands, registered through OpenCode's command transform. Registration is
// used rather than `.opencode/commands/*.md` because a markdown command cannot resolve the plugin's own
// root, and these all shell out to scripts/strata.mjs.
import { captureDisabled, log, runCli } from "./hook.js";

const output = (result) =>
  [result.out, result.err]
    .filter((part) => part?.trim())
    .join("\n")
    .trim();

/** Post a synthetic message so the engineer sees the CLI's output, and the agent knows not to re-summarize it. */
async function tell(ctx, sessionID, text) {
  if (!text) return;
  try {
    await ctx.session.synthetic({ sessionID, text });
  } catch (error) {
    log("warn", "opencode: could not post command output", { error: String(error?.message ?? error) });
  }
}

export async function registerCommands(ctx) {
  const directory = ctx.location?.directory;

  const run = async (args) => {
    const result = await runCli(args, { cwd: directory });
    return output(result);
  };

  const simple = (name, description, args) => ({
    name,
    description,
    execute: async ({ sessionID, prompt }) => tell(ctx, sessionID, await run(args(prompt?.text ?? ""))),
  });

  const definitions = [
    simple("strata.status", "Show the Strata sign-in, project, Jira/PR links and upload queue", () => ["status"]),
    simple("strata.sync", "Sync turns saved on this machine to Strata now", () => ["sync"]),
    simple("strata.overview", "Show what the next session in this repo is told about earlier sessions", () => [
      "overview",
    ]),
    simple("strata.rollup", "Show sessions grouped by Jira ticket or PR", (text) => split(["rollup"], text)),
    simple("strata.search", "Search what teammates and earlier sessions recorded", (text) => split(["search"], text)),
    simple("strata.gaps", "List open context gaps in this repo, or mark one as answered", (text) =>
      split(["gaps"], text),
    ),
    simple("strata.note", "Log an insight, workflow finding, pain point or context gap to this draft", (text) =>
      split(["note"], text),
    ),
    simple("strata.dashboard", "Open the local Strata dashboard", () => ["dashboard"]),
    simple("strata.login", "Sign in to Strata", () => ["login"]),

    // Projects: list them, then let the agent ask which one this repo belongs to.
    {
      name: "strata.project",
      description: "Choose which team project this repo's sessions are sent to",
      execute: async ({ sessionID }) => {
        const listed = await run(["projects", "--json"]);
        await tell(
          ctx,
          sessionID,
          `${listed}\n\nAsk the user which project this repo belongs to, then run:\n  node <strata>/scripts/strata.mjs use <projectId>`,
        );
      },
    },

    // Review: the drafts, then per-draft approve instructions. Approving is a separate CLI call.
    {
      name: "strata.review",
      description: "Review the session drafts waiting for you and approve them from the terminal",
      execute: async ({ sessionID }) => {
        const listed = await run(["review"]);
        await tell(
          ctx,
          sessionID,
          `${listed}\n\nFor each draft, ask the user: Approve, Leave for later, or Edit in the dashboard.\nApprove with \`node <strata>/scripts/strata.mjs approve <sessionId>\`; edit with the strata.dashboard command. Approved drafts are sent with strata.sync.`,
        );
      },
    },
  ];

  if (captureDisabled()) return;

  try {
    await ctx.command.transform((editor) => {
      for (const definition of definitions) editor.add(definition);
    });
  } catch (error) {
    log("warn", "opencode: could not register commands", { error: String(error?.message ?? error) });
  }
}

/** Split a command's argument text into argv, honouring quotes. */
function split(base, text) {
  const words = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    words.push(match[1] ?? match[2] ?? match[3]);
  }
  return [...base, ...words];
}
