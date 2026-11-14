// Hours lost, worked out by hand against the module: failed runs, successful re-runs, and slowness above the median.
import { describe, expect, it } from "vitest";
import { commandOf } from "../server/hub/signals.ts";
import {
  addRun,
  bucketMid,
  bucketOf,
  emptyCounters,
  HOUR_MS,
  lostTime,
  medianMs,
  mergeCounters,
  slowExcessMs,
  toHours,
} from "../server/hub/time-math.ts";

const run = (ms: number | null, extra: { failed?: boolean; rerun?: boolean; background?: boolean } = {}) => ({
  ms,
  failed: extra.failed ?? false,
  rerun: extra.rerun ?? false,
  background: extra.background ?? false,
});

describe("duration buckets", () => {
  it("puts a duration in a bucket whose middle is within about a tenth of it", () => {
    for (const ms of [5, 120, 1_000, 61_000, 3_600_000]) {
      const mid = bucketMid(bucketOf(ms));
      expect(Math.abs(mid - ms) / ms).toBeLessThan(0.1);
    }
    expect(bucketOf(0)).toBe(0);
  });

  it("finds the median, and the time above it", () => {
    const hist: Record<string, number> = {};
    for (const ms of [1_000, 1_000, 1_000, 60_000]) hist[bucketOf(ms)] = (hist[bucketOf(ms)] ?? 0) + 1;
    expect(medianMs(hist)).toBeCloseTo(bucketMid(bucketOf(1_000)));
    expect(slowExcessMs(hist)).toBeCloseTo(bucketMid(bucketOf(60_000)) - bucketMid(bucketOf(1_000)));
    expect(medianMs({})).toBe(0);
  });
});

describe("hours lost", () => {
  it("counts failed runs whole, successful re-runs whole, and first runs above the median", () => {
    const c = emptyCounters();
    addRun(c, run(60_000)); // first run, typical
    addRun(c, run(60_000)); // first run (another session), typical
    addRun(c, run(600_000)); // first run, slow
    addRun(c, run(120_000, { failed: true })); // failed
    addRun(c, run(90_000, { failed: true, rerun: true })); // failed re-run: once, as failed
    addRun(c, run(60_000, { rerun: true })); // successful re-run
    addRun(c, run(5, { background: true })); // started in the background: a run, no time
    addRun(c, run(null)); // no duration reported

    expect(c).toMatchObject({ runs: 8, failures: 2, reruns: 2, timedRuns: 6, failedMs: 210_000, rerunMs: 60_000 });
    expect(c.totalMs).toBe(990_000);
    const lost = lostTime(c);
    expect(lost.failedMs).toBe(210_000);
    expect(lost.rerunMs).toBe(60_000);
    const slow = bucketMid(bucketOf(600_000)) - bucketMid(bucketOf(60_000));
    expect(lost.slowMs).toBe(Math.round(slow));
    expect(lost.totalMs).toBe(210_000 + 60_000 + Math.round(slow));
    expect(toHours(HOUR_MS * 1.5)).toBe(1.5);
  });

  it("adds days up the same as one long day", () => {
    const a = emptyCounters();
    const b = emptyCounters();
    const both = emptyCounters();
    for (const [target, ms] of [
      [a, 1_000],
      [a, 30_000],
      [b, 2_000],
    ] as const) {
      addRun(target, run(ms));
      addRun(both, run(ms));
    }
    expect(mergeCounters(mergeCounters(emptyCounters(), a), b)).toEqual(both);
  });

  it("measures a week's slowness against a given typical run", () => {
    const week = emptyCounters();
    addRun(week, run(10_000));
    expect(lostTime(week).slowMs).toBe(0);
    expect(lostTime(week, bucketMid(bucketOf(1_000))).slowMs).toBe(
      Math.round(bucketMid(bucketOf(10_000)) - bucketMid(bucketOf(1_000))),
    );
  });
});

describe("commandOf", () => {
  const tool = (payload: Record<string, unknown>, known = true) => ({ kind: "tool", known, payload });

  it("reads a shell command's class, fingerprint, outcome and time", () => {
    expect(
      commandOf(tool({ tool: "Bash", status: "ok", ms: 1200, command: { class: "test", fp: "0123456789abcdef" } })),
    ).toEqual({ cls: "test", fp: "0123456789abcdef", ms: 1200, failed: false, background: false });
    expect(commandOf(tool({ status: "ok", ms: 5, command: { class: "build", exit: 2 } }))?.failed).toBe(true);
    expect(commandOf(tool({ status: "interrupted", command: { class: "test" } }))?.failed).toBe(true);
    expect(commandOf(tool({ status: "ok", command: { class: "other", fp: "nothex" } }))?.fp).toBe("");
  });

  it("ignores tool calls that aren't commands, and events it doesn't understand", () => {
    expect(commandOf(tool({ tool: "Read", status: "ok", ms: 3 }))).toBeNull();
    expect(commandOf(tool({ status: "ok", command: { class: "Test Suite" } }))).toBeNull();
    expect(commandOf(tool({ status: "ok", command: { class: "test" } }, false))).toBeNull();
    expect(commandOf({ kind: "prompt", known: true, payload: { command: { class: "test" } } })).toBeNull();
  });
});
