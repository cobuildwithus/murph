import assert from "node:assert/strict";
import path from "node:path";

import { test } from "vitest";

import { installQueryRuntimeAlias, resolveQueryRuntimeEntryPath } from "../next.config";

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

  assert.equal(aliases.react, "/repo/node_modules/react/index.js");
  assert.equal(
    aliases["@healthybob/query$"],
    path.resolve("/repo/packages/query/dist/index.js"),
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
        ],
      },
    },
    "/repo/packages/web",
  );

  assert.equal(Array.isArray(config.resolve?.alias), true);

  if (!config.resolve?.alias || !Array.isArray(config.resolve.alias)) {
    assert.fail("Expected webpack aliases to remain an array.");
  }

  assert.deepEqual(config.resolve.alias, [
    {
      alias: "/repo/node_modules/react/index.js",
      name: "react",
      onlyModule: true,
    },
    {
      alias: path.resolve("/repo/packages/query/dist/index.js"),
      name: "@healthybob/query",
      onlyModule: true,
    },
  ]);
});
