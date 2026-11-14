// What travels with the checkpoint besides the task itself: the memories the sender chose to share, each with where it
// came from; the ones that didn't make it, and why; and the files the work touched.
import type { SharedMemory } from "@strata/contracts";
import { CornerDownRight } from "lucide-react";
import { KindChip } from "../chips.tsx";
import { Ago } from "../time.tsx";

export function SharedMemories({ memories, note }: { memories: SharedMemory[]; note?: string }) {
  return (
    <section aria-labelledby="shared-title">
      <h3 id="shared-title" className="eyebrow">
        Shared memories{memories.length ? <span className="ml-1.5">{memories.length}</span> : null}
      </h3>
      {note ? <p className="mt-1 text-[12.5px] text-ink-3">{note}</p> : null}
      {memories.length ? (
        <ul className="mt-2.5 grid gap-2">
          {memories.map((m) => (
            <li key={m._id} className="rounded-[10px] border border-line bg-surface px-3 py-2.5">
              <p className="text-[13.5px] leading-snug">{m.text}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <KindChip kind={m.kind} />
                <span className={`chip ${m.trust === "explicit" ? "status-active" : "status-candidate"}`}>
                  {m.trust}
                </span>
              </div>
              <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-[12px] text-ink-3">
                <dt>source</dt>
                <dd className="truncate text-ink-2">{m.provenance.source}</dd>
                {m.provenance.sessionID ? (
                  <>
                    <dt>session</dt>
                    <dd className="truncate font-mono text-[11.5px] text-ink-2" title={m.provenance.sessionID}>
                      {m.provenance.sessionID}
                    </dd>
                  </>
                ) : null}
                <dt>created</dt>
                <dd className="text-ink-2">
                  <Ago at={m.createdAt} />
                </dd>
              </dl>
              {m.correctionOf ? (
                <p className="mt-1.5 flex items-center gap-1 text-[12px] text-amber">
                  <CornerDownRight size={12} aria-hidden />
                  Correction of <span className="font-mono">{m.correctionOf.slice(-8)}</span>, which it replaced
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3">None shared.</p>
      )}
    </section>
  );
}

export function ExcludedMemories({ excluded }: { excluded: { _id: string; reason: string }[] }) {
  if (!excluded.length) return null;
  return (
    <section aria-labelledby="excluded-title">
      <h3 id="excluded-title" className="eyebrow">
        Left out <span className="ml-1">{excluded.length}</span>
      </h3>
      <p className="mt-1 text-[12.5px] text-ink-3">Shared, but no longer current, so not given to the session.</p>
      <ul className="mt-2 grid gap-1 text-[12.5px]">
        {excluded.map((e) => (
          <li key={e._id} className="flex items-center justify-between gap-3 rounded-[8px] bg-surface-2 px-2.5 py-1.5">
            <span className="font-mono text-[11.5px] text-ink-3">{e._id.slice(-8)}</span>
            <span className="text-ink-2">{e.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChangedFiles({ files, title = "Changed files" }: { files: string[]; title?: string }) {
  return (
    <section>
      <h3 className="eyebrow">
        {title}
        {files.length ? <span className="ml-1.5">{files.length}</span> : null}
      </h3>
      {files.length ? (
        <ul className="mt-2 grid gap-0.5 font-mono text-[12px] text-ink-2">
          {files.map((f) => (
            <li key={f} className="truncate" title={f}>
              {f}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3">None listed.</p>
      )}
    </section>
  );
}
