// One command's time lost per week, drawn to scale from zero to its worst week: a 2px line over a faint wash, the
// latest week marked. Hovering a week names its figures; a table carries the same figures for screen readers.
// Server-rendered SVG in the theme's tokens, so it needs no script and follows light and dark.
import { formatDay, formatLost, type TrendPoint } from "../../server/hub/time-page.ts";

const W = 280;
const H = 56;
const PAD_X = 6;
const TOP = 6;
const BASE = H - 3;

const weekLabel = (week: TrendPoint) =>
  `Week of ${formatDay(week.weekStart)}: ${formatLost(week.lostMs)} lost in ${week.runs.toLocaleString("en-GB")} ${
    week.runs === 1 ? "run" : "runs"
  }`;

export function Sparkline({ weeks, caption }: { weeks: TrendPoint[]; caption: string }) {
  if (!weeks.length) return <p className="text-[13px] text-ink-3">No weeks to show in this range.</p>;
  const max = Math.max(0, ...weeks.map((w) => w.lostMs));
  const step = weeks.length > 1 ? (W - 2 * PAD_X) / (weeks.length - 1) : 0;
  const x = (i: number) => (weeks.length > 1 ? PAD_X + i * step : W / 2);
  const y = (ms: number) => (max > 0 ? BASE - (ms / max) * (BASE - TOP) : BASE);
  const points = weeks.map((w, i) => [x(i), y(w.lostMs)] as const);
  const line = points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area =
    weeks.length > 1 ? `${line} L${x(weeks.length - 1).toFixed(1)} ${BASE} L${x(0).toFixed(1)} ${BASE} Z` : "";
  const [endX, endY] = points.at(-1) ?? [W / 2, BASE];
  const hit = weeks.length > 1 ? step : W;
  const first = weeks[0];
  const last = weeks.at(-1);
  const peak = weeks.reduce((best, w) => (w.lostMs > best.lostMs ? w : best), weeks[0] as TrendPoint);

  return (
    <figure className="w-full max-w-[280px]">
      <figcaption className="flex items-baseline justify-between gap-3 text-[12.5px] text-ink-3">
        <span>{caption}</span>
        <span className="tabular-nums">{max > 0 ? `worst week ${formatLost(max)}` : "no time lost"}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`${caption}, from the week of ${formatDay(first?.weekStart ?? "")} to the week of ${formatDay(
          last?.weekStart ?? "",
        )}. Worst: the week of ${formatDay(peak.weekStart)}, ${formatLost(peak.lostMs)}.`}
        className="mt-1.5 block h-auto w-full overflow-visible"
      >
        <line x1={0} x2={W} y1={BASE + 0.5} y2={BASE + 0.5} stroke="var(--line-strong)" strokeWidth={1} />
        {area ? <path d={area} fill="var(--accent)" fillOpacity={0.1} /> : null}
        {weeks.length > 1 ? (
          <path
            d={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {weeks.map((week, i) => (
          <g key={week.weekStart} className="group/week">
            <line
              x1={x(i)}
              x2={x(i)}
              y1={TOP - 2}
              y2={BASE}
              stroke="var(--line-strong)"
              strokeWidth={1}
              className="opacity-0 group-hover/week:opacity-100"
            />
            <rect x={x(i) - hit / 2} y={0} width={hit} height={H} fill="transparent">
              <title>{weekLabel(week)}</title>
            </rect>
          </g>
        ))}
        <circle
          cx={endX}
          cy={endY}
          r={4}
          fill="var(--accent)"
          stroke="var(--surface)"
          strokeWidth={2}
          pointerEvents="none"
        />
      </svg>
      <div className="mt-1 flex justify-between gap-3 text-[12px] text-ink-3 tabular-nums">
        <span>{first ? `week of ${formatDay(first.weekStart)}` : ""}</span>
        <span>{last && weeks.length > 1 ? `week of ${formatDay(last.weekStart)}` : ""}</span>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Time lost</th>
            <th scope="col">Runs</th>
            <th scope="col">Failed</th>
            <th scope="col">Re-runs</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.weekStart}>
              <th scope="row">{formatDay(week.weekStart, true)}</th>
              <td>{formatLost(week.lostMs)}</td>
              <td>{week.runs}</td>
              <td>{week.failures}</td>
              <td>{week.reruns}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
