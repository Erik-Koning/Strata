// A session's findings of one kind, as a card: each with when it was shared and where it came from (logged by the agent
// during the session, or written into the session's summary). Items arrive serialised: plain strings, no Date.
import type { LucideIcon } from "lucide-react";
import { Ago } from "../time.tsx";

export interface FindingItem {
  id: string;
  title: string | null;
  text: string;
  // ISO time: when it was shared, or, for a draft, last changed.
  at: string;
  source: "record" | "summary";
}

const SOURCE: Record<FindingItem["source"], string> = {
  record: "Logged during the session",
  summary: "From the session's summary",
};

export function FindingGroup({
  id,
  title,
  icon: Icon,
  items,
  atLabel = "Shared",
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  items: FindingItem[];
  atLabel?: string;
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <header className="flex items-center gap-2 border-line border-b px-5 py-3.5">
        <Icon size={16} aria-hidden className="flex-none text-ink-3" />
        <h2 id={id} className="font-semibold text-[15px]">
          {title}
        </h2>
      </header>
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="px-5 py-3.5">
            {item.title ? <p className="mb-0.5 font-medium text-[14px]">{item.title}</p> : null}
            <p className="whitespace-pre-wrap break-words text-[14px]">{item.text}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
              <span>{SOURCE[item.source]}</span>
              <span aria-hidden>·</span>
              <span>
                {atLabel} <Ago at={item.at} />
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
