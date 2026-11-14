"use client";
import {
  Activity,
  Boxes,
  Brain,
  Cable,
  CalendarCheck,
  Forward,
  MessageCircleQuestionMark,
  Puzzle,
  Radar,
  ScrollText,
  ShieldCheck,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const LINKS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/products", label: "Products", icon: Boxes },
  { href: "/time", label: "Time", icon: Timer },
  { href: "/gaps", label: "Gaps", icon: Puzzle },
  { href: "/ask", label: "Ask", icon: MessageCircleQuestionMark },
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

const isCurrent = (href: string, path: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

// A sidebar from md up. Below it, a top bar that scrolls sideways: every link is an icon except the current one,
// which shows its name and is scrolled into view, so the bar works at 360px with every link in it.
export function Nav({ admin = false, myDay = null }: { admin?: boolean; myDay?: number | null }) {
  const path = usePathname();
  const bar = useRef<HTMLElement>(null);
  const plugin = myDay !== null;
  const links = [...(plugin ? [MY_DAY] : []), ...LINKS, ...(admin ? [ADMIN] : [])];

  useEffect(() => {
    const nav = bar.current;
    const all = [...(plugin ? [MY_DAY] : []), ...LINKS, ...(admin ? [ADMIN] : [])];
    const link = nav?.children[all.findIndex(({ href }) => isCurrent(href, path))];
    if (!nav || !(link instanceof HTMLElement) || nav.scrollWidth <= nav.clientWidth) return;
    // offsetLeft is measured from the nav (it is the positioned ancestor); centre the link where it can be.
    nav.scrollLeft = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
  }, [path, admin, plugin]);

  return (
    <nav
      ref={bar}
      aria-label="Main"
      className="relative flex gap-1 max-md:-my-1 max-md:min-w-0 max-md:flex-1 max-md:overflow-x-auto max-md:p-1 max-md:[scrollbar-width:none] md:flex-col max-md:[&::-webkit-scrollbar]:hidden"
    >
      {links.map(({ href, label, icon: Icon }) => {
        const current = isCurrent(href, path);
        const waiting = href === MY_DAY.href && myDay ? myDay : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`relative flex min-h-11 min-w-11 flex-none items-center gap-3 rounded-[10px] px-3 font-medium text-[14px] transition-colors max-md:justify-center ${
              current ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:bg-surface/60 hover:text-ink"
            }`}
          >
            <Icon size={17} aria-hidden className={current ? "text-accent" : "text-ink-3"} />
            <span className={current ? "whitespace-nowrap" : "whitespace-nowrap max-md:sr-only"}>{label}</span>
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
