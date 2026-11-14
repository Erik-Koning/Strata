---

description: Upload events captured on this machine to the Strata server now
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" flush-events` and show its output as-is. Events upload on their own as they are captured; this only forces a retry. Drafts are reviewed on the server's My Day page, not here.
