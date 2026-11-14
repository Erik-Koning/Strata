import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Wordmark } from "../../components/logo.tsx";
import { Nav } from "../../components/nav.tsx";
import { waitingOn } from "../../server/stats.ts";
import { requireViewer } from "../../server/viewer.ts";
import { signOut } from "../(auth)/actions.ts";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  const initials = viewer.name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const admin = viewer.role === "admin";
  const myDay = viewer.usesPlugin ? await waitingOn(viewer.userId) : null;
  // Six links leave no room on a phone for the logo beside them at 44 px each.
  const crowded = admin && myDay !== null;
  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-10 flex items-center justify-between gap-3 border-line border-b bg-bg/90 px-4 py-2.5 backdrop-blur md:h-dvh md:flex-col md:items-stretch md:justify-start md:gap-8 md:border-r md:border-b-0 md:px-4 md:py-6">
        <div className={crowded ? "max-md:hidden" : undefined}>
          <div className="max-md:[&_span.text-\[16px\]]:hidden">
            <Wordmark />
          </div>
        </div>
        <Nav admin={admin} myDay={myDay} />
        <div className="hidden md:mt-auto md:block">
          <div className="flex items-center gap-3 rounded-[12px] px-2 py-2">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-accent-soft font-semibold text-[13px] text-accent-text">
              {initials || "?"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-[14px]">{viewer.name}</span>
              <span className="block truncate text-[12.5px] text-ink-3">{viewer.email}</span>
            </span>
          </div>
          <form action={signOut}>
            <button type="submit" className="btn btn-quiet btn-sm mt-1 w-full justify-start">
              <LogOut size={15} aria-hidden /> Sign out
            </button>
          </form>
        </div>
        <form action={signOut} className="md:hidden">
          <button type="submit" className="btn btn-quiet btn-sm min-h-11" aria-label="Sign out">
            <LogOut size={17} aria-hidden />
          </button>
        </form>
      </aside>
      <main className="min-w-0 px-4 pt-6 pb-16 sm:px-8 md:pt-10">
        <div className="mx-auto max-w-[1120px]">{children}</div>
      </main>
    </div>
  );
}
