import type { NextConfig } from "next";

/**
 * FirstLight — Next.js config.
 * - Default (`next dev` / `next build`): standalone output for container deploys.
 * - BUILD_MODE=static: static export to `out/` — deployable to GitHub Pages,
 *   Netlify, Vercel, or any static host (this app is fully client-side).
 * - NEXT_PUBLIC_BASE_PATH: set to `/firstlight` for GitHub Pages project sites.
 */
const isStatic = process.env.BUILD_MODE === "static";

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : { output: "standalone" }),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
