# Moved

The OpenCode client is now a real OpenCode v2 plugin in [`clients/opencode`](../../../opencode).

The old `strata.js` here used the OpenCode V1 plugin API, was discovered from the wrong directory
(`.opencode/plugin/` rather than `.opencode/plugins/`), and never mapped tool signals, prompt ids or compaction
summaries onto the Strata contract. It has been removed.

Install the current client by adding it to `opencode.jsonc`:

```jsonc
{
  "plugins": [{ "package": "./clients/opencode" }]
}
```

See [`clients/opencode/README.md`](../../../opencode/README.md) for install, configuration and troubleshooting.
