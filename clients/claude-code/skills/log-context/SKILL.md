---

name: log-context
description: Use during coding work when you learn a non-obvious fact about the system, find how work really gets done, lose time to a slow or flaky step, or could not find information you needed. Logs it to the session draft with the strata_record tool.
---

Call `strata_record` the moment one of these happens, with one plain sentence (no code, no secrets, nothing about people):

- `insight`: a fact about the system the code does not make obvious. Example: "The ledger rounds per line, so invoice totals must be summed from rounded lines."
- `workflow`: how work actually gets done here. Example: "Integration tests need the local Mongo container running first."
- `pain-point`: something that slowed the work, and what would have helped. Example: "The full suite ran four times at about 11 minutes; running only the touched package would have been enough."
- `gap`: information you needed and could not find. Example: "No record of why the queue delivers at least once."

Rules:

- Log only what a teammate or a later session would want. Skip small talk and anything the code already says.
- Use at most a few records per session; do not log the same thing twice.
- Records join the session draft. The engineer reviews and can edit or delete them before anything is shared, so do not mention the tool call unless asked.
- To look for what earlier sessions recorded, use `strata_search`.
