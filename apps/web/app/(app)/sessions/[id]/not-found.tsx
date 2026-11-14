import { MessagesSquare } from "lucide-react";
import Link from "next/link";

// A session that doesn't exist, or that holds nothing this person may see: one whose author hasn't approved anything
// yet looks the same as one that was never there.
export default function SessionNotFound() {
  return (
    <section className="card px-6 py-14 text-center" aria-labelledby="no-session">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-surface-2 text-ink-3">
        <MessagesSquare size={17} aria-hidden />
      </span>
      <h1 id="no-session" className="mt-4 font-semibold text-[16px]">
        Nothing to show for this session
      </h1>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
        Either there's no such session, or nothing from it has been shared yet. A session shows here once its author
        approves its summary or findings.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href="/products" className="btn min-h-11 sm:min-h-10">
          Browse products
        </Link>
        <Link href="/" className="btn btn-quiet min-h-11 sm:min-h-10">
          Overview
        </Link>
      </div>
    </section>
  );
}
