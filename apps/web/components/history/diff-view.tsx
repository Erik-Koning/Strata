// The diff on a product's history page: the files changed between Before and After, then each file as a collapsible
// section of hunks with both line numbers. Rendered from git's own unified diff (server/hub/git-history.ts).
import { ChevronDown, FileMinus2, FilePlus2, FileSymlink, FileText } from "lucide-react";
import type { Diff, FileDiff } from "../../server/hub/git-history.ts";

// Files over this many lines start collapsed, so one generated file doesn't bury the rest.
const OPEN_UP_TO = 400;

const STATUS: Record<FileDiff["status"], string> = {
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  renamed: "Renamed",
  copied: "Copied",
  mode: "Mode changed",
};

function FileIcon({ status }: { status: FileDiff["status"] }) {
  const props = { size: 15, "aria-hidden": true, className: "flex-none" } as const;
  if (status === "added") return <FilePlus2 {...props} className="flex-none n-add" />;
  if (status === "deleted") return <FileMinus2 {...props} className="flex-none n-del" />;
  if (status === "renamed" || status === "copied") return <FileSymlink {...props} className="flex-none text-ink-3" />;
  return <FileText {...props} className="flex-none text-ink-3" />;
}

// GitHub's five squares: the share of the file's changed lines that are additions.
function DiffStat({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  const adds = total ? Math.round((added / total) * 5) : 0;
  const dels = total ? Math.min(5 - adds, Math.round((removed / total) * 5)) : 0;
  return (
    <span className="diffstat" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} data-k={i < adds ? "add" : i < adds + dels ? "del" : undefined} />
      ))}
    </span>
  );
}

function Path({ file }: { file: FileDiff }) {
  const split = (p: string) => {
    const at = p.lastIndexOf("/");
    return at === -1 ? ["", p] : [p.slice(0, at + 1), p.slice(at + 1)];
  };
  const [dir, base] = split(file.path);
  return (
    <span className="min-w-0 break-all font-mono text-[12.5px]">
      {file.oldPath && file.oldPath !== file.path ? (
        <span className="text-ink-3">
          {file.oldPath}
          <span className="px-1.5" aria-hidden>
            →
          </span>
          <span className="sr-only">renamed to </span>
        </span>
      ) : null}
      <span className="text-ink-3">{dir}</span>
      <span className="font-medium text-ink">{base}</span>
    </span>
  );
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono text-[12px] tabular-nums">
      <span className="n-add">+{added}</span>
      <span className="n-del">−{removed}</span>
    </span>
  );
}

function FileBody({ file }: { file: FileDiff }) {
  if (file.binary) return <p className="px-5 py-4 text-[13px] text-ink-3">Binary file. Its contents aren't shown.</p>;
  if (!file.hunks.length) {
    const what =
      file.status === "mode"
        ? `File mode changed from ${file.mode.old} to ${file.mode.new}.`
        : file.status === "renamed"
          ? "Renamed, with no changes to its contents."
          : file.status === "added"
            ? "Empty file added."
            : file.status === "deleted"
              ? "Empty file deleted."
              : "No line changes.";
    return <p className="px-5 py-4 text-[13px] text-ink-3">{what}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="code">
        <tbody>
          {file.hunks.map((hunk, h) => (
            <HunkRows key={h} hunk={hunk} />
          ))}
        </tbody>
      </table>
      {file.truncated ? (
        <p className="border-line border-t px-5 py-3 text-[13px] text-ink-3">
          The rest of this file's changes aren't shown here: it's over 1,200 lines.
        </p>
      ) : null}
    </div>
  );
}

function HunkRows({ hunk }: { hunk: FileDiff["hunks"][number] }) {
  return (
    <>
      <tr className="hunk">
        <td className="ln" colSpan={2} aria-hidden />
        <td className="tx" colSpan={2}>
          {hunk.header}
          {hunk.section ? <span className="ml-2 text-ink-3">{hunk.section}</span> : null}
        </td>
      </tr>
      {hunk.lines.map((line, i) => (
        <tr key={i} data-k={line.kind}>
          <td className="ln">{line.old ?? ""}</td>
          <td className="ln">{line.new ?? ""}</td>
          <td className="mk" aria-hidden>
            {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
          </td>
          <td className="tx">
            {line.kind === "add" ? <span className="sr-only">Added: </span> : null}
            {line.kind === "del" ? <span className="sr-only">Removed: </span> : null}
            {line.text || "​"}
          </td>
        </tr>
      ))}
    </>
  );
}

export function DiffView({ diff, same }: { diff: Diff; same: boolean }) {
  const count = diff.files.length + diff.omittedFiles;
  return (
    <section className="card min-w-0" aria-labelledby="changes-title">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-line border-b px-5 py-3.5">
        <h2 id="changes-title" className="font-semibold text-[15px]">
          Code changes
        </h2>
        {count ? (
          <span className="inline-flex items-baseline gap-2 text-[13px] text-ink-2">
            {count} {count === 1 ? "file" : "files"} changed
            <Counts added={diff.added} removed={diff.removed} />
          </span>
        ) : null}
      </header>

      {same ? (
        <div className="px-6 py-14 text-center">
          <p className="font-semibold text-[15px]">Before and After are the same commit</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[14px] text-ink-3">
            Pick an earlier commit as Before to see what changed.
          </p>
        </div>
      ) : !count ? (
        <div className="px-6 py-14 text-center">
          <p className="font-semibold text-[15px]">No file changes between these commits</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[14px] text-ink-3">
            Their trees are identical. A merge or an empty commit looks like this.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-[var(--rule)] border-line border-b py-1" aria-label="Files changed">
            {diff.files.map((file, i) => (
              <li key={`${file.path}-${i}`}>
                <a
                  href={`#file-${i}`}
                  className="flex items-center gap-2.5 px-5 py-1.5 hover:bg-sunk max-md:min-h-11"
                  title={STATUS[file.status]}
                >
                  <FileIcon status={file.status} />
                  <Path file={file} />
                  <span className="ml-auto flex flex-none items-center gap-2.5">
                    {file.binary ? (
                      <span className="text-[12px] text-ink-3">Binary</span>
                    ) : (
                      <Counts added={file.added} removed={file.removed} />
                    )}
                    <DiffStat added={file.added} removed={file.removed} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {diff.truncated ? (
            <p className="border-line border-b bg-amber-soft px-5 py-2.5 text-[13px] text-amber">
              This comparison is larger than the page shows
              {diff.omittedFiles
                ? `: the first ${diff.files.length} files are here, ${diff.omittedFiles} more aren't`
                : ""}
              . Compare closer commits to see the rest.
            </p>
          ) : null}
          {diff.files.map((file, i) => (
            <details
              key={`${file.path}-${i}`}
              id={`file-${i}`}
              className="file scroll-mt-4 border-line [&+&]:border-t"
              open={file.added + file.removed <= OPEN_UP_TO}
            >
              <summary className="flex items-center gap-2.5 border-line border-b bg-surface px-4 py-2.5 hover:bg-sunk md:sticky md:top-0 md:z-[1] max-md:min-h-11">
                <ChevronDown size={15} aria-hidden className="file-caret flex-none text-ink-3" />
                <Path file={file} />
                <span className="ml-auto flex flex-none items-center gap-2">
                  {file.status !== "modified" ? <span className="chip">{STATUS[file.status]}</span> : null}
                  {file.binary ? null : <Counts added={file.added} removed={file.removed} />}
                </span>
              </summary>
              <FileBody file={file} />
            </details>
          ))}
        </>
      )}
    </section>
  );
}
