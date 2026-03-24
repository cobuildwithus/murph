import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { resolveWorkspaceSourceEntries } from "./next.config";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createVitestWorkspaceRuntimeAliases(appDir: string) {
  const sourceEntries = resolveWorkspaceSourceEntries(appDir);

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
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(repoRoot, "apps/web"),
      },
      ...createVitestWorkspaceRuntimeAliases(appDir),
    ],
  },
  test: {
    environment: "node",
    include: ["apps/web/test/**/*.test.ts"],
  },
});
