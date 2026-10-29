import type { NextConfig } from "next";

/**
 * FirstLight — Next.js config.
 *
 * Two supported run modes (see IMPLEMENTATION_BASELINE.md / README):
 * - DEMO MODE (default, `BUILD_MODE=static`): fully client-side simulated
 *   platform. Static export to `out/` — deployable to GitHub Pages, Netlify,
 *   or any static host. No server, no secrets, clearly labeled as simulated.
 * - OPERATIONAL MODE (`next build` + `next start`, or a container): server
 *   API, database persistence, authenticated users, open-data adapters.
 *   `DEMO_MODE=false` disables the DemoScenarioProvider except where an
 *   event explicitly carries a labeled synthetic layer.
 *
 * Type errors are NEVER skipped: `tsc --noEmit` is a hard CI gate and the
 * build validates types (`ignoreBuildErrors` removed in Phase 0).
 */
const isStatic = process.env.BUILD_MODE === "static";

/** Security headers for the operational (server) build. Static hosts apply
 * their own headers; these cover the Node/standalone deployment. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        output: "standalone",
        async headers() {
          return [{ source: "/(.*)", headers: securityHeaders }];
        },
      }),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  typescript: {
    // Do not skip type validation — the type gate is part of CI and builds.
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
