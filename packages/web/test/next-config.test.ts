import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import {
  WORKSPACE_SOURCE_PACKAGE_NAMES,
  installSourceExtensionAliases,
  resolveWorkspaceSourceEntries,
} from "../next.config";
import nextConfig from "../next.config";

test("resolveWorkspaceSourceEntries points at source package entries", () => {
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/packages/web")["@healthybob/query"],
    path.resolve("/repo/packages/query/src/index.ts"),
  );
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/packages/web")["@healthybob/contracts"],
    path.resolve("/repo/packages/contracts/src/index.ts"),
  );
  assert.equal(
    resolveWorkspaceSourceEntries("/repo/packages/web")["@healthybob/hosted-execution"],
    path.resolve("/repo/packages/hosted-execution/src/index.ts"),
  );
});

test("next.config transpiles workspace source packages instead of pinning dist aliases", () => {
  assert.deepEqual(nextConfig.transpilePackages, [...WORKSPACE_SOURCE_PACKAGE_NAMES]);
});

test("next.config configures Turbopack to resolve workspace .js specifiers to TS sources", () => {
  assert.equal(nextConfig.turbopack?.root, process.cwd());
  assert.deepEqual(Object.keys(nextConfig.turbopack?.rules ?? {}), [
    "*.ts",
    "*.tsx",
    "*.mts",
    "*.cts",
  ]);
  assert.deepEqual(nextConfig.turbopack?.rules?.["*.ts"], {
    as: "*.ts",
    condition: {
      all: [{ not: "foreign" }, { path: /^packages\/[^/]+\/src\// }],
    },
    loaders: [path.resolve(process.cwd(), "config/turbopack-rewrite-relative-js-imports-loader.cjs")],
  });
  assert.deepEqual(nextConfig.turbopack?.resolveExtensions, [
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".mts",
    ".mjs",
    ".cts",
    ".cjs",
    ".json",
  ]);
});

test("installSourceExtensionAliases lets Next resolve workspace .js specifiers to TS sources", () => {
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
