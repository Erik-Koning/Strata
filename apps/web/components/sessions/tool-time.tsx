// A session's shell commands by class, for its author alone: the page only renders this when the data layer returned
// the rows, which it does only for the person whose session it is.
import { duration } from "./format.ts";

export interface ToolTimeRow {
  class: string;
  runs: number;
  failures: number;
  totalMs: number;
}

export function ToolTime({ rows }: { rows: ToolTimeRow[] }) {
  if (!rows.length)
    return (
      <p className="px-5 py-4 text-[14px] text-ink-3">
        No shell commands were recorded for this session, or they're older than the 30 days events are kept.
      </p>
    );
  return (
    <div className="overflow-x-auto px-5 py-3">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[12.5px] text-ink-3">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Command
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Runs
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Failed
            </th>
            <th scope="col" className="py-1.5 text-right font-medium">
              Time
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.class}>
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                <span className="chip chip-mono">{row.class}</span>
              </th>
              <td className="py-2 pr-3 text-right tabular-nums">{row.runs}</td>
              <td className={`py-2 pr-3 text-right tabular-nums ${row.failures ? "text-danger" : "text-ink-3"}`}>
                {row.failures}
              </td>
              <td className="py-2 text-right tabular-nums">{duration(row.totalMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
