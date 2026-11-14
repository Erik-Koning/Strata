# Strata for Claude Code

A Claude Code plugin that gives Claude long-term memory from the Strata web app. It does three things:

- **Captures** each session: your prompts, the names of the tools Claude used, whether they worked and how long they
  ran, Claude's replies, the transcript before a compaction, and where the work is (repository, branch, commit,
  folder). For a shell command it records what kind of command it was (test, build, lint and so on) and a fingerprint
  to count re-runs, never the command or its output. Secrets are redacted before anything is written down.
- **Recalls** what matters: a frozen block of long-term memory when a session starts, and the memories that match
  each prompt, added with that prompt.
- **Gives Claude three tools:** `memory_search`, `memory_save` and `memory_forget`.

It never breaks the prompt cache (below), and it never makes a prompt wait more than 800 ms for memory.

## Install

From a clone of this repository, in Claude Code:

```
/plugin marketplace add /path/to/strata
/plugin install strata@strata
```

Or in your shell: `claude plugin marketplace add /path/to/strata` then
`claude plugin install strata@strata`. To try it for one session without installing:
`claude --plugin-dir /path/to/strata/clients/claude-code`.

The plugin runs on Node.js 22 or later (`node` on your `PATH`) and needs no `npm install`: `dist/` holds the built
hooks and server.

## Connect it

Make an API key on the web app's **Connect** page. Then either:

- answer the two questions Claude Code asks when you enable the plugin (the address and the key; the key is kept in
  your system's credential store), or
- set them in your environment, which wins over those answers. In `~/.claude/settings.json`:

```json
{
  "env": {
    "MEMORY_API_URL": "http://localhost:9316",
    "MEMORY_API_TOKEN": "am_…"
  }
}
```

Without both an address and a key, the plugin does nothing at all.

| Setting            | What it does                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `MEMORY_API_URL`   | The web app's address                                                                                                 |
| `MEMORY_API_TOKEN` | An API key from the Connect page                                                                                      |
| `MEMORY_PROJECT`   | The project memories belong to. By default, the repository's git origin (`github.com/acme/app`), else its folder name |
| `MEMORY_HOME`      | Where the plugin keeps its outbox and each session's frozen block. By default the plugin's data folder in Claude Code |

## What each hook does

| Hook                                | What it does                                                                                                                                             | Network                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `SessionStart`                      | Sends the session's frozen block (below), and captures the repository, branch, commit and folder                                                         | Once per session, 800 ms, else nothing |
| `UserPromptSubmit`                  | Captures the prompt, recalls matching memories and adds them with this prompt only                                                                       | 800 ms, else nothing                   |
| `PostToolUse`, `PostToolUseFailure` | Captures the tool's name, how it ended and how long it ran; for a shell command, its kind, exit code and fingerprint. Never its input or output          | None (runs in the background)          |
| `PreCompact`                        | Captures the transcript and asks the API to compress it. Prints nothing, because what a PreCompact hook prints becomes instructions for Claude's summary | 5 s, else nothing                      |
| `PostCompact`                       | Captures the summary Claude Code made                                                                                                                    | None                                   |
| `Stop`                              | Captures Claude's last message, and the branch or commit if either changed; starts the flusher                                                           | None                                   |
| `SessionEnd`                        | Starts the flusher                                                                                                                                       | None                                   |

Capture never waits on the network. Every event goes to a durable outbox on disk, one file each, with a unique id that
is also its idempotency key. A flusher, started in the background, sends them in batches of up to 100 and deletes
only what the API acknowledged. If the API is down, the events wait and the flusher backs off (1 s, doubling, up to 5
minutes); nothing is lost and nothing arrives twice.

## Why it keeps the prompt cache

The provider caches the start of a conversation. If any byte already sent changes, the cache is thrown away and the
next request costs the whole conversation again. So:

- **The frozen block is fetched once,** when the session starts, rendered sorted by id with no timestamps or counts,
  and kept on disk. A resumed session, a restarted Claude Code or a start hook that runs twice sends the same bytes.
  A failed fetch freezes it empty, and a session resumed with history but no kept block stays empty.
- **Recall goes with the new prompt only.** It is added alongside that message and never changes what came before.
  The frozen block is never sent again.
- **The block is refreshed only after a compaction,** when Claude Code rebuilds the conversation and the cache with
  it. If that refresh fails, the old block stays.
- **The tool list never changes:** the three tools are listed whether or not the plugin is connected.

## Development

```
pnpm build             # bundles src/ into dist/ (commit dist/)
pnpm test              # unit tests, against a fake API
pnpm test:acceptance   # the built hooks as Claude Code runs them, one process per hook
pnpm typecheck
```
