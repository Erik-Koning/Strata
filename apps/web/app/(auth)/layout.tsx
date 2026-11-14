import type { ReactNode } from "react";
import { Wordmark } from "../../components/logo.tsx";

// The sign-in pages: the form on the left, and on the right the thing itself, a frozen block as a session receives it.
const SAMPLE = `<memory-frozen>
Long-term memory about this user and project,
from earlier sessions.
- [preference] Use pnpm, never npm.
- [convention] Tests sit next to the code.
- [decision] Auth is Better Auth on MongoDB.
- [fact] Staging deploys from the release branch.
</memory-frozen>`;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-[13px] text-ink-3">Memory for Claude Code and OpenCode. Your data stays on your server.</p>
      </main>
      <aside className="relative hidden overflow-hidden bg-[#0d1412] p-12 text-[#e8eeeb] lg:flex lg:flex-col lg:justify-between">
        <div className="max-w-md">
          <p className="font-mono text-[11px] text-[#5fe0b5] uppercase tracking-[0.08em]">Strata</p>
          <h2 className="mt-4 font-semibold text-[34px] leading-[1.12] tracking-[-0.02em]">
            Your agents forget between sessions. This remembers for them.
          </h2>
          <p className="mt-4 text-[16px] text-[#b3bfba]">
            What you tell Claude Code once is kept, recalled when it matters, and given back without breaking the prompt
            cache: the same bytes, every request, all session.
          </p>
        </div>
        <figure className="rounded-[14px] border border-white/10 bg-black/30 p-5">
          <pre className="font-mono text-[12.5px] text-[#cfe9df] leading-[22px]">{SAMPLE}</pre>
          <figcaption className="mt-3 flex flex-wrap gap-2 font-mono text-[11px] text-[#8a9792]">
            <span>312 bytes</span>
            <span aria-hidden>·</span>
            <span>sha 9c41e07b2a</span>
            <span aria-hidden>·</span>
            <span className="text-[#5fe0b5]">same bytes all session</span>
          </figcaption>
        </figure>
      </aside>
    </div>
  );
}
