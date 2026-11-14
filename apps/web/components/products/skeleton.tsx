// What the products pages show while their queries run: the shapes of the cards to come.
const BAR = "animate-pulse rounded-[6px] bg-surface-2";

function Lines({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2.5 px-5 py-4">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${BAR} h-3.5`} style={{ width: `${88 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

function CardSkeleton({ lines }: { lines: number }) {
  return (
    <div className="card">
      <div className="border-line border-b px-5 py-3.5">
        <span className={`${BAR} block h-4 w-32`} />
      </div>
      <Lines count={lines} />
    </div>
  );
}

function Header() {
  return (
    <div className="mb-8">
      <span className={`${BAR} block h-3 w-20`} />
      <span className={`${BAR} mt-3 block h-8 w-64 max-w-full`} />
      <span className={`${BAR} mt-3 block h-4 w-96 max-w-full`} />
    </div>
  );
}

export function ProductListSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading products</span>
      <Header />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <CardSkeleton key={i} lines={3} />
        ))}
      </div>
    </div>
  );
}

export function ProductPageSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the product</span>
      <Header />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CardSkeleton lines={8} />
          <CardSkeleton lines={4} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}
