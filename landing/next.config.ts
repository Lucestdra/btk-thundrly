import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  // Produce a self-contained Node server under `.next/standalone/` so the
  // Docker image is tiny (~150 MB) and doesn't need node_modules at runtime.
  // See https://nextjs.org/docs/app/api-reference/next-config-js/output
  output: "standalone",
};

export default nextConfig;
