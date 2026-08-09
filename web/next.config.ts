import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Standalone + middleware/proxy buffers bodies; default is too small for PDFs.
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
