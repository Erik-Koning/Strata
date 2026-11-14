// ULIDs: 48 bits of milliseconds and 80 random bits in Crockford's base32, so ids sort by time and two processes never
// make the same one. Within one process, ids made in the same millisecond increase (the random part counts up), so a
// sort by id is the order they were made in. Each event's id is its idempotency key.
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let out = "";
  let rest = time;
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function freshRandom(): number[] {
  const bytes = randomBytes(16);
  return Array.from({ length: 16 }, (_, i) => (bytes[i] ?? 0) % 32);
}

// Adds one to the base32 digits, carrying left. The random part is 80 bits, so it never runs out in a millisecond.
function increment(digits: number[]): number[] {
  const out = [...digits];
  for (let i = out.length - 1; i >= 0; i--) {
    if ((out[i] ?? 0) < 31) {
      out[i] = (out[i] ?? 0) + 1;
      return out;
    }
    out[i] = 0;
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  if (now <= lastTime) {
    lastRandom = increment(lastRandom);
  } else {
    lastTime = now;
    lastRandom = freshRandom();
  }
  return encodeTime(lastTime) + lastRandom.map((d) => ALPHABET[d]).join("");
}
