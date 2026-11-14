"use client";
import { Activity, Brain, Cable, CalendarCheck, Forward, Radar, ScrollText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/intelligence", label: "Intelligence", icon: Radar },
  { href: "/memories", label: "Memories", icon: Brain },
  { href: "/relay", label: "Relay", icon: Forward },
  { href: "/connect", label: "Connect", icon: Cable },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];

// People who use the plugin themselves get My Day first: where they approve what their sessions drafted.
const MY_DAY = { href: "/my-day", label: "My Day", icon: CalendarCheck };
// Admins also get the page for people, roles, teams and invitations.
const ADMIN = { href: "/admin", label: "People", icon: ShieldCheck };

export function Nav({ admin = false, myDay = null }: { admin?: boolean; myDay?: number | null }) {
  const path = usePathname();
  const links = [...(myDay === null ? [] : [MY_DAY]), ...LINKS, ...(admin ? [ADMIN] : [])];
  // On a phone there's room for the current page's name only beside four links.
  const roomy = links.length <= 4;
  return (
    <nav aria-label="Main" className="flex gap-1 md:flex-col">
      {links.map(({ href, label, icon: Icon }) => {
        const current = href === "/" ? path === "/" : path.startsWith(href);
        const waiting = href === MY_DAY.href && myDay ? myDay : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`relative flex min-h-11 min-w-11 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors max-md:justify-center ${
              current ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:bg-surface/60 hover:text-ink"
            }`}
          >
            <Icon size={17} aria-hidden className={current ? "text-accent" : "text-ink-3"} />
            <span className={current && roomy ? "" : "max-md:sr-only"}>{label}</span>
            {waiting ? (
              <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-accent px-1.5 font-semibold text-[11px] text-accent-ink leading-5 max-md:absolute max-md:top-0.5 max-md:right-0.5 max-md:min-w-4 max-md:px-1 max-md:text-[10px] max-md:leading-4">
                {waiting > 99 ? "99+" : waiting}
                <span className="sr-only"> waiting for you</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
