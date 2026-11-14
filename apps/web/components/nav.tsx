"use client";
import {
  Activity,
  Boxes,
  Brain,
  Cable,
  MessageCircleQuestionMark,
  Puzzle,
  ScrollText,
  ShieldCheck,
  Sunrise,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const LINKS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/my-day", label: "My Day", icon: Sunrise },
  { href: "/products", label: "Products", icon: Boxes },
  { href: "/time", label: "Time", icon: Timer },
  { href: "/gaps", label: "Gaps", icon: Puzzle },
  { href: "/ask", label: "Ask", icon: MessageCircleQuestionMark },
  { href: "/memories", label: "Memories", icon: Brain },
  { href: "/connect", label: "Connect", icon: Cable },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];

// Admins also get the page for people, roles, teams and invitations.
const ADMIN = { href: "/admin", label: "People", icon: ShieldCheck };

const isCurrent = (href: string, path: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

// A sidebar from md up. Below it, a top bar that scrolls sideways: every link is an icon except the current one,
// which shows its name and is scrolled into view, so the bar works at 360px with every link in it.
export function Nav({ admin = false }: { admin?: boolean }) {
  const path = usePathname();
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = bar.current;
    const at = (admin ? [...LINKS, ADMIN] : LINKS).findIndex(({ href }) => isCurrent(href, path));
    const link = nav?.children[at];
    if (!nav || !(link instanceof HTMLElement) || nav.scrollWidth <= nav.clientWidth) return;
    // offsetLeft is measured from the nav (it is the positioned ancestor); centre the link where it can be.
    nav.scrollLeft = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
  }, [path, admin]);

  return (
    <nav
      ref={bar}
      aria-label="Main"
      className="relative flex gap-1 max-md:-my-1 max-md:min-w-0 max-md:flex-1 max-md:overflow-x-auto max-md:p-1 max-md:[scrollbar-width:none] md:flex-col max-md:[&::-webkit-scrollbar]:hidden"
    >
      {(admin ? [...LINKS, ADMIN] : LINKS).map(({ href, label, icon: Icon }) => {
        const current = isCurrent(href, path);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 flex-none items-center gap-3 rounded-[10px] px-3 font-medium text-[14px] transition-colors ${
              current ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:bg-surface/60 hover:text-ink"
            }`}
          >
            <Icon size={17} aria-hidden className={current ? "text-accent" : "text-ink-3"} />
            <span className={current ? "whitespace-nowrap" : "whitespace-nowrap max-md:sr-only"}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
