---

description: Review the session drafts waiting for you and approve them from the terminal
allowed-tools: Bash(node:*), AskUserQuestion
---

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" review` and show the drafts it prints.
2. For each draft, ask with AskUserQuestion: Approve, Leave for later, or Edit in the dashboard.
3. For Approve, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" approve <sessionId>`. For Edit, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" dashboard`.
4. Tell the user approved drafts are sent with /strata:sync.
