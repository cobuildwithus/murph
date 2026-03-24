import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import nextConfig, {
  WORKSPACE_SOURCE_PACKAGE_NAMES,
  installSourceExtensionAliases,
  resolveWorkspaceSourceEntries,
} from "../next.config";

test("resolveWorkspaceSourceEntries points at hosted source package entries", () => {
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/apps/web")["@healthybob/device-syncd"],
    path.resolve("/repo/packages/device-syncd/src/index.ts"),
  );
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/apps/web")["@healthybob/core"],
    path.resolve("/repo/packages/core/src/index.ts"),
  );
});

test("next.config transpiles hosted workspace source packages instead of pinning dist aliases", () => {
  assert.deepEqual(nextConfig.transpilePackages, [...WORKSPACE_SOURCE_PACKAGE_NAMES]);
});

test("installSourceExtensionAliases lets Next resolve hosted workspace .js specifiers to TS sources", () => {
  const config = installSourceExtensionAliases({
    resolve: {
      extensionAlias: {
        ".jsx": [".tsx", ".jsx"],
      },
    },
  });

  assert.deepEqual(config.resolve?.extensionAlias, {
    ".jsx": [".tsx", ".jsx"],
    ".js": [".ts", ".tsx", ".js"],
    ".mjs": [".mts", ".mjs"],
    ".cjs": [".cts", ".cjs"],
  });
});
