// A tiny key-value store on disk, one file per key under <home>/kv, written atomically (a temporary file, then a
// rename), so a hook killed halfway leaves the old value or the new one and never half of either. Keys are "ob:<ulid>"
// (an outbox event), "fz:<sessionID>" (a session's frozen block) and "bo:state" (the flusher's backoff).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Store {
  dir: string;
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  // Keys starting with the prefix, in key order (for "ob:", the order the events were made in).
  keys(prefix: string): string[];
}

const encode = (key: string): string =>
  key.replace(/[^A-Za-z0-9._-]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
const decode = (file: string): string =>
  file.replace(/%([0-9a-f]{2})/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

export function openStore(home: string): Store {
  const dir = join(home, "kv");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = (key: string): string => join(dir, encode(key));
  return {
    dir,
    get(key) {
      try {
        return readFileSync(path(key), "utf8");
      } catch {
        return null;
      }
    },
    set(key, value) {
      const target = path(key);
      const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(temporary, value, { mode: 0o600 });
      renameSync(temporary, target);
    },
    delete(key) {
      rmSync(path(key), { force: true });
    },
    keys(prefix) {
      if (!existsSync(dir)) return [];
      const start = encode(prefix);
      return readdirSync(dir)
        .filter((file) => file.startsWith(start) && !file.endsWith(".tmp"))
        .sort()
        .map(decode);
    },
  };
}
