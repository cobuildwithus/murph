import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { resolveWorkspaceSourceEntries } from "./next.config";

const packageDir = path.dirname(fileURLToPath(import.meta.url));

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createVitestWorkspaceRuntimeAliases(packageDir: string) {
  const sourceEntries = resolveWorkspaceSourceEntries(packageDir);

  return Object.entries(sourceEntries).flatMap(([packageName, entryPath]) => {
    const sourceDir = path.dirname(entryPath);
    const escapedPackageName = escapeRegex(packageName);

    return [
      {
        find: new RegExp(`^${escapedPackageName}$`),
        replacement: entryPath,
      },
      {
        find: new RegExp(`^${escapedPackageName}/(.+)$`),
        replacement: `${sourceDir}/$1.ts`,
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
