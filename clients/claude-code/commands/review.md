---

description: Open My Day in the Strata web app to review and approve the drafts your sessions wrote
allowed-tools: Bash(node:*)
---

Drafts now live on the Strata server, not on this machine. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" flush-events` so everything captured so far is uploaded, then tell the user to open `/my-day` on their Strata server (the `server:` line of `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" status`, without its `/api` suffix) to approve, edit or discard each draft. Do not paste or summarize any session content yourself.
