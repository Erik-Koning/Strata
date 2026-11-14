"use client";
import { Activity, Brain, Cable, Forward, Radar, ScrollText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: typeof Activity };

// The product, in the order of its story: what's happening, work handed on, what's remembered, what it adds up to.
const PRIMARY: Item[] = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/relay", label: "Relay", icon: Forward },
  { href: "/memories", label: "Memory", icon: Brain },
  { href: "/intelligence", label: "Intelligence", icon: Radar },
];

const WORKSPACE: Item[] = [
  { href: "/connect", label: "Connect", icon: Cable },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];

// Admins also get the page for people, roles, teams and invitations.
const ADMIN: Item = { href: "/admin", label: "People", icon: ShieldCheck };

function NavLink({ item, current }: { item: Item; current: boolean }) {
  const { href, label, icon: Icon } = item;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      title={label}
      className={`relative flex min-h-11 items-center gap-2.5 rounded-[7px] px-2.5 font-medium text-[13.5px] transition-colors md:min-h-8 ${
        current ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink"
      }`}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className={current ? "text-accent" : "text-ink-3"} />
      <span className="max-md:sr-only">{label}</span>
    </Link>
  );
}

export function Nav({ admin = false }: { admin?: boolean }) {
  const path = usePathname();
  const isCurrent = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const workspace = admin ? [...WORKSPACE, ADMIN] : WORKSPACE;
  return (
    <nav aria-label="Main" className="flex min-w-0 gap-1 overflow-x-auto md:flex-col md:gap-6 md:overflow-visible">
      <ul className="flex gap-0.5 md:flex-col">
        {PRIMARY.map((item) => (
          <li key={item.href}>
            <NavLink item={item} current={isCurrent(item.href)} />
          </li>
        ))}
      </ul>
      <div className="flex gap-0.5 border-line max-md:border-l max-md:pl-1 md:flex-col">
        <p className="eyebrow mb-1 hidden px-2.5 md:block">Workspace</p>
        <ul className="flex gap-0.5 md:flex-col">
          {workspace.map((item) => (
            <li key={item.href}>
              <NavLink item={item} current={isCurrent(item.href)} />
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
