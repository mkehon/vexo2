import os from "node:os";
import type { NextConfig } from "next";

// A phone reaches the dev server through this computer's network address (see scripts/dev.mjs).
// Next.js only serves its dev assets to hostnames listed here.
const networkAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry?.family === "IPv4" && !entry.internal)
  .map((entry) => entry!.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: [...networkAddresses, "*.local"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
