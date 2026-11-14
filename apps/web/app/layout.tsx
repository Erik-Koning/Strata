import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans, Martian_Mono, Saira } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Geist to read, Geist Mono for exact bytes (the explainer video's pair); Saira wide caps for legends and labels and
// Martian Mono for part labels (Ridenet's fairing kit). globals.css maps them to font-sans, font-mono, font-label and
// font-part.
// Instrument Sans to read: a narrow, precise grotesk that holds big tight headlines and small UI text alike.
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const label = Saira({ subsets: ["latin"], axes: ["wdth"], variable: "--font-saira", display: "swap" });
const part = Martian_Mono({ subsets: ["latin"], variable: "--font-martian", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Strata", template: "%s · Strata" },
  description: "Long-term memory for coding agents, without breaking the prompt cache.",
};

export const viewport: Viewport = {
  themeColor: "#f6f5f2",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${label.variable} ${part.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
