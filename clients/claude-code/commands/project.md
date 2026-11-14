---

description: Choose which team project this repo's sessions are sent to
allowed-tools: Bash(node:*), AskUserQuestion
---

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" projects --json`. If it says the user is not signed in, tell them to run /strata:login and stop.
2. Ask the user which project this repo belongs to with AskUserQuestion, using each project's `teamName / name` as the label. If there are more than 4, ask for the project name and match it.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" use <projectId>` with the chosen id and report the result in one line.
