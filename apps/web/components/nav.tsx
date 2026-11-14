"use client";
import { Activity, Brain, Cable, ScrollText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/memories", label: "Memories", icon: Brain },
  { href: "/connect", label: "Connect", icon: Cable },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 md:flex-col">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const current = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors ${
              current ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:bg-surface/60 hover:text-ink"
            }`}
          >
            <Icon size={17} aria-hidden className={current ? "text-accent" : "text-ink-3"} />
            <span className={current ? "" : "max-md:sr-only"}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
