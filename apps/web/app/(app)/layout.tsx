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
  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-20 flex items-center justify-between gap-3 border-line border-b bg-bg/95 px-3 py-2 backdrop-blur md:h-dvh md:flex-col md:items-stretch md:justify-start md:gap-7 md:overflow-y-auto md:border-r md:border-b-0 md:bg-bg md:px-3 md:py-5">
        <div className="flex-none px-1 max-md:[&_span.text-\[15px\]]:hidden">
          <Wordmark />
        </div>
        <div className="min-w-0 flex-1 md:flex-none">
          <Nav admin={admin} myDay={myDay} />
        </div>
        <div className="hidden md:mt-auto md:block">
          <div className="flex items-center gap-2.5 rounded-[8px] border border-line px-2 py-2">
            <span className="grid size-7 flex-none place-items-center rounded-full bg-surface-3 font-semibold text-[11px] text-ink-2">
              {initials || "?"}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-medium text-[13px]">{viewer.name}</span>
              <span className="block truncate text-[11.5px] text-ink-3">{viewer.email}</span>
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="btn btn-quiet btn-sm size-7 min-h-7 p-0"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={14} aria-hidden />
              </button>
            </form>
          </div>
        </div>
        <form action={signOut} className="flex-none md:hidden">
          <button type="submit" className="btn btn-quiet btn-sm min-h-11" aria-label="Sign out">
            <LogOut size={17} aria-hidden />
          </button>
        </form>
      </aside>
      <main className="min-w-0 px-4 pt-6 pb-16 sm:px-8 md:pt-8 lg:px-10">
        <div className="mx-auto max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
