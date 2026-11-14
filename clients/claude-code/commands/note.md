---

description: Log an insight, workflow finding, pain point or context gap to this session's draft
argument-hint: <insight|workflow|pain-point|gap> <one sentence>
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" note $ARGUMENTS` and report the result in one line. If the user gave only a sentence and no kind, pick the closest kind (insight, workflow, pain-point or gap) and say which you chose.
