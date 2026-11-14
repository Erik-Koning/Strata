// How "hours lost" is worked out from signal_daily, kept pure so the arithmetic can be tested on its own.
//
// Each command run (one tool event with a command signal) is, by its outcome:
//
//   failed      it ended in an error, a non-zero exit, or was interrupted: all of its time is lost.
//   re-run      it succeeded, but the same command (fingerprint) already ran earlier in the same session: its time is
//               lost too, as repeated work. A failed re-run counts once, as failed.
//   first run   it succeeded and was the first of its kind in the session: only the part of it above the item's typical
//               (median) successful first run is lost, as slowness.
//
// hours lost = (time in failed runs + time in successful re-runs + time above the median in successful first runs) / 1h
//
// A run started in the background has no duration of its own (its time is the time to start it), so it counts as a
// run but adds no time. Durations go in histograms with four buckets per doubling, so a median and the time above it
// come out to within about a tenth, and the days of a range add up by adding their buckets.

export const BUCKETS_PER_DOUBLING = 4;

export type Histogram = Record<string, number>;

export const bucketOf = (ms: number): number => (ms <= 1 ? 0 : Math.floor(BUCKETS_PER_DOUBLING * Math.log2(ms)));

// The middle of a bucket, on the log scale: what a run in it is taken to have lasted.
export const bucketMid = (bucket: number): number => 2 ** ((bucket + 0.5) / BUCKETS_PER_DOUBLING);

export function mergeHistograms(into: Histogram, from: Histogram | null | undefined): Histogram {
  for (const [bucket, count] of Object.entries(from ?? {})) into[bucket] = (into[bucket] ?? 0) + count;
  return into;
}

const sorted = (hist: Histogram): [number, number][] =>
  Object.entries(hist)
    .map(([bucket, count]): [number, number] => [Number(bucket), count])
    .filter(([, count]) => count > 0)
    .sort((a, b) => a[0] - b[0]);

// The median run, from its histogram: the middle of the bucket the middle run falls in. 0 when there are none.
export function medianMs(hist: Histogram): number {
  const buckets = sorted(hist);
  const total = buckets.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return 0;
  let seen = 0;
  for (const [bucket, count] of buckets) {
    seen += count;
    if (seen >= total / 2) return bucketMid(bucket);
  }
  return bucketMid(buckets.at(-1)?.[0] ?? 0);
}

// The time runs spent above a given duration.
const excessOver = (hist: Histogram, ms: number): number =>
  sorted(hist).reduce((sum, [bucket, count]) => sum + count * Math.max(0, bucketMid(bucket) - ms), 0);

// The time successful first runs spent above their own median.
export const slowExcessMs = (okHist: Histogram): number => excessOver(okHist, medianMs(okHist));

// What one stored run adds to its day's row.
export interface RunSignal {
  ms: number | null;
  failed: boolean;
  rerun: boolean;
  background: boolean;
}

export interface SignalCounters {
  runs: number;
  failures: number;
  reruns: number;
  timedRuns: number;
  totalMs: number;
  failedMs: number;
  rerunMs: number;
  hist: Histogram;
  okHist: Histogram;
}

export const emptyCounters = (): SignalCounters => ({
  runs: 0,
  failures: 0,
  reruns: 0,
  timedRuns: 0,
  totalMs: 0,
  failedMs: 0,
  rerunMs: 0,
  hist: {},
  okHist: {},
});

export function addRun(counters: SignalCounters, run: RunSignal): SignalCounters {
  const ms = run.background || run.ms === null ? null : Math.max(0, Math.round(run.ms));
  counters.runs += 1;
  if (run.failed) counters.failures += 1;
  if (run.rerun) counters.reruns += 1;
  if (ms === null) return counters;
  const bucket = String(bucketOf(ms));
  counters.timedRuns += 1;
  counters.totalMs += ms;
  counters.hist[bucket] = (counters.hist[bucket] ?? 0) + 1;
  if (run.failed) counters.failedMs += ms;
  else if (run.rerun) counters.rerunMs += ms;
  else counters.okHist[bucket] = (counters.okHist[bucket] ?? 0) + 1;
  return counters;
}

export function mergeCounters(into: SignalCounters, from: Partial<SignalCounters>): SignalCounters {
  into.runs += from.runs ?? 0;
  into.failures += from.failures ?? 0;
  into.reruns += from.reruns ?? 0;
  into.timedRuns += from.timedRuns ?? 0;
  into.totalMs += from.totalMs ?? 0;
  into.failedMs += from.failedMs ?? 0;
  into.rerunMs += from.rerunMs ?? 0;
  mergeHistograms(into.hist, from.hist);
  mergeHistograms(into.okHist, from.okHist);
  return into;
}

export interface Lost {
  failedMs: number;
  rerunMs: number;
  slowMs: number;
  totalMs: number;
}

// The time lost in a set of runs, by where it went. `slowOver` overrides the median the slowness is measured from,
// so a week of a trend is measured against the whole range's typical run.
export function lostTime(counters: SignalCounters, slowOver?: number): Lost {
  const slow = Math.round(excessOver(counters.okHist, slowOver ?? medianMs(counters.okHist)));
  return {
    failedMs: counters.failedMs,
    rerunMs: counters.rerunMs,
    slowMs: slow,
    totalMs: counters.failedMs + counters.rerunMs + slow,
  };
}

export const HOUR_MS = 3_600_000;
export const toHours = (ms: number): number => Math.round((ms / HOUR_MS) * 100) / 100;
