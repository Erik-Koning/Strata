// The overview's shared pieces: a card's header, its link to the page with the rest, and its empty states, in the
// same shapes the product pages use.
import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export const ROW_LINK = "block px-5 py-3 transition-colors hover:bg-surface-2/60 max-md:min-h-11";

export const times = (count: number, one: string, many: string): string =>
  count === 1 ? one : `${count.toLocaleString("en-GB")} ${many}`;

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;

export function CardHeader({
  id,
  icon: Icon,
  title,
  note,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  note?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-line border-b px-5 py-3.5">
      <h2 id={id} className="flex items-center gap-2 font-semibold text-[15px]">
        <Icon size={16} aria-hidden className="text-ink-3" /> {title}
      </h2>
      {note ? <span className="text-[12.5px] text-ink-3">{note}</span> : null}
    </header>
  );
}

export function FootLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <div className="border-line border-t px-3 py-2">
      <Link href={href} className="btn btn-quiet btn-sm max-md:min-h-11">
        {children} <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

// An empty side card: one line saying what will appear there.
export function SideEmpty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-5 text-[13px] text-ink-3">{children}</p>;
}

// An empty main card: what will appear there, and how it gets there.
export function BigEmpty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
        <Icon size={17} aria-hidden />
      </span>
      <p className="mt-4 font-semibold text-[15px]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">{children}</p>
    </div>
  );
}
