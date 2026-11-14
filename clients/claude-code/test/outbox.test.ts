import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enqueue, flush, OUTBOX, pending } from "../src/outbox.ts";
import { openStore } from "../src/store.ts";
import { duplicates, type FakeApi, freePort, startFakeApi } from "./fake-api.ts";
import { apiFor, setup, tempHome } from "./helpers.ts";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const event = (n: number) => ({
  sessionID: "s1",
  project: "github.com/acme/app",
  kind: "prompt" as const,
  payload: { role: "user", text: `message ${n}` },
});

describe("the outbox", () => {
  it("redacts before anything reaches the disk", () => {
    const { store } = setup("http://127.0.0.1:1");
    enqueue(store, {
      ...event(1),
      payload: { role: "user", text: "my key is sk-ant-api03-abcdefghijklmnopqrstuvwx, use it" },
    });
    const files = readdirSync(store.dir).map((f) => readFileSync(join(store.dir, f), "utf8"));
    expect(files.join("\n")).not.toContain("sk-ant-api03");
    expect(files.join("\n")).toContain("[REDACTED:anthropic-key]");
  });

  it("gives each event a sortable, unique id", () => {
    const { store } = setup("http://127.0.0.1:1");
    const ids = Array.from({ length: 50 }, (_, i) => enqueue(store, event(i), 1_700_000_000_000));
    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort()).toEqual(ids);
    expect(store.keys(OUTBOX)).toEqual(ids.map((id) => `${OUTBOX}${id}`));
  });

  it("keeps every event through a failed flush and a new process, then delivers each once", async () => {
    const port = await freePort();
    const home = tempHome();
    const first = setup(`http://127.0.0.1:${port}`, home);
    for (let i = 0; i < 7; i++) enqueue(first.store, event(i));

    const down = await flush(first.store, apiFor(first.config), { home });
    expect(down.error).toBeTruthy();
    expect(down.left).toBe(7);

    // Another process: nothing shared but the folder.
    api = await startFakeApi(port);
    const second = setup(api.url, home);
    const later = await flush(openStore(home), apiFor(second.config), { home, now: Date.now() + 60_000 });
    expect(later).toMatchObject({ sent: 7, left: 0 });
    expect(api.deliveries.size).toBe(7);
    expect(duplicates(api)).toBe(0);
    expect(pending(second.store)).toBe(0);
  });

  it("sends each id once when two flushers start together", async () => {
    api = await startFakeApi();
    const home = tempHome();
    const { store, config } = setup(api.url, home);
    for (let i = 0; i < 250; i++) enqueue(store, event(i));
    const results = await Promise.all([
      flush(openStore(home), apiFor(config), { home }),
      flush(openStore(home), apiFor(config), { home }),
    ]);
    expect(results.map((r) => r.skipped ?? "ran").sort()).toEqual(["locked", "ran"]);
    expect(api.deliveries.size).toBe(250);
    expect(duplicates(api)).toBe(0);
    // Batches of at most 100.
    const sizes = api.requests.map((r) => (r.body as { batch: unknown[] }).batch.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
  });

  it("backs off after a failure, longer each time, and sends again once the wait is over", async () => {
    api = await startFakeApi();
    api.mode = "fail";
    const home = tempHome();
    const { store, config } = setup(api.url, home);
    enqueue(store, event(1));
    const t0 = 1_800_000_000_000;
    expect((await flush(store, apiFor(config), { home, now: t0 })).error).toBeTruthy();
    expect((await flush(store, apiFor(config), { home, now: t0 + 500 })).skipped).toBe("backoff");
    expect((await flush(store, apiFor(config), { home, now: t0 + 1001 })).error).toBeTruthy();
    // Second failure: two seconds now.
    expect((await flush(store, apiFor(config), { home, now: t0 + 1001 + 1500 })).skipped).toBe("backoff");
    api.mode = "up";
    expect(await flush(store, apiFor(config), { home, now: t0 + 1001 + 2001 })).toMatchObject({ sent: 1, left: 0 });
    // A success clears the backoff.
    enqueue(store, event(2));
    expect(await flush(store, apiFor(config), { home, now: t0 + 1001 + 2002 })).toMatchObject({ sent: 1 });
  });

  it("sets aside an event the API refuses, and delivers the rest", async () => {
    api = await startFakeApi();
    const home = tempHome();
    const { store, config } = setup(api.url, home);
    enqueue(store, event(1));
    enqueue(store, { ...event(2), payload: { poison: true } });
    enqueue(store, event(3));
    expect(await flush(store, apiFor(config), { home })).toMatchObject({ sent: 2, dead: 1, left: 0 });
    expect(store.keys("dead:")).toHaveLength(1);
    expect(duplicates(api)).toBe(0);
  });

  it("takes over a lock left by a flusher that died", async () => {
    api = await startFakeApi();
    const home = tempHome();
    const { store, config } = setup(api.url, home);
    enqueue(store, event(1));
    // A lock a minute old: its flusher is gone.
    const { closeSync, openSync, utimesSync } = await import("node:fs");
    closeSync(openSync(join(home, "flush.lock"), "w"));
    const old = new Date(Date.now() - 120_000);
    utimesSync(join(home, "flush.lock"), old, old);
    expect(await flush(store, apiFor(config), { home })).toMatchObject({ sent: 1, left: 0 });
  });
});
