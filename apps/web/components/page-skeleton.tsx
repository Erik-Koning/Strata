// What any page shows the moment it's opened, while its queries run: a header and the shapes of the cards to come.
// Pages with a layout of their own (products, digest, time, graph) have their own loading.tsx.
const BAR = "animate-pulse rounded-[6px] bg-surface-2";

function Card({ lines }: { lines: number }) {
  return (
    <div className="card">
      <div className="border-line border-b px-5 py-3.5">
        <span className={`${BAR} block h-4 w-32`} />
      </div>
      <div className="flex flex-col gap-2.5 px-5 py-4">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={`${BAR} h-3.5`} style={{ width: `${88 - ((i * 17) % 40)}%` }} />
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="mb-8">
        <span className={`${BAR} block h-3 w-20`} />
        <span className={`${BAR} mt-3 block h-8 w-64 max-w-full`} />
        <span className={`${BAR} mt-3 block h-4 w-96 max-w-full`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card lines={6} />
          <Card lines={4} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card lines={3} />
          <Card lines={3} />
        </div>
      </div>
    </div>
  );
}
