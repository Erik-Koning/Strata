// Rendering what a client puts in front of the model. Both functions are pure: the same memories give the same bytes,
// whenever and wherever they're rendered, because the frozen block is cached by the provider and a single changed byte
// throws the cache away. So: sorted by _id, no timestamps, no counters, no scores.

export interface RenderableMemory {
  _id: string;
  kind: string;
  text: string;
}

// The longest a memory is shown, so one long memory can't crowd out the rest. Cut the same way every time.
const MAX_CHARS = 600;

function line(memory: RenderableMemory): string {
  const text = memory.text.replace(/\s+/g, " ").trim();
  const cut = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
  return `- [${memory.kind}] ${cut}`;
}

const byId = (a: RenderableMemory, b: RenderableMemory): number => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);

// The session's frozen block: fetched once, then the same bytes on every request until the next compaction. Empty
// memories give an empty string, and a client then sends nothing.
export function renderFrozen(memories: readonly RenderableMemory[]): string {
  if (!memories.length) return "";
  const lines = [...memories].sort(byId).map(line);
  return [
    "<memory-frozen>",
    "Long-term memory about this user and project, from earlier sessions. Follow it unless the user says otherwise.",
    ...lines,
    "</memory-frozen>",
  ].join("\n");
}

// What one turn recalled, appended to that turn's prompt only. Nothing already sent changes.
export function renderRecall(memories: readonly RenderableMemory[]): string {
  if (!memories.length) return "";
  return ["<memory>", "Recalled for this message:", ...[...memories].sort(byId).map(line), "</memory>"].join("\n");
}
