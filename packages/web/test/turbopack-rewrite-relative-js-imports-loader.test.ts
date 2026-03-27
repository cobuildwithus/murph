import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

const require = createRequire(import.meta.url);
const rewriteRelativeJsImports = require("../../../config/turbopack-rewrite-relative-js-imports-loader.cjs") as (
  this: { resourcePath: string },
  source: string,
) => string;

async function writeFixtureFiles(
  fixtureRoot: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }
}

async function withLoaderFixture(
  files: Readonly<Record<string, string>>,
  run: (fixtureRoot: string) => Promise<void>,
): Promise<void> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "hb-turbopack-loader-"));

  try {
    await writeFixtureFiles(fixtureRoot, files);
    await run(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

function rewriteSource(resourcePath: string, source: string): string {
  return rewriteRelativeJsImports.call({ resourcePath }, source);
}

test("rewrites relative .js, .mjs, and .cjs specifiers to existing source files", async () => {
  await withLoaderFixture(
    {
      "src/entry.ts": "",
      "src/foo.ts": "export const foo = 1;\n",
      "src/bar.mts": "export const bar = 1;\n",
      "src/baz.cts": "export const baz = 1;\n",
    },
    async (fixtureRoot) => {
      const resourcePath = path.join(fixtureRoot, "src/entry.ts");
      const source = [
        'import { foo } from "./foo.js";',
        'export { bar } from "./bar.mjs";',
        "async function load() {",
        '  return import("./baz.cjs");',
        "}",
      ].join("\n");

      assert.equal(
        rewriteSource(resourcePath, source),
        [
          'import { foo } from "./foo.ts";',
          'export { bar } from "./bar.mts";',
          "async function load() {",
          '  return import("./baz.cts");',
          "}",
        ].join("\n"),
      );
    },
  );
});

test("leaves package imports and unresolved relative specifiers unchanged", async () => {
  await withLoaderFixture(
    {
      "src/entry.ts": "",
    },
    async (fixtureRoot) => {
      const resourcePath = path.join(fixtureRoot, "src/entry.ts");
      const source = [
        'import { queryHealth } from "@healthybob/query";',
        'export * from "./missing.js";',
        'const load = () => import("./missing.cjs");',
      ].join("\n");

      assert.equal(rewriteSource(resourcePath, source), source);
    },
  );
});
