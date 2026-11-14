// The mark wears the explainer's violet-to-fuchsia, lit from the upper left like everything else.
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="flex-none">
      <defs>
        <linearGradient id="strata-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="0.6" stopColor="#6d28d9" />
          <stop offset="1" stopColor="#c026d3" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#strata-mark)" />
      <rect x="8" y="8.5" width="10" height="3.5" rx="1.75" fill="#ffffff" />
      <rect x="8" y="14.25" width="16" height="3.5" rx="1.75" fill="#ffffff" opacity=".85" />
      <rect x="8" y="20" width="16" height="3.5" rx="1.75" fill="#ffffff" opacity=".6" />
      <circle cx="22.25" cy="10.25" r="2.25" fill="#ffffff" opacity=".7" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark />
      <span className="text-[16px] font-semibold tracking-[-0.01em]">Strata</span>
    </span>
  );
}
