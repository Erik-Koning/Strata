import { DigestHeader } from "./header.tsx";

const BAR = "animate-pulse rounded-[6px] bg-surface-2";

// While the week loads: the page's shape, quietly.
export default function DigestLoading() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Loading the weekly digest
      </p>
      <DigestHeader />
      <div className="mb-6 flex flex-wrap items-center gap-3" aria-hidden>
        <div className="min-w-0 flex-1">
          <span className={`${BAR} block h-5 w-40`} />
          <span className={`${BAR} mt-2 block h-3.5 w-64 max-w-full`} />
        </div>
        <span className={`${BAR} block h-9 w-36`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" aria-hidden>
        <div className="flex min-w-0 flex-col gap-6">
          {[0, 1].map((i) => (
            <div key={i} className="card">
              <div className="border-line border-b px-5 py-3.5">
                <span className={`${BAR} block h-4 w-32`} />
              </div>
              <div className="flex flex-col gap-2.5 px-5 py-4">
                {[88, 72, 80, 54].map((w) => (
                  <span key={w} className={`${BAR} h-3.5`} style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {[0, 1].map((i) => (
            <div key={i} className="card">
              <div className="border-line border-b px-5 py-3.5">
                <span className={`${BAR} block h-4 w-28`} />
              </div>
              <div className="flex flex-col gap-2.5 px-5 py-4">
                {[80, 64].map((w) => (
                  <span key={w} className={`${BAR} h-3.5`} style={{ width: `${w}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
