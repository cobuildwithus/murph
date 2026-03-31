import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { LOCAL_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES } from "../../config/workspace-source-resolution";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_SOURCE_PACKAGE_NAMES = LOCAL_WEB_WORKSPACE_SOURCE_PACKAGE_NAMES;

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(packageDir, "../.."),
  transpilePackages: [...WORKSPACE_SOURCE_PACKAGE_NAMES],
  turbopack: {
    root: path.resolve(packageDir, "../.."),
  },
  typescript: {
    // Repo verification runs a dedicated package-local typecheck before build.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
