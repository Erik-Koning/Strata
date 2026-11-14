import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Martian_Mono, Saira } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Geist to read, Geist Mono for exact bytes (the explainer video's pair); Saira wide caps for legends and labels and
// Martian Mono for part labels (Ridenet's fairing kit). globals.css maps them to font-sans, font-mono, font-label and
// font-part.
const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const label = Saira({ subsets: ["latin"], axes: ["wdth"], variable: "--font-saira", display: "swap" });
const part = Martian_Mono({ subsets: ["latin"], variable: "--font-martian", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Strata", template: "%s · Strata" },
  description: "Long-term memory for coding agents, without breaking the prompt cache.",
};

export const viewport: Viewport = {
  // Light by default, whatever the system says; the dark palette is opt-in (data-theme="dark" on <html>).
  themeColor: "#eeebf7",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${label.variable} ${part.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
