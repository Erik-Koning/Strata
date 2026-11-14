# Strata for OpenCode

Capture what happens in your OpenCode sessions, have Strata draft records from it on the server, and review or
approve them from the terminal or the web app. Nothing is shared until you approve it.

This is a real OpenCode v2 plugin. It does not reimplement capture: every OpenCode hook is mapped onto the same
entrypoint the Claude Code client uses, so redaction, the event outbox, the summarizer, `/v1` sync and the dashboard
are shared between the two clients.

## Install

Add the plugin to `opencode.jsonc` (project or `~/.config/opencode/`):

```jsonc
{
  "plugins": [{ "package": "./clients/opencode" }]
}
```

Then sign in once. The device flow mints the same `am_…` API key the web app shows on **Connect**; a key is not tied
to a client, so one key works for both Claude Code and OpenCode.

```sh
node clients/claude-code/scripts/strata.mjs login
```

Point the client at your server with `STRATA_URL` (default `http://localhost:9316`, the web app's dev port).

## What it captures

| OpenCode hook                | What Strata records                                                         |
| ---------------------------- | --------------------------------------------------------------------------- |
| `session.hook("prompt")`     | the prompt text, redacted, grouped under the message id                     |
| `tool.hook("execute.after")` | the tool name, outcome, and for a shell command its class and a fingerprint |
| `session.hook("compaction")` | the pre-compaction conversation, as a transcript                            |
| `session.compaction.ended`   | the compaction summary                                                      |
| `experimental.idle`          | the assistant's reply, which ends the turn                                  |
| `session.deleted`            | the end-of-session marker the server drafts from                            |

Tool **output** is never captured. Prompts that are entirely a `<private>` block are skipped.

## Commands

All eleven register under the `strata.` prefix:

`strata.login` · `strata.status` · `strata.sync` · `strata.review` · `strata.note` · `strata.gaps` ·
`strata.overview` · `strata.search` · `strata.rollup` · `strata.project` · `strata.dashboard`

They run the same CLI as the Claude Code plugin (`clients/claude-code/scripts/strata.mjs`), so their behaviour is
identical.

## Local summaries

The server drafts records from ingested events, so capture and review work with no model on your machine. The local
summaries that power `/strata:review`, `/strata:rollup`, `/strata:overview` and `/strata:sync` are written by a
headless call to your own agent CLI. Choose the backend in `~/.strata/config.json`:

```json
{
  "summarizerBackend": "opencode",
  "summaryModel": "anthropic/claude-haiku-4-5"
}
```

- `"claude"` (default) runs `claude -p`.
- `"opencode"` runs `opencode run`, so no Claude Code install is needed.

`STRATA_SUMMARIZER_BACKEND`, `STRATA_OPENCODE_BIN` and `STRATA_CLAUDE_BIN` override these for one run.

## MCP and the skill

The plugin registers the `strata` MCP server (`strata_record`, `strata_search`) through `ctx.mcp.transform` and the
`log-context` skill through `ctx.skill.transform`, both pointed at this plugin's real root.

## Configuration

Settings live in `~/.strata/config.json` and are shared with the Claude Code client:

| Key                  | What it does                          |
| -------------------- | ------------------------------------- |
| `serverUrl`          | the Strata server (`STRATA_URL` wins) |
| `excludedPaths`      | globs of directories never captured   |
| `summarizerBackend`  | `"claude"` or `"opencode"`            |
| `summaryModel`       | the model the summarizer asks for     |
| `maxSummariesPerDay` | the daily cap for summarizer calls    |

`~/.strata/summarizer` is always excluded: it is the summarizer's own working directory, and OpenCode plugins run
inside a long-lived server where the `STRATA_INTERNAL` environment variable cannot isolate them.

Set `STRATA_DISABLED=1` to turn capture off entirely.

## Troubleshooting

- **Nothing is captured.** Check `~/.strata/strata.log` (`STRATA_DEBUG=1` for debug lines) and run
  `node clients/claude-code/scripts/strata.mjs status`.
- **Summaries are not written.** `status` prints the summarizer error. If you use the `opencode` backend, confirm
  `opencode run "hi"` works in a shell.
- **Events pile up** under `~/.strata/events`. They drain on `strata.sync` or the next session end; the event ids are
  the server's idempotency keys, so a retry never stores one twice.

## Tests

```sh
pnpm --filter @strata/opencode test
```

The suite drives the real hook entrypoint through a fake OpenCode host (`tests/fake-opencode.mjs`), and covers each
hook mapping, the session-id and tool-name bridges, the summarizer backend with no `claude` binary present, and that
a throwing hook never reaches the session.
