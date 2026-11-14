// How the time page counts, in plain words, folded away until someone asks. The rules are time-math.ts's and
// signals.ts's; if they change, this changes with them.
import { ChevronDown, Info } from "lucide-react";

export function HowWeCount() {
  return (
    <details className="card group mb-6">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <Info size={16} aria-hidden className="flex-none text-ink-3" />
        <span className="font-semibold text-[15px]">How we count</span>
        <span className="text-[13px] text-ink-3 max-sm:hidden">Commands on repositories, never people</span>
        <ChevronDown
          size={16}
          aria-hidden
          className="ml-auto flex-none text-ink-3 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-3 border-line border-t px-5 py-4 text-[14px] text-ink-2">
        <p>
          <strong className="font-semibold text-ink">No person is ever measured.</strong> Every figure here adds up runs
          of one command in one repository, day by day. Those daily totals carry no person and no session, so nothing on
          this page can be traced back to who ran what.
        </p>
        <p>
          When a connected Claude Code session runs a shell command, the plugin works out on the machine what kind of
          command it is (test, build, typecheck, lint, format, install, git or other) and a fingerprint of it. Only
          that, how long it took and whether it failed reach Strata. The command itself never leaves the machine.
        </p>
        <div>
          <p>A run's time counts as lost when:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>it failed: an error, a non-zero exit, or an interruption. All of its time is lost.</li>
            <li>
              it succeeded, but the same command had already run earlier in the same session. All of its time is lost,
              as repeated work.
            </li>
            <li>
              it was the first successful run of its kind in a session and took longer than the command's typical
              (median) run. The part above the typical run is lost, as slowness.
            </li>
          </ul>
        </div>
        <p>
          A command started in the background counts as a run but adds no time, and commands of the kind “other” aren't
          listed. Durations are kept to within about a tenth. The weekly trend measures slowness against the whole
          range's typical run, so its weeks compare with each other, and may add up to slightly more or less than the
          total.
        </p>
        <p>
          Only repositories with approved work appear: the same ones whose products everyone can see. A repository that
          so far shows up only in someone's own sessions stays out.
        </p>
      </div>
    </details>
  );
}
