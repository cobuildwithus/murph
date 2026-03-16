import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(packageDir, "../.."),
  typescript: {
    // Repo verification runs a dedicated package-local typecheck before build.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
