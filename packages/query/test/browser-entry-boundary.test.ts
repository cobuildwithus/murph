import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserEntryPath = path.join(packageDir, "src/browser.ts");

test("@murphai/query/browser stays free of node builtins and node-shaped entrypoints", async () => {
  const visited = new Set<string>();
  const pending = [browserEntryPath];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    assert.ok(currentPath);

    if (visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);

    const source = await readFile(currentPath, "utf8");
    const importSpecifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ].map((match) => match[1]);

    for (const specifier of importSpecifiers) {
      assert.ok(specifier);
      assert.doesNotMatch(
        specifier,
        /^node:/u,
        `${path.relative(packageDir, currentPath)} must not import Node builtins through ${specifier}.`,
      );
      assert.notEqual(
        specifier,
        "./model.ts",
        `${path.relative(packageDir, currentPath)} must not import ./model.ts from the browser entry graph.`,
      );
      assert.notEqual(
        specifier,
        "./vault-source.ts",
        `${path.relative(packageDir, currentPath)} must not import ./vault-source.ts from the browser entry graph.`,
      );

      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        continue;
      }

      pending.push(path.resolve(path.dirname(currentPath), specifier));
    }
  }
});
