import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "../src/duration.js";

test("single units", () => {
  assert.equal(parseDuration("250ms"), 250);
  assert.equal(parseDuration("90s"), 90_000);
  assert.equal(parseDuration("5m"), 300_000);
  assert.equal(parseDuration("1.5h"), 5_400_000);
  assert.equal(parseDuration("2d"), 172_800_000);
});

test("rejects what it can't read", () => {
  assert.throws(() => parseDuration("soon"), TypeError);
  assert.throws(() => parseDuration("5x"), TypeError);
  assert.throws(() => parseDuration(""), TypeError);
});
