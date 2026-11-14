// The task inbox: handoffs given to me, and the ones I sent. The selected one is in the URL (?id=).
import type { HandoffListItem } from "@strata/contracts";
import Link from "next/link";
import { Ago } from "../time.tsx";
import { StatusText } from "./status.tsx";

function Row({ item, selected, box }: { item: HandoffListItem; selected: boolean; box: "inbox" | "sent" }) {
  const counterpart =
    box === "inbox" ? `from ${item.sender.name}` : item.recipient ? `to ${item.recipient.name}` : "not sent";
  return (
    <li>
      <Link
        href={`/relay?id=${item._id}`}
        aria-current={selected ? "page" : undefined}
        title={item.project}
        className="relay-row relative block min-h-11 rounded-[8px] px-3 py-2.5 transition-colors hover:bg-surface-2/60"
      >
        <span className="line-clamp-2 font-medium text-[13.5px] text-ink leading-snug">{item.title}</span>
        <span className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ink-3">
          <StatusText status={item.status} />
          <span className="min-w-0 truncate">{counterpart}</span>
          <Ago at={item.updatedAt} className="ml-auto flex-none" />
        </span>
      </Link>
    </li>
  );
}

function Group({
  label,
  items,
  selected,
  box,
  empty,
}: {
  label: string;
  items: HandoffListItem[];
  selected: string | null;
  box: "inbox" | "sent";
  empty: string;
}) {
  const id = `box-${box}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="eyebrow flex items-center justify-between px-3 pb-1">
        {label}
        <span className="count">{items.length}</span>
      </h2>
      {items.length ? (
        <ul className="mt-1.5 grid gap-0.5">
          {items.map((item) => (
            <Row key={item._id} item={item} selected={item._id === selected} box={box} />
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 px-3 text-[13px] text-ink-3">{empty}</p>
      )}
    </section>
  );
}

export function Inbox({
  inbox,
  sent,
  selected,
}: {
  inbox: HandoffListItem[];
  sent: HandoffListItem[];
  selected: string | null;
}) {
  return (
    <div className="grid gap-6">
      <Group
        label="Inbox"
        box="inbox"
        items={inbox}
        selected={selected}
        empty="Nothing handed to you. When someone approves a handoff for you, it appears here."
      />
      <Group
        label="Sent"
        box="sent"
        items={sent}
        selected={selected}
        empty="Run /strata:handoff in Claude Code to draft one from your session."
      />
    </div>
  );
}
