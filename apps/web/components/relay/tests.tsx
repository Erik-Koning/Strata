import type { Handoff } from "@strata/contracts";
import { CircleCheck, CircleX } from "lucide-react";
import { Ago } from "../time.tsx";
import { EvidenceBadge, shortSha } from "./status.tsx";

const duration = (ms: number | null) => (ms === null ? null : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function Tests({ handoff }: { handoff: Handoff }) {
  const runs = [...handoff.tests].reverse();
  return (
    <section aria-labelledby="tests-title">
      <h3 id="tests-title" className="eyebrow">
        Tests
      </h3>
      {handoff.testCommands.length ? (
        <p className="mt-2 text-[13px] text-ink-3">
          Proven by{" "}
          {handoff.testCommands.map((c, i) => (
            <span key={c}>
              {i ? ", " : null}
              <code className="kbd">{c}</code>
            </span>
          ))}
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3">No test commands named.</p>
      )}
      {runs.length ? (
        <ol className="mt-3 divide-y divide-line overflow-hidden rounded-[10px] border border-line">
          {runs.map((t, i) => {
            const pass = t.status === "pass";
            return (
              <li key={`${t.at}-${i}`} className="bg-surface">
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-surface-2">
                    <span
                      className={`inline-flex items-center gap-1 font-medium text-[12.5px] ${pass ? "text-accent-text" : "text-danger"}`}
                    >
                      {pass ? <CircleCheck size={14} aria-hidden /> : <CircleX size={14} aria-hidden />}
                      {pass ? "Pass" : "Fail"}
                    </span>
                    <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{t.command}</code>
                    <EvidenceBadge verified={t.verified} />
                    <span className="flex w-full flex-wrap gap-x-3 text-[12px] text-ink-3 sm:w-auto">
                      <span>exit {t.exitCode ?? "?"}</span>
                      {shortSha(t.commit) ? <span className="font-mono">@ {shortSha(t.commit)}</span> : null}
                      {duration(t.durationMs) ? <span>{duration(t.durationMs)}</span> : null}
                      <span>{t.by}</span>
                      <Ago at={t.at} />
                    </span>
                  </summary>
                  {t.output ? (
                    <pre className="ledger max-h-72 overflow-auto border-line border-t px-3 py-2 text-[12px]">
                      {t.output}
                    </pre>
                  ) : (
                    <p className="border-line border-t px-3 py-2 text-[12.5px] text-ink-3">No output captured.</p>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3">
          No runs yet. <code className="kbd">strata_handoff_verify</code> records verified runs from Claude Code.
        </p>
      )}
    </section>
  );
}
