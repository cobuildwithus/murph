import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { resolveWorkspaceRuntimeAliases } from "./next.config";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createVitestWorkspaceRuntimeAliases(packageDir: string) {
  const runtimeAliases = resolveWorkspaceRuntimeAliases(packageDir);

  return Object.entries(runtimeAliases).flatMap(([packageName, entryPath]) => {
    const distDir = path.dirname(entryPath);
    const escapedPackageName = escapeRegex(packageName);

    return [
      {
        find: new RegExp(`^${escapedPackageName}$`),
        replacement: entryPath,
      },
      {
        find: new RegExp(`^${escapedPackageName}/(.+)$`),
        replacement: `${distDir}/$1.js`,
      },
    ];
  });
}

export default defineConfig({
  oxc: {
    jsx: {
      importSource: "react",
      runtime: "automatic",
    },
  },
  resolve: {
    alias: createVitestWorkspaceRuntimeAliases(packageDir),
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["packages/web/test/**/*.test.ts"],
  },
});
