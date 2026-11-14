"use client";
// A time as people read it ("3 h ago"), with the exact time, in the viewer's zone, on hover or focus.
import { useEffect, useState } from "react";

function relative(then: number, now: number): string {
  const s = Math.round((now - then) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function Ago({ at, className }: { at: string; className?: string }) {
  const then = new Date(at).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const exact = new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <time dateTime={at} title={exact} className={className} suppressHydrationWarning>
      <span aria-hidden={now !== null}>{now === null ? exact : relative(then, now)}</span>
      {now === null ? null : <span className="sr-only">{exact}</span>}
    </time>
  );
}
