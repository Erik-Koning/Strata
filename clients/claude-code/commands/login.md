---

description: Sign in to Strata
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" login`. It opens the browser and waits for the user to confirm the code. Relay the code and the result to the user. Do not ask for or handle any password or token.
