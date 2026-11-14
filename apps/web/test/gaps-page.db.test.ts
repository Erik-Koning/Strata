// The context gaps page's server actions and what a gap's own page reads, on a database of their own
// (test-database.ts): only someone signed in and not suspended can take, resolve or reopen a gap; resolving needs a note,
// and a link only when it's a web address; a gap's page shows the sessions it came from and its history.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dropTestDatabase, testDatabase } from "./test-database.ts";

const name = testDatabase("am_gaps_page");
process.env.MEMORY_AI_PROVIDER = "stub";

// Who the page's session says is signed in: the actions ask getViewer, which is null when nobody is (or the account is
// suspended, which viewer.ts treats as signed out).
const signedIn = vi.hoisted(() => ({ viewer: null as null | { userId: string; name: string } }));
vi.mock("../server/viewer.ts", () => ({
  getViewer: async () =>
    signedIn.viewer
      ? { ...signedIn.viewer, email: "x@example.com", role: "engineer", manages: [], usesPlugin: false }
      : null,
}));
const revalidated = vi.hoisted(() => [] as string[]);
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.push(path) }));

const { ObjectId } = await import("mongodb");
const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { audits, members, records } = await import("../server/collections.ts");
const { getGap, listGaps, syncGaps } = await import("../server/hub/gaps.ts");
const { reopenGap, resolveGap, takeGap } = await import("../app/(app)/gaps/actions.ts");
const { gapHistory, gapSources } = await import("../app/(app)/gaps/detail.ts");
type RecordDoc = import("../server/collections.ts").RecordDoc;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ada = new ObjectId().toHexString();
const bo = new ObjectId().toHexString();
const cy = new ObjectId().toHexString();

let n = 0;
const gapRecord = (user: string, sessionID: string, text: string, approvedAt: Date) =>
  ({
    _id: new ObjectId(),
    scope: { org: "default", project: "github.com/acme/billing", user },
    sessionID,
    kind: "context_gap",
    status: "approved",
    title: null,
    text,
    textKey: `gp${++n}`,
    refs: [],
    eventIds: [],
    edited: false,
    createdAt: approvedAt,
    updatedAt: approvedAt,
    approvedAt,
    memoryId: null,
  }) satisfies RecordDoc;

let gapId = "";
const stored = () => getGap(gapId, bo);
const changes = async () => (await audits().find({ targetIds: gapId }).sort({ ts: 1 }).toArray()).map((a) => a.action);

beforeAll(async () => {
  await ensureIndexes();
  const at = new Date();
  await db()
    .collection("user")
    .insertMany(
      [
        [ada, "Ada Lovelace"],
        [bo, "Bo Diddley"],
        [cy, "Cy Twombly"],
      ].map(([id, person]) => ({ _id: new ObjectId(id), name: person, email: `${id}@example.com`, createdAt: at })),
    );
  await members().insertOne({ _id: cy, role: "engineer", suspendedAt: at, createdAt: at, updatedAt: at });
  await records().insertMany([
    gapRecord(ada, "s1", "Nothing says why the queue delivers at least once.", ago(3)),
    gapRecord(bo, "s2", "nothing says why the queue delivers at-least-once", ago(1)),
  ]);
  await syncGaps();
  gapId = (await listGaps({}, bo))[0]?.id ?? "";
});
beforeEach(() => {
  signedIn.viewer = null;
  revalidated.length = 0;
});
afterAll(async () => {
  await dropTestDatabase(db(), name);
  await closeMongo();
});

describe("who can act on a gap", () => {
  it("refuses anyone not signed in, and changes nothing", async () => {
    expect(gapId).toMatch(/^[a-f0-9]{24}$/);
    expect(await takeGap(gapId)).toEqual({ error: "Sign in to do that." });
    expect(await resolveGap(gapId, { note: "Documented." })).toEqual({ error: "Sign in to do that." });
    expect(await reopenGap(gapId)).toEqual({ error: "Sign in to do that." });
    expect(await stored()).toMatchObject({ status: "open", owner: null, resolution: null });
    expect(await changes()).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  it("refuses a suspended person whose session still answers, and changes nothing", async () => {
    signedIn.viewer = { userId: cy, name: "Cy Twombly" };
    expect(await takeGap(gapId)).toEqual({ error: "This account can't change anything here." });
    expect(await resolveGap(gapId, { note: "Documented." })).toEqual({
      error: "This account can't change anything here.",
    });
    expect(await stored()).toMatchObject({ status: "open", owner: null });
    expect(await changes()).toEqual([]);
  });

  it("refuses a gap that isn't there, whatever the id", async () => {
    signedIn.viewer = { userId: bo, name: "Bo Diddley" };
    expect(await takeGap("not-an-id")).toEqual({ error: "That gap doesn't exist any more." });
    expect(await takeGap(new ObjectId().toHexString())).toEqual({ error: "That gap doesn't exist any more." });
    expect(await reopenGap({ $ne: null } as unknown as string)).toEqual({ error: "That gap doesn't exist any more." });
  });

  it("lets someone signed in take it on, and refreshes the pages that show it", async () => {
    signedIn.viewer = { userId: bo, name: "Bo Diddley" };
    expect(await takeGap(gapId)).toEqual({ error: null });
    expect((await stored())?.owner).toEqual({ id: bo, name: "Bo Diddley" });
    expect(revalidated).toContain("/gaps");
    expect(revalidated).toContain("/audit");
    // Anyone can take it on from whoever had it.
    signedIn.viewer = { userId: ada, name: "Ada Lovelace" };
    expect(await takeGap(gapId)).toEqual({ error: null });
    expect((await stored())?.owner).toEqual({ id: ada, name: "Ada Lovelace" });
  });
});

describe("resolving", () => {
  it("needs a note", async () => {
    signedIn.viewer = { userId: ada, name: "Ada Lovelace" };
    for (const input of [{ note: "" }, { note: "   " }, { url: "https://wiki.example.com/queue", note: "" }]) {
      const result = await resolveGap(gapId, input);
      expect(result.error).toMatch(/note/i);
    }
    expect(await resolveGap(gapId, { note: "x".repeat(1001) })).toEqual({
      error: "Keep the note under 1,000 characters.",
    });
    expect(await resolveGap(gapId, null as unknown as { note: string })).toMatchObject({ error: expect.any(String) });
    expect((await stored())?.status).toBe("open");
  });

  it("takes a link only when it's a web address", async () => {
    signedIn.viewer = { userId: ada, name: "Ada Lovelace" };
    for (const url of [
      "not a link",
      "wiki.example.com/queue",
      "javascript:alert(1)",
      "ftp://files.example.com/queue",
      "https://wiki.example.com/the queue",
      `https://wiki.example.com/${"q".repeat(2000)}`,
    ]) {
      const result = await resolveGap(gapId, { url, note: "Documented." });
      expect(result.error, url).not.toBeNull();
    }
    expect((await stored())?.status).toBe("open");
    expect(await changes()).toEqual(["gap.take", "gap.take"]);
  });

  it("resolves with a note alone, or with a note and a link", async () => {
    signedIn.viewer = { userId: ada, name: "Ada Lovelace" };
    expect(await resolveGap(gapId, { url: "  ", note: "  It's in the runbook now.  " })).toEqual({ error: null });
    expect(await stored()).toMatchObject({
      status: "resolved",
      resolution: { url: null, note: "It's in the runbook now." },
    });
    expect(await reopenGap(gapId)).toEqual({ error: null });
    expect(await stored()).toMatchObject({ status: "open", resolution: null });
    expect(
      await resolveGap(gapId, { url: " https://wiki.example.com/queue#delivery ", note: "The ADR explains it." }),
    ).toEqual({ error: null });
    expect(await stored()).toMatchObject({
      status: "resolved",
      resolution: { url: "https://wiki.example.com/queue#delivery", note: "The ADR explains it." },
    });
    expect(await changes()).toEqual(["gap.take", "gap.take", "gap.resolve", "gap.reopen", "gap.resolve"]);
  });
});

describe("a gap's own page", () => {
  it("shows the sessions it came from, as each put it, newest first", async () => {
    const gap = await stored();
    if (!gap) throw new Error("the gap should be there");
    const sources = await gapSources(gap, bo);
    expect(sources.map((s) => s.sessionId)).toEqual(["s2", "s1"]);
    expect(sources[0]).toMatchObject({
      author: { id: bo, name: "Bo Diddley" },
      productId: "billing",
      lines: [{ text: "nothing says why the queue delivers at-least-once", source: "record" }],
    });
    // A suspended person reads nothing of it.
    expect(await gapSources(gap, cy)).toEqual([]);
  });

  it("shows its history, newest first, with who changed it and nobody behind a session", async () => {
    const history = await gapHistory(gapId, bo);
    expect(history.map((e) => e.kind)).toEqual(["resolve", "reopen", "resolve", "take", "take", "session", "session"]);
    expect(history[0]).toMatchObject({ by: "Ada Lovelace", url: "https://wiki.example.com/queue#delivery" });
    expect(history.at(-1)).toMatchObject({ kind: "session", sessionId: "s1" });
    expect(history.filter((e) => e.kind === "session").every((e) => !("by" in e))).toBe(true);
    expect(await gapHistory(gapId, cy)).toEqual([]);
    expect(await gapHistory("nope", bo)).toEqual([]);
  });

  it("lets anyone signed in reopen it", async () => {
    signedIn.viewer = { userId: bo, name: "Bo Diddley" };
    expect(await reopenGap(gapId)).toEqual({ error: null });
    expect(await stored()).toMatchObject({ status: "open", resolution: null, owner: { id: ada } });
  });
});
