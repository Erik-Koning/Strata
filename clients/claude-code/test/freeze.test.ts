import { afterEach, describe, expect, it } from "vitest";
import { ensureFrozen, frozenBlock } from "../src/freeze.ts";
import { openStore } from "../src/store.ts";
import { type FakeApi, freePort, startFakeApi } from "./fake-api.ts";
import { apiFor, setup, tempHome } from "./helpers.ts";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const memories = [
  { _id: "6750a0000000000000000002", kind: "convention" as const, text: "Tests sit next to the code." },
  { _id: "6750a0000000000000000001", kind: "preference" as const, text: "Prefers pnpm over npm." },
];
const frozenCalls = (a: FakeApi): number => a.requests.filter((r) => r.path === "/api/memory/frozen").length;

describe("the frozen block", () => {
  it("is fetched once, then the same bytes in this process and the next", async () => {
    api = await startFakeApi();
    api.frozen = memories;
    const home = tempHome();
    const { store, config } = setup(api.url, home);
    const first = await ensureFrozen(store, apiFor(config), "s1", config.project, "startup");
    expect(first).toContain("- [preference] Prefers pnpm over npm.");

    // The memories change on the server; the session keeps what it was sent.
    api.frozen = [{ _id: "6750a0000000000000000003", kind: "fact", text: "Something new." }];
    const again = await ensureFrozen(store, apiFor(config), "s1", config.project, "startup");
    const nextProcess = await ensureFrozen(openStore(home), apiFor(config), "s1", config.project, "resume");
    expect(again).toBe(first);
    expect(nextProcess).toBe(first);
    expect(frozenCalls(api)).toBe(1);
  });

  it("freezes empty when the fetch fails, and doesn't try again until compaction", async () => {
    const port = await freePort();
    const home = tempHome();
    const { store, config } = setup(`http://127.0.0.1:${port}`, home);
    expect(await ensureFrozen(store, apiFor(config), "s2", config.project, "startup")).toBe("");
    expect(frozenBlock(store, "s2")).toBe("");

    api = await startFakeApi(port);
    api.frozen = memories;
    expect(await ensureFrozen(store, apiFor(config), "s2", config.project, "startup")).toBe("");
    expect(frozenCalls(api)).toBe(0);
    // Compaction rebuilds the cache, so it's the one place the block is refreshed.
    expect(await ensureFrozen(store, apiFor(config), "s2", config.project, "compact")).toContain("Prefers pnpm");
    expect(frozenCalls(api)).toBe(1);
  });

  it("keeps the block it had when the refresh at compaction fails", async () => {
    api = await startFakeApi();
    api.frozen = memories;
    const { store, config } = setup(api.url);
    const block = await ensureFrozen(store, apiFor(config), "s3", config.project, "startup");
    api.mode = "fail";
    expect(await ensureFrozen(store, apiFor(config), "s3", config.project, "compact")).toBe(block);
  });

  it("never fetches for a resumed or forked session it has no block for: that history is already under way", async () => {
    api = await startFakeApi();
    api.frozen = memories;
    const { store, config } = setup(api.url);
    expect(await ensureFrozen(store, apiFor(config), "s4", config.project, "resume")).toBe("");
    expect(await ensureFrozen(store, apiFor(config), "s5", config.project, "fork")).toBe("");
    expect(frozenCalls(api)).toBe(0);
  });

  it("starts afresh after /clear", async () => {
    api = await startFakeApi();
    api.frozen = memories;
    const { store, config } = setup(api.url);
    await ensureFrozen(store, apiFor(config), "s6", config.project, "startup");
    api.frozen = [memories[0]!];
    const cleared = await ensureFrozen(store, apiFor(config), "s6", config.project, "clear");
    expect(cleared).toContain("Tests sit next to the code.");
    expect(cleared).not.toContain("pnpm");
  });

  it("gives up after 800 ms on an API that doesn't answer", async () => {
    api = await startFakeApi();
    api.mode = "hang";
    const { store, config } = setup(api.url);
    const started = Date.now();
    expect(await ensureFrozen(store, apiFor(config), "s7", config.project, "startup")).toBe("");
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
