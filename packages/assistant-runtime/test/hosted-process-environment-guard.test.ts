import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import { describe, it } from "vitest";

const HOSTED_RUNTIME_ENV_WRAPPER_ALLOWED_FILES = new Set([
  "hosted-runtime/environment.ts",
]);

async function listHostedRuntimeSourceFiles(
  directory: URL,
  prefix = "",
): Promise<Array<{ relativePath: string; url: URL }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Array<{ relativePath: string; url: URL }> = [];

  for (const entry of entries) {
    const relativePath = `${prefix}${entry.name}`;
    const entryUrl = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory);
    if (entry.isDirectory()) {
      files.push(...await listHostedRuntimeSourceFiles(entryUrl, `${relativePath}/`));
    } else if (entry.name.endsWith(".ts")) {
      files.push({ relativePath, url: entryUrl });
    }
  }

  return files;
}

describe("hosted process environment guard", () => {
  it("keeps hosted invocation paths from using global process env/cwd wrappers", async () => {
    const sourceFiles = [
      {
        relativePath: "hosted-runtime.ts",
        url: new URL("../src/hosted-runtime.ts", import.meta.url),
      },
      ...await listHostedRuntimeSourceFiles(
        new URL("../src/hosted-runtime/", import.meta.url),
        "hosted-runtime/",
      ),
    ];

    for (const sourceFile of sourceFiles) {
      if (HOSTED_RUNTIME_ENV_WRAPPER_ALLOWED_FILES.has(sourceFile.relativePath)) {
        continue;
      }

      const source = await readFile(sourceFile.url, "utf8");
      assert.equal(
        source.includes("withHostedProcessEnvironment"),
        false,
        `${sourceFile.relativePath} must thread hosted env/cwd explicitly instead of mutating process globals`,
      );
      assert.equal(
        source.includes("process.chdir("),
        false,
        `${sourceFile.relativePath} must not change the process cwd; thread hosted cwd explicitly instead`,
      );
      assert.equal(
        source.includes("replaceProcessEnvironment("),
        false,
        `${sourceFile.relativePath} must not replace process.env; thread hosted env explicitly instead`,
      );
    }
  });
});
