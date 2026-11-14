// parseDuration("90s") === 90_000. Units: ms, s, m, h, d. Throws a TypeError on anything it can't read.
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(input) {
  if (typeof input !== "string") throw new TypeError("parseDuration takes a string");
  const text = input.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(text);
  if (!match) throw new TypeError(`Not a duration: ${JSON.stringify(input)}`);
  return Math.round(Number(match[1]) * UNIT_MS[match[2]]);
}
