"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}

export function CodeLine({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-line bg-sunk py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[13px] text-ink">{code}</code>
      <CopyButton text={code} />
    </div>
  );
}
