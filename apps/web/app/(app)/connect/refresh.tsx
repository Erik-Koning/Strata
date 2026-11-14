"use client";
// While no client has connected, the page looks again every few seconds, so the first session shows up by itself.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RefreshWhileWaiting({ waiting }: { waiting: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [waiting, router]);
  return null;
}
