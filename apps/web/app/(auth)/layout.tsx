import type { ReactNode } from "react";
import { Mark, Wordmark } from "../../components/logo.tsx";

// The sign-in pages: the form on the left; on the right, the product in one line and the three steps it stands for.
const STEPS = [
  { title: "Started by a teammate", body: "Unfinished work is checkpointed: what's done, what's left, and why." },
  { title: "What Strata shared", body: "Only the context they approve travels. Private memories never do." },
  { title: "Continued by your agent", body: "A fresh session resumes it, and the tests prove the result." },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex flex-col bg-surface px-5 py-8 sm:px-10">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-[13px] text-ink-3">Memory for Claude Code and OpenCode. Your data stays on your server.</p>
      </main>
      <aside className="hidden border-line border-l bg-sidebar p-12 lg:flex lg:flex-col lg:justify-center">
        <div className="max-w-[460px]">
          <h2 className="font-semibold text-[36px] text-ink leading-[1.08] tracking-[-0.035em]">
            Your teammate started it. Strata remembers it. Your agent finishes it.
          </h2>
          <ol className="relative mt-10 grid gap-7 before:absolute before:top-3 before:bottom-3 before:left-[15px] before:border-accent before:border-l-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-4">
                <span className="relative z-[1] grid size-8 place-items-center rounded-full bg-surface shadow-[var(--shadow)]">
                  {i === 1 ? <Mark size={18} /> : <span className="size-2 rounded-full bg-accent" />}
                </span>
                <span>
                  <span className="block font-semibold text-[16px] text-ink">{s.title}</span>
                  <span className="mt-0.5 block text-[14.5px] text-ink-2 leading-relaxed">{s.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
