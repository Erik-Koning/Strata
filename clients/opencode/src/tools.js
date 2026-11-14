// OpenCode names tools in lower case (`bash`, `read`, `edit`, `write`, `grep`, `glob`, `list`, ...); the Strata
// core's tool-signal classifier is keyed on the Claude Code names (`Bash`, `Read`, ...). Map the ones that carry
// meaning so shell commands keep their class and fingerprint, and pass anything unrecognised through untouched
// so a future tool is still recorded rather than dropped.
const CANONICAL = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  multiedit: "MultiEdit",
  patch: "Patch",
  grep: "Grep",
  glob: "Glob",
  list: "LS",
  ls: "LS",
  task: "Task",
  todowrite: "TodoWrite",
  todoread: "TodoRead",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  notebookedit: "NotebookEdit",
};

export function canonicalToolName(name) {
  if (typeof name !== "string" || !name) return "unknown";
  return CANONICAL[name] ?? CANONICAL[name.toLowerCase()] ?? name;
}
