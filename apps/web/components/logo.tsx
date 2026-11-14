// The mark: one unbroken line folding through three layers, the way context travels from one session to the next
// without breaking. Drawn in the accent, no tile behind it.
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="flex-none" fill="none">
      <path
        d="M3.5 5.5H15.5L8.5 12H20.5L13.5 18.5H3.5"
        stroke="var(--accent)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20.5" cy="12" r="1.9" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark />
      <span className="font-semibold text-[16px] text-ink tracking-[-0.02em]">Strata</span>
    </span>
  );
}
