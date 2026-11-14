// How the recipient picks it up: one command for a fresh Claude Code session (switching to the branch first), or the
// slash command for a session that's already open in the right checkout.
import { type Handoff, resumeCommand } from "@strata/contracts";
import { Terminal } from "lucide-react";
import { CodeLine, CopyButton } from "../copy.tsx";

export function ResumeBlock({ handoff, forRecipient }: { handoff: Handoff; forRecipient: boolean }) {
  const command = resumeCommand(handoff);
  return (
    <section aria-labelledby="resume-title" className="grid gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="resume-title" className="eyebrow flex items-center gap-1.5">
          <Terminal size={13} aria-hidden /> Resume in Claude Code
        </h3>
        <CopyButton text={command} label="Copy resume command" />
      </div>
      <pre className="overflow-x-auto rounded-[10px] border border-line bg-sunk px-3 py-2.5 font-mono text-[12.5px] text-ink whitespace-pre-wrap">
        {command}
      </pre>
      <p className="text-[12.5px] text-ink-3">
        {forRecipient
          ? "Paste it in the repository's checkout. Already in a session there?"
          : `Send this to ${handoff.recipient?.name ?? "the recipient"}. From an open session:`}
      </p>
      <CodeLine code={`/strata:resume ${handoff._id}`} />
    </section>
  );
}
