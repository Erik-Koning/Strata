// Ported from claude-mem's tag stripping: a linear scanner (no regex backtracking, so
// a hostile "<private" x 100000 payload cannot stall a hook) that removes balanced
// blocks of the tags below, including nested and mis-nested ones.
//
// An unclosed tag in ordinary prose ("explain how <private> works") is left alone:
// a tag is removed only when a real close tag exists.
const STRIPPED_TAGS = new Set([
  "private",
  "system-reminder",
  "system_instruction",
  "system-instruction",
  "persisted-output",
  "claude-mem-context",
  "strata-context",
  "delivery-hub-context",
]);

const OPEN_TAG = /<([A-Za-z_][A-Za-z0-9_-]*)/y;
const CLOSE_TAG = /<\/([A-Za-z_][A-Za-z0-9_-]*)\s*>/y;

export function stripTags(input) {
  if (!input) return "";
  const text = String(input);
  if (!text.includes("<")) return text;

  // nextGt[j] = index of the first '>' at or after j, so an opener's span is an O(1) lookup.
  const len = text.length;
  const nextGt = new Int32Array(len + 1);
  nextGt[len] = len;
  for (let j = len - 1; j >= 0; j--) nextGt[j] = text.charCodeAt(j) === 0x3e ? j : nextGt[j + 1];

  const opens = new Map(); // tag name -> { items, head }
  const removed = [];
  let i = 0;
  while (i < len) {
    if (text.charCodeAt(i) !== 0x3c) {
      i += 1;
      continue;
    }
    CLOSE_TAG.lastIndex = i;
    const close = CLOSE_TAG.exec(text);
    if (close) {
      const entry = opens.get(close[1]);
      const open = entry && entry.head < entry.items.length ? entry.items[entry.head] : undefined;
      // A close tag inside the opener's own span is attribute text, not a real close.
      if (open && i >= open.attrEnd) {
        entry.head += 1;
        removed.push([open.start, i + close[0].length]);
      }
      i += close[0].length;
      continue;
    }
    OPEN_TAG.lastIndex = i;
    const open = OPEN_TAG.exec(text);
    if (open && STRIPPED_TAGS.has(open[1])) {
      const nameEnd = i + open[0].length;
      const item = { start: i, attrEnd: nextGt[nameEnd] };
      const entry = opens.get(open[1]);
      if (entry) entry.items.push(item);
      else opens.set(open[1], { items: [item], head: 0 });
      i = nameEnd;
      continue;
    }
    i += 1;
  }

  removed.sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [start, end] of removed) {
    if (start > cursor) out += text.slice(cursor, start);
    if (end > cursor) cursor = end;
  }
  return out + text.slice(cursor);
}

// A prompt that is entirely <private> marks a private turn: nothing from the turn is sent.
// A prompt with a private section and other text is not private as a whole.
export const isPrivatePrompt = (text) => Boolean(text && text.trim() && stripTags(text).trim() === "");

// Claude Code re-submits background-task completions through UserPromptSubmit.
// They are not something the engineer typed and must not count as a turn.
const PROTOCOL_ONLY = /^\s*<(task-notification)\b[^>]*>(?:(?!<\1\b|<\/\1\b)[\s\S])*<\/\1>\s*$/;
export const isInternalProtocolPayload = (text) =>
  Boolean(text) && text.length <= 256 * 1024 && PROTOCOL_ONLY.test(text);
