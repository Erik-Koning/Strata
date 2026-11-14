import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The workspace's root, so Turbopack and output tracing reach packages/contracts.
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const config: NextConfig = {
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  transpilePackages: ["@strata/contracts"],
  turbopack: { root },
  outputFileTracingRoot: root,
  // The clients speak the documented /v1 contract; the handlers sit under /api/v1 with the rest of the API.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: "/api/v1/:path*" }];
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default config;
