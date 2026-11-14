export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="flex-none">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect x="8" y="8.5" width="10" height="3.5" rx="1.75" fill="var(--accent-ink)" />
      <rect x="8" y="14.25" width="16" height="3.5" rx="1.75" fill="var(--accent-ink)" opacity=".85" />
      <rect x="8" y="20" width="16" height="3.5" rx="1.75" fill="var(--accent-ink)" opacity=".6" />
      <circle cx="22.25" cy="10.25" r="2.25" fill="var(--accent-ink)" opacity=".7" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark />
      <span className="text-[15px] font-semibold tracking-[-0.015em]">Strata</span>
    </span>
  );
}
