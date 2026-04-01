import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { test } from "vitest";

const execFileAsync = promisify(execFile);
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const subpaths = [
  {
    exportKey: "./linq",
    label: "linq",
    packageImport: "@murphai/inboxd/linq",
    sourceFile: "src/linq.ts",
  },
  {
    exportKey: "./linq-webhook",
    label: "linq webhook",
    packageImport: "@murphai/inboxd/linq-webhook",
    sourceFile: "src/linq-webhook.ts",
  },
  {
    exportKey: "./telegram-webhook",
    label: "telegram webhook",
    packageImport: "@murphai/inboxd/telegram-webhook",
    sourceFile: "src/telegram-webhook.ts",
  },
] as const;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveImportSpecifier(input: {
  exportKey: (typeof subpaths)[number]["exportKey"];
  packageImport: (typeof subpaths)[number]["packageImport"];
  sourceFile: (typeof subpaths)[number]["sourceFile"];
}): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(path.join(packageDir, "package.json"), "utf8"),
  ) as {
    exports?: Record<string, { default?: string }>;
  };
  const exportEntry = packageJson.exports?.[input.exportKey];

  assert.ok(exportEntry, `expected ${input.exportKey} export entry`);
  assert.equal(typeof exportEntry.default, "string");

  const distPath = path.join(packageDir, exportEntry.default);
  if (await pathExists(distPath)) {
    return input.packageImport;
  }

  return pathToFileURL(path.join(packageDir, input.sourceFile)).href;
}

for (const subpath of subpaths) {
  test(`${subpath.label} subpath import stays free of sqlite warnings`, async () => {
    const modulePath = await resolveImportSpecifier(subpath);
    const result = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(modulePath)})`,
    ], {
      cwd: packageDir,
    });

    assert.equal(result.stdout.trim(), "");
    assert.doesNotMatch(result.stderr, /SQLite is an experimental feature/u);
  });
}
