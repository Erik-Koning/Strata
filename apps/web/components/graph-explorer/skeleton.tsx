// What the graph page shows while it reads and lays out: the header, the filters and the box the graph goes in.
const BAR = "animate-pulse rounded-[6px] bg-surface-2";

export function GraphSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the graph</span>
      <div className="mb-8">
        <span className={`${BAR} block h-3 w-16`} />
        <span className={`${BAR} mt-3 block h-8 w-72 max-w-full`} />
        <span className={`${BAR} mt-3 block h-4 w-[520px] max-w-full`} />
      </div>
      <div className="mb-5 flex flex-col gap-4">
        <span className={`${BAR} block h-11 w-full max-w-[380px] sm:h-10`} />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className={`${BAR} block h-11 sm:h-8`} style={{ width: `${72 + ((i * 23) % 48)}px` }} />
          ))}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="card overflow-hidden">
          <div className="flex gap-2 border-line border-b p-3">
            <span className={`${BAR} block h-11 flex-1 sm:h-9`} />
            <span className={`${BAR} block h-11 w-40 sm:h-9`} />
          </div>
          <div className="grid h-[min(68dvh,640px)] min-h-[340px] place-items-center bg-sunk">
            <span className="text-[13px] text-ink-3">Laying out the graph…</span>
          </div>
        </div>
        <div className="card hidden h-64 lg:block" />
      </div>
    </div>
  );
}
