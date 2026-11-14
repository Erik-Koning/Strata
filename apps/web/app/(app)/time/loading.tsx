import { TimeHeader } from "./header.tsx";

// While the figures, trends and pain points load: the page's shape, quietly.
export default function TimeLoading() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading where engineering time goes
      </p>
      <TimeHeader />
      <div className="mb-6 flex flex-wrap gap-3" aria-hidden>
        <div className="h-9 w-56 animate-pulse rounded-[10px] bg-surface-2" />
        <div className="h-[42px] min-w-0 flex-1 animate-pulse rounded-[10px] bg-surface-2 sm:max-w-md" />
      </div>
      <div className="card mb-6 p-6" aria-hidden>
        <div className="h-3.5 w-48 animate-pulse rounded bg-surface-2" />
        <div className="mt-3 h-11 w-36 animate-pulse rounded bg-surface-2" />
        <div className="mt-4 h-3.5 w-full max-w-xl animate-pulse rounded bg-surface-2" />
      </div>
      <div className="card divide-y divide-line" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="px-5 py-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
            <div className="mt-3 h-2 animate-pulse rounded-r-[4px] bg-surface-2" style={{ width: `${90 - i * 20}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
