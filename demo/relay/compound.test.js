import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "../src/duration.js";

// Compound durations: the feature in progress on feat/compound-durations.
test("compound durations add up", () => {
  assert.equal(parseDuration("1h30m"), 5_400_000);
  assert.equal(parseDuration("2m30s"), 150_000);
  assert.equal(parseDuration("1d2h"), 93_600_000);
  assert.equal(parseDuration("1h 30m"), 5_400_000);
});

test("compound durations reject garbage between parts", () => {
  assert.throws(() => parseDuration("1h-30m"), TypeError);
  assert.throws(() => parseDuration("1h30"), TypeError);
  assert.throws(() => parseDuration("h30m"), TypeError);
});
