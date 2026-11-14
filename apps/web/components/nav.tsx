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

type Item = { href: string; label: string; icon: typeof Activity };

// The product, in the order of its story: what's happening, work handed on, what's remembered, what it adds up to.
const PRIMARY: Item[] = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/relay", label: "Relay", icon: Forward },
  { href: "/memories", label: "Memory", icon: Brain },
  { href: "/intelligence", label: "Intelligence", icon: Radar },
];

// The team hub: what the team builds, where its time goes, what context is missing, and a question to ask of it all.
const TEAM: Item[] = [
  { href: "/products", label: "Products", icon: Boxes },
  { href: "/time", label: "Time", icon: Timer },
  { href: "/gaps", label: "Gaps", icon: Puzzle },
  { href: "/ask", label: "Ask", icon: MessageCircleQuestionMark },
];

const WORKSPACE: Item[] = [
  { href: "/connect", label: "Connect", icon: Cable },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];

// People who use the plugin themselves get My Day first: where they approve what their sessions drafted.
const MY_DAY: Item = { href: "/my-day", label: "My Day", icon: CalendarCheck };
// Admins also get the page for people, roles, teams and invitations.
const ADMIN: Item = { href: "/admin", label: "People", icon: ShieldCheck };

const isCurrent = (href: string, path: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

function NavLink({ item, current, waiting = 0 }: { item: Item; current: boolean; waiting?: number }) {
  const { href, label, icon: Icon } = item;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      title={label}
      className={`relative flex min-h-11 min-w-11 flex-none items-center gap-2.5 rounded-[7px] px-2.5 font-medium text-[13.5px] transition-colors max-md:justify-center md:min-h-8 ${
        current ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink"
      }`}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className={current ? "text-accent-text" : "text-ink-3"} />
      <span className={current ? "whitespace-nowrap" : "whitespace-nowrap max-md:sr-only"}>{label}</span>
      {waiting ? (
        <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-accent px-1.5 font-semibold text-[11px] text-accent-ink leading-5 max-md:absolute max-md:top-0.5 max-md:right-0.5 max-md:min-w-4 max-md:px-1 max-md:text-[10px] max-md:leading-4">
          {waiting > 99 ? "99+" : waiting}
          <span className="sr-only"> waiting for you</span>
        </span>
      ) : null}
    </Link>
  );
}

function Group({ label, items, path, myDay }: { label?: string; items: Item[]; path: string; myDay?: number | null }) {
  return (
    <div className="flex gap-0.5 md:flex-col">
      {label ? <p className="eyebrow mb-1 hidden px-2.5 md:block">{label}</p> : null}
      <ul className="flex gap-0.5 md:flex-col">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink
              item={item}
              current={isCurrent(item.href, path)}
              waiting={item.href === MY_DAY.href && myDay ? myDay : 0}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// A sidebar from md up, in groups. Below it, a top bar that scrolls sideways: every link is an icon except the
// current one, which shows its name and is scrolled into view, so the bar works at 360px with every link in it.
export function Nav({ admin = false, myDay = null }: { admin?: boolean; myDay?: number | null }) {
  const path = usePathname();
  const bar = useRef<HTMLElement>(null);
  const plugin = myDay !== null;
  const primary = plugin ? [MY_DAY, ...PRIMARY] : PRIMARY;
  const workspace = admin ? [...WORKSPACE, ADMIN] : WORKSPACE;

  // Re-run when the links change: a new page, or My Day / People appearing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers, not values read inside.
  useEffect(() => {
    const nav = bar.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    const offset = link.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    nav.scrollLeft = offset - (nav.clientWidth - link.offsetWidth) / 2;
  }, [path, admin, plugin]);

  return (
    <nav
      ref={bar}
      aria-label="Main"
      className="relative flex min-w-0 gap-1 max-md:-my-1 max-md:overflow-x-auto max-md:p-1 max-md:[scrollbar-width:none] md:flex-col md:gap-6 max-md:[&::-webkit-scrollbar]:hidden"
    >
      <Group items={primary} path={path} myDay={myDay} />
      <div className="flex border-line max-md:border-l max-md:pl-1">
        <Group label="Team" items={TEAM} path={path} />
      </div>
      <div className="flex border-line max-md:border-l max-md:pl-1">
        <Group label="Workspace" items={workspace} path={path} />
      </div>
    </nav>
  );
}
