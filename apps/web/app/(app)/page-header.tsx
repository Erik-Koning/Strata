import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-line border-b pb-5">
      <div className="min-w-0 max-w-[760px]">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-1.5 font-semibold text-[22px] leading-[1.2] tracking-[-0.022em]">{title}</h1>
        {lede ? <p className="mt-1.5 text-[13.5px] text-ink-3 leading-relaxed">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
