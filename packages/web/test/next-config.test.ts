import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import {
  installQueryRuntimeAlias,
  resolveQueryRuntimeEntryPath,
  resolveWorkspaceRuntimeAliases,
} from "../next.config";

test("resolveQueryRuntimeEntryPath points at the built query entry", () => {
  assert.equal(
    resolveQueryRuntimeEntryPath("/repo/packages/web"),
    path.resolve("/repo/packages/query/dist/index.js"),
  );
});

test("installQueryRuntimeAlias pins @healthybob/query to the built package output", () => {
  const config = installQueryRuntimeAlias(
    {
      resolve: {
        alias: {
          react: "/repo/node_modules/react/index.js",
        },
      },
    },
    "/repo/packages/web",
  );

  assert.equal(Array.isArray(config.resolve?.alias), false);

  if (!config.resolve?.alias || Array.isArray(config.resolve.alias)) {
    assert.fail("Expected webpack aliases to remain an object map.");
  }

  const aliases = config.resolve.alias as Record<string, unknown>;
  const workspaceRuntimeAliases = resolveWorkspaceRuntimeAliases("/repo/packages/web");

  assert.equal(aliases.react, "/repo/node_modules/react/index.js");
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(aliases).filter(([name]) => name.startsWith("@healthybob/")),
    ),
    Object.fromEntries(
      Object.entries(workspaceRuntimeAliases).map(([packageName, alias]) => [
        `${packageName}$`,
        alias,
      ]),
    ),
  );
});

test("installQueryRuntimeAlias preserves webpack alias arrays", () => {
  const config = installQueryRuntimeAlias(
    {
      resolve: {
        alias: [
          {
            alias: "/repo/node_modules/react/index.js",
            name: "react",
            onlyModule: true,
          },
          {
            alias: "/stale/query.js",
            name: "@healthybob/query",
            onlyModule: true,
          },
          {
            alias: "/stale/contracts.js",
            name: "@healthybob/contracts",
            onlyModule: true,
          },
        ],
      },
    },
    "/repo/packages/web",
  );

  assert.equal(Array.isArray(config.resolve?.alias), true);

  if (!config.resolve?.alias || !Array.isArray(config.resolve.alias)) {
    assert.fail("Expected webpack aliases to remain an array.");
  }

  const workspaceRuntimeAliases = resolveWorkspaceRuntimeAliases("/repo/packages/web");

  assert.deepEqual(config.resolve.alias, [
    {
      alias: "/repo/node_modules/react/index.js",
      name: "react",
      onlyModule: true,
    },
    ...Object.entries(workspaceRuntimeAliases).map(([packageName, alias]) => ({
      alias,
      name: packageName,
      onlyModule: true,
    })),
  ]);
});
