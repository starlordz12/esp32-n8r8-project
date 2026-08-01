import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Pi container requests vinext's minimal self-hosted runtime. Normal
  // builds retain their existing output mode for local development/Sites.
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
};

export default nextConfig;
