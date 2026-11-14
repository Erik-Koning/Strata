# Direction

<!-- The operator's standing direction: what the planner derives product decisions from, so that it asks you only
what this doesn't settle (Article 3). Write principles, not features: each line should settle a family of
questions. The setup agent drafts it from the interview; add to it whenever an answer you gave the planner should
hold next time. It's compiled into every member's prompt (comments like this one aren't), and agents never change
it. The planner's own rulings go in decisions.md. -->

The operator wasn't asked for a standing direction: the team was set up unattended. Every line below is quoted from
their goal (`brief.md`); the rest of each section is left for them to fill.

## What the product is for, and who it serves

<!-- Who uses it, what they're doing when they do, and what they'd thank you for. -->

Quoted from the goal:

- "opencode extension, latest version, backend full stack nextjs app, MongoDB connected for agentic memory"
- "Thin V2 server plugin: capture session activity, send it to our web app API, inject recalled memory without
  breaking prompt cache. Only the API touches MongoDB."

Who the people are (the developers whose OpenCode sessions are remembered, and whoever governs the memory) wasn't
asked.

## When goals conflict

<!-- An ordered list of what wins over what. For example: the safety of people's data; their trust in what the
product shows them; their speed; cost. -->

No ordering was asked for. The goal's rules settle these conflicts in the operator's words:

- "Cache: bytes already sent in a session never change." (the prompt cache over fresher memory)
- "Network only in prompt (800ms, fail open) and compaction (5s, else default). context reads ctx.storage only." (the
  session proceeding over memory being available)
- "Writes go through a durable outbox with idempotency keys." (no lost and no duplicated capture over simplicity)
- "Redact secrets before enqueue and again on server. Token from env." (secrets never stored over completeness)
- "only user-turn content auto-promotes to active" (trust in what's recalled over recall coverage)

## Decide without asking

<!-- Kinds of question the planner settles itself, beyond what Article 3 already leaves to it. -->

The operator wasn't asked.

## Always ask me

<!-- Kinds of question that come to you whatever this says, beyond Article 3's list. -->

The operator wasn't asked.
