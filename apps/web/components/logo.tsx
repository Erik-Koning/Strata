import { useId } from "react";

// The mark, exactly as the explainer video exports it (docs/explainer/strata-logo.svg): four wave layers stacked like
// strata, the faintest at the bottom, one violet-to-fuchsia sweep across each. Its colours are fixed, the same in either
// theme. `size` is its width; it is a little wider than tall.
const WAVES = [
  { d: "M10 88 C 34 76, 52 98, 76 86 S 104 80, 110 84", opacity: 0.5 },
  { d: "M10 64 C 34 52, 52 74, 76 62 S 104 56, 110 60", opacity: 0.68 },
  { d: "M10 40 C 34 28, 52 50, 76 38 S 104 32, 110 36", opacity: 0.85 },
  { d: "M10 16 C 34 4, 52 26, 76 14 S 104 8, 110 12", opacity: 1 },
];

export function Mark({ size = 24 }: { size?: number }) {
  // Each mark gets its own gradient id: a shared one breaks when the first copy on the page is hidden.
  const gradient = `strata-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      width={size}
      height={Math.round((size * 104) / 120)}
      viewBox="0 0 120 104"
      aria-hidden="true"
      className="flex-none"
      fill="none"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#5b21b6" />
          <stop offset=".6" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#c026d3" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gradient})`} strokeWidth="9" strokeLinecap="round">
        {WAVES.map((w) => (
          <path key={w.d} d={w.d} opacity={w.opacity} />
        ))}
      </g>
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
