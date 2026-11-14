---

description: List open context gaps in this repo, or mark one as answered
argument-hint: [resolve <number>]
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" gaps $ARGUMENTS` and show its output as-is. Gaps are numbered; `resolve 2` marks the second as answered so later sessions stop being told about it.
