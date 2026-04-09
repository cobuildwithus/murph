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

const publishedSubpaths = [
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
  exportKey: (typeof publishedSubpaths)[number]["exportKey"] | ".";
  packageImport: (typeof publishedSubpaths)[number]["packageImport"] | "@murphai/inboxd";
  sourceFile: (typeof publishedSubpaths)[number]["sourceFile"] | "src/index.ts";
}): Promise<string> {
  const packageManifest = await readPackageManifest();
  const exportEntry = packageManifest.exports?.[input.exportKey];

  assert.ok(exportEntry, `expected ${input.exportKey} export entry`);
  const defaultExport = exportEntry.default;
  assert.equal(typeof defaultExport, "string");
  if (typeof defaultExport !== "string") {
    throw new Error(`expected ${input.exportKey} default export path`);
  }

  const distPath = path.join(packageDir, defaultExport);
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

for (const subpath of publishedSubpaths) {
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

test("@murphai/inboxd root barrel no longer exposes iMessage helpers", async () => {
  const modulePath = await resolveImportSpecifier({
    exportKey: ".",
    packageImport: "@murphai/inboxd",
    sourceFile: "src/index.ts",
  });
  const result = await execFileAsync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    [
      `const mod = await import(${JSON.stringify(modulePath)});`,
      `for (const key of ["createImessageConnector", "loadImessageKitDriver", "normalizeImessageAttachment", "normalizeImessageMessage"]) {`,
      "  if (key in mod) {",
      '    throw new Error(`unexpected iMessage export: ${key}`);',
      "  }",
      "}",
    ].join(" "),
  ], {
    cwd: packageDir,
  });

  assert.equal(result.stdout.trim(), "");
  assert.doesNotMatch(result.stderr, /unexpected iMessage export/u);
});
