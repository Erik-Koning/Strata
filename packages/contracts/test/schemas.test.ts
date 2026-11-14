import { describe, expect, it } from "vitest";
import { EXAMPLE_EVENTS } from "../src/examples.ts";
import { CONTRACT_VERSION, MAX_EVENT_CHARS, MEMORY_TEXT_MAX, parseEvent, SaveRequest } from "../src/schemas.ts";

const event = (over: Record<string, unknown> = {}) => ({
  v: 1,
  id: "01JCTEST00000000000000000",
  sessionID: "s1",
  scope: { project: "github.com/acme/app" },
  kind: "tool",
  payload: { tool: "Bash", status: "ok" },
  ts: "2026-11-14T09:30:00.000Z",
  ...over,
});

describe("parseEvent", () => {
  it("knows every example event, one of each kind", () => {
    const kinds = new Set(EXAMPLE_EVENTS.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(["assistant", "event", "finding", "prompt", "session", "tool", "transcript"]);
    for (const example of EXAMPLE_EVENTS) expect(parseEvent(example)).toMatchObject({ ok: true, known: true });
  });

  it("reads an event with no version as version 1, as the first plugins wrote them", () => {
    const { v: _, ...unversioned } = event();
    const parsed = parseEvent(unversioned);
    expect(parsed).toMatchObject({ ok: true, known: true });
    expect(parsed.ok && parsed.event.v).toBe(1);
  });

  it("keeps fields it doesn't name, in the payload and in the envelope", () => {
    const parsed = parseEvent(event({ agent: "explorer", payload: { tool: "Bash", status: "ok", queueMs: 40 } }));
    expect(parsed.ok && parsed.event).toMatchObject({ agent: "explorer", payload: { queueMs: 40 } });
  });

  it("takes a value it doesn't know yet in an open list", () => {
    const parsed = parseEvent(event({ payload: { tool: "Bash", status: "timed_out", command: { class: "deploy" } } }));
    expect(parsed).toMatchObject({ ok: true, known: true });
  });

  it("keeps a kind or a version it doesn't know, unchecked, for a later API to read", () => {
    expect(parseEvent(event({ kind: "screenshot", payload: { anything: true } }))).toMatchObject({
      ok: true,
      known: false,
    });
    expect(parseEvent(event({ v: CONTRACT_VERSION + 1, payload: { reshaped: [] } }))).toMatchObject({
      ok: true,
      known: false,
    });
  });

  it("refuses a known kind whose payload is wrong, and says where", () => {
    const parsed = parseEvent(event({ kind: "prompt", payload: { role: "user" } }));
    expect(parsed).toMatchObject({ ok: false, code: "invalid", id: "01JCTEST00000000000000000" });
    expect(!parsed.ok && parsed.message).toContain("payload.text");
  });

  it("refuses a broken envelope, an event too large, and a version older than the API accepts", () => {
    expect(parseEvent(event({ sessionID: "" }))).toMatchObject({ ok: false, code: "invalid" });
    expect(parseEvent(event({ kind: "Not A Kind" }))).toMatchObject({ ok: false, code: "invalid" });
    expect(parseEvent(null)).toMatchObject({ ok: false, code: "invalid" });
    const huge = event({ kind: "prompt", payload: { role: "user", text: "x".repeat(MAX_EVENT_CHARS) } });
    expect(parseEvent(huge)).toMatchObject({ ok: false, code: "too_large" });
    expect(parseEvent(event({ v: 0 }))).toMatchObject({ ok: false, code: "invalid" });
  });

  it("never treats a property of Object as a kind", () => {
    expect(parseEvent(event({ kind: "constructor" }))).toMatchObject({ ok: true, known: false });
  });
});

describe("SaveRequest", () => {
  const save = (text: unknown) => SaveRequest.safeParse({ scope: { project: "github.com/acme/app" }, text });

  it("keeps a memory's text trimmed", () => {
    const parsed = save("  We deploy from the release branch.  ");
    expect(parsed.success && parsed.data.text).toBe("We deploy from the release branch.");
  });

  it("refuses text that's only whitespace, which used to be stored as an empty memory", () => {
    expect(save("   \n\t ").success).toBe(false);
    expect(save("").success).toBe(false);
  });

  it("refuses text over the limit, counted after trimming", () => {
    expect(save("x".repeat(MEMORY_TEXT_MAX)).success).toBe(true);
    expect(save(` ${"x".repeat(MEMORY_TEXT_MAX)} `).success).toBe(true);
    expect(save("x".repeat(MEMORY_TEXT_MAX + 1)).success).toBe(false);
  });
});
