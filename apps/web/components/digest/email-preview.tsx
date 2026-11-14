// What the digest would say as an email: its subject and text part, folded away. Nothing sends it yet.
import { Mail } from "lucide-react";

export function EmailPreview({ subject, text }: { subject: string; text: string }) {
  return (
    <details className="card group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-5 py-3 font-semibold text-[15px] [&::-webkit-details-marker]:hidden">
        <Mail size={16} aria-hidden className="text-ink-3" />
        <span className="flex-1">Preview the email</span>
        <span className="font-normal text-[12.5px] text-ink-3 group-open:hidden">Show</span>
        <span className="hidden font-normal text-[12.5px] text-ink-3 group-open:inline">Hide</span>
      </summary>
      <div className="border-line border-t px-5 py-4">
        <p className="text-[13px] text-ink-3">
          This digest as an email's text part, for the week and products shown. Nothing sends it yet: a weekly send
          comes with following products.
        </p>
        <p className="mt-3 break-words text-[13.5px]">
          <span className="text-ink-3">Subject: </span>
          {subject}
        </p>
        <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-[12px] bg-surface-2 p-4 font-mono text-[12px] text-ink-2 leading-relaxed">
          {text}
        </pre>
      </div>
    </details>
  );
}
