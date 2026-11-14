import { describe, expect, it } from "vitest";
import { InvalidInput, input, MemoryIds, RefId, StatusChange, TeamPlace } from "../server/inputs.ts";

const ID = "65f1a2b3c4d5e6f7a8b9c0d1";

describe("input", () => {
  it("returns what the schema reads", () => {
    expect(input(StatusChange, { id: ID, status: "archived" })).toEqual({ id: ID, status: "archived" });
  });

  it("refuses what the page would never send, before it reaches the database", () => {
    expect(() => input(StatusChange, { id: ID, status: "superseded" })).toThrow(InvalidInput);
    expect(() => input(StatusChange, { id: ID, status: { $set: "x" } })).toThrow(InvalidInput);
    expect(() => input(StatusChange, { id: "not-an-id", status: "active" })).toThrow(InvalidInput);
  });
});

describe("MemoryIds", () => {
  it("keeps the ids and drops what isn't one, at most 500", () => {
    expect(input(MemoryIds, [ID, "nope", { $ne: null }, 7])).toEqual([ID]);
    expect(
      input(
        MemoryIds,
        Array.from({ length: 600 }, () => ID),
      ),
    ).toHaveLength(500);
  });

  it("refuses anything that isn't a list", () => {
    expect(() => input(MemoryIds, ID)).toThrow(InvalidInput);
    expect(() => input(MemoryIds, { 0: ID })).toThrow(InvalidInput);
  });
});

describe("RefId and TeamPlace", () => {
  it("takes a string id, and refuses an object that would act as a query operator", () => {
    expect(input(RefId, "user_abc123")).toBe("user_abc123");
    expect(() => input(RefId, { $ne: null })).toThrow(InvalidInput);
    expect(() => input(RefId, "")).toThrow(InvalidInput);
  });

  it("takes member, manager or null, and nothing else", () => {
    expect(TeamPlace.safeParse(null).success).toBe(true);
    expect(TeamPlace.safeParse("manager").success).toBe(true);
    expect(TeamPlace.safeParse("owner").success).toBe(false);
  });
});
