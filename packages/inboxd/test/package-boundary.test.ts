import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { test } from "vitest";

const execFileAsync = promisify(execFile);
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const removedSubpaths = [
  "./linq",
  "./linq-webhook",
  "./telegram",
  "./telegram-webhook",
] as const;

const normalizationSubpaths = [
  {
    exportKey: "./connectors/linq/normalize",
    label: "linq normalize",
    packageImport: "@murphai/inboxd/connectors/linq/normalize",
    sourceFile: "src/connectors/linq/normalize.ts",
  },
  {
    exportKey: "./connectors/telegram/normalize",
    label: "telegram normalize",
    packageImport: "@murphai/inboxd/connectors/telegram/normalize",
    sourceFile: "src/connectors/telegram/normalize.ts",
  },
] as const;

type InboxdPackageManifest = {
  exports?: Record<string, { default?: string; types?: string } | undefined>;
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageManifest(): Promise<InboxdPackageManifest> {
  return JSON.parse(
    await readFile(path.join(packageDir, "package.json"), "utf8"),
  ) as InboxdPackageManifest;
}

async function resolveImportSpecifier(input: {
  exportKey: (typeof normalizationSubpaths)[number]["exportKey"];
  packageImport: (typeof normalizationSubpaths)[number]["packageImport"];
  sourceFile: (typeof normalizationSubpaths)[number]["sourceFile"];
}): Promise<string> {
  const packageManifest = await readPackageManifest();
  const exportEntry = packageManifest.exports?.[input.exportKey];

  assert.ok(exportEntry, `expected ${input.exportKey} export entry`);
  assert.equal(typeof exportEntry.default, "string");

  const distPath = path.join(packageDir, exportEntry.default);
  if (await pathExists(distPath)) {
    return input.packageImport;
  }

  return pathToFileURL(path.join(packageDir, input.sourceFile)).href;
}

test("@murphai/inboxd no longer publishes the removed Linq and Telegram compatibility subpaths", async () => {
  const packageManifest = await readPackageManifest();

  for (const exportKey of removedSubpaths) {
    assert.equal(packageManifest.exports?.[exportKey], undefined);
  }
});

for (const subpath of normalizationSubpaths) {
  test(`${subpath.label} subpath stays published and importable`, async () => {
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
