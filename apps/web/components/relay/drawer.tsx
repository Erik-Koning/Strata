"use client";
// The evidence inspector: a side panel holding what travels with a handoff (shared memories, changed files, the
// activity log). Any trigger can open it at a section. Its content is server-rendered and stays in the page while
// closed, so nothing is fetched on open.
import { X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

type Ctx = { open: (target?: string) => void };
const DrawerContext = createContext<Ctx | null>(null);
const DRAWER_ID = "evidence-drawer";

export function DrawerProvider({ title, panel, children }: { title: string; panel: ReactNode; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [target, setTarget] = useState<string | undefined>();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const open = useCallback((t?: string) => {
    returnTo.current = document.activeElement as HTMLElement | null;
    setTarget(t);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    returnTo.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    panel?.focus();
    const el = target ? document.getElementById(target) : null;
    if (el && panel) panel.scrollTo({ top: el.offsetTop - 72 });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, target, close]);

  return (
    <DrawerContext.Provider value={{ open }}>
      {children}
      <div className={isOpen ? "fixed inset-0 z-40" : "hidden"}>
        <button
          type="button"
          aria-label="Close evidence"
          tabIndex={-1}
          className="drawer-backdrop absolute inset-0 cursor-default"
          onClick={close}
        />
        <div
          id={DRAWER_ID}
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-[min(480px,100vw)] flex-col overflow-y-auto border-line border-l bg-surface shadow-[var(--shadow-pop)] outline-none"
        >
          <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-line border-b bg-surface/95 px-5 backdrop-blur">
            <div className="min-w-0">
              <p className="eyebrow">Evidence</p>
              <h2 id="drawer-title" className="truncate font-semibold text-[14px]">
                {title}
              </h2>
            </div>
            <button type="button" onClick={close} className="btn btn-quiet btn-sm size-8 p-0" aria-label="Close">
              <X size={16} aria-hidden />
            </button>
          </header>
          <div className="grid content-start gap-7 px-5 py-5">{panel}</div>
        </div>
      </div>
    </DrawerContext.Provider>
  );
}

export function DrawerTrigger({
  target,
  className = "",
  children,
}: {
  target?: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(DrawerContext);
  if (!ctx) return null;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-controls={DRAWER_ID}
      onClick={() => ctx.open(target)}
      className={className}
    >
      {children}
    </button>
  );
}
