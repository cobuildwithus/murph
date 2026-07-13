import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

const execFileAsync = promisify(execFile);
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtDistTest = process.env.MURPH_INBOXD_TEST_BUILT_DIST === "1" ? test : test.skip;

const removedSubpaths = [
  "./linq",
  "./linq-webhook",
  "./telegram",
  "./telegram-webhook",
] as const;

const expectedExports = {
  ".": {
    types: "./dist/index.d.ts",
    default: "./dist/index.js",
  },
  "./connectors/email/normalize-parsed": {
    types: "./dist/connectors/email/normalize-parsed.d.ts",
    default: "./dist/connectors/email/normalize-parsed.js",
  },
  "./connectors/email/parsed": {
    types: "./dist/connectors/email/parsed.d.ts",
    default: "./dist/connectors/email/parsed.js",
  },
  "./connectors/linq/normalize": {
    types: "./dist/connectors/linq/normalize.d.ts",
    default: "./dist/connectors/linq/normalize.js",
  },
  "./connectors/telegram/normalize": {
    types: "./dist/connectors/telegram/normalize.d.ts",
    default: "./dist/connectors/telegram/normalize.js",
  },
  "./runtime": {
    types: "./dist/runtime.d.ts",
    default: "./dist/runtime.js",
  },
  "./retention": {
    types: "./dist/retention.d.ts",
    default: "./dist/retention.js",
  },
  "./checkpoint": {
    types: "./dist/checkpoint.d.ts",
    default: "./dist/checkpoint.js",
  },
  "./connectors/hosted-conversation": {
    types: "./dist/connectors/hosted-conversation.d.ts",
    default: "./dist/connectors/hosted-conversation.js",
  },
} as const;

type InboxdPackageManifest = {
  exports?: Record<string, PackageExportEntry | undefined>;
  scripts?: Record<string, string | undefined>;
};

type PackageExportEntry = {
  default?: string;
  types?: string;
};

async function readPackageManifest(): Promise<InboxdPackageManifest> {
  return JSON.parse(
    await readFile(path.join(packageDir, "package.json"), "utf8"),
  ) as InboxdPackageManifest;
}

function packageImportForExportKey(exportKey: string): string {
  if (exportKey === ".") {
    return "@murphai/inboxd";
  }

  assert.ok(exportKey.startsWith("./"), `unexpected export key: ${exportKey}`);
  return `@murphai/inboxd/${exportKey.slice(2)}`;
}

function assertBuiltExportEntry(
  exportKey: string,
  exportEntry: PackageExportEntry | undefined,
): asserts exportEntry is Required<PackageExportEntry> {
  assert.ok(exportEntry, `expected ${exportKey} export entry`);
  assert.equal(typeof exportEntry.default, "string", `expected ${exportKey} default target`);
  assert.equal(typeof exportEntry.types, "string", `expected ${exportKey} types target`);
}

test("@murphai/inboxd manifest declares the full narrow built export contract", async () => {
  const packageManifest = await readPackageManifest();

  assert.doesNotMatch(packageManifest.scripts?.test ?? "", /\bpnpm build\b/u);
  assert.doesNotMatch(packageManifest.scripts?.["test:coverage"] ?? "", /\bpnpm build\b/u);
  assert.match(
    packageManifest.scripts?.["verify:package-boundary"] ?? "",
    /MURPH_INBOXD_TEST_BUILT_DIST=1/u,
  );
  assert.deepEqual(packageManifest.exports, expectedExports);

  for (const exportKey of removedSubpaths) {
    assert.equal(Object.hasOwn(packageManifest.exports ?? {}, exportKey), false);
  }
});

builtDistTest("@murphai/inboxd declared export targets exist in the built dist contract", async () => {
  const packageManifest = await readPackageManifest();

  for (const [exportKey, exportEntry] of Object.entries(packageManifest.exports ?? {})) {
    assertBuiltExportEntry(exportKey, exportEntry);
    assert.match(exportEntry.default, /^\.\/dist\/.+\.js$/u);
    assert.match(exportEntry.types, /^\.\/dist\/.+\.d\.ts$/u);

    await access(path.join(packageDir, exportEntry.default));
    await access(path.join(packageDir, exportEntry.types));
  }
});

builtDistTest("@murphai/inboxd declared exports import through built package resolution", async () => {
  const packageManifest = await readPackageManifest();

  for (const exportKey of Object.keys(packageManifest.exports ?? {})) {
    const packageImport = packageImportForExportKey(exportKey);
    const result = await execFileAsync(process.execPath, [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(packageImport)})`,
    ], {
      cwd: packageDir,
    });

    assert.equal(result.stdout.trim(), "");
    assert.doesNotMatch(result.stderr, /SQLite is an experimental feature/u);
  }
});

for (const removedSubpath of removedSubpaths) {
  test(`@murphai/inboxd rejects removed ${removedSubpath} compatibility subpath`, async () => {
    const packageImport = packageImportForExportKey(removedSubpath);
    await assert.rejects(
      execFileAsync(process.execPath, [
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(packageImport)})`,
      ], {
        cwd: packageDir,
      }),
      /ERR_PACKAGE_PATH_NOT_EXPORTED/u,
    );
  });
}

builtDistTest(
  "@murphai/inboxd root barrel no longer exposes removed compatibility or raw-only helpers",
  async () => {
    const result = await execFileAsync(process.execPath, [
      "--input-type=module",
      "-e",
      [
        `const mod = await import(${JSON.stringify("@murphai/inboxd")});`,
        `for (const key of ["appendImportAudit", "appendInboxCaptureEvent", "createImessageConnector", "createLinqWebhookConnector", "loadImessageKitDriver", "normalizeImessageAttachment", "normalizeImessageMessage", "persistRawCapture"]) {`,
        "  if (key in mod) {",
        '    throw new Error(`unexpected removed export: ${key}`);',
        "  }",
        "}",
      ].join(" "),
    ], {
      cwd: packageDir,
    });

    assert.equal(result.stdout.trim(), "");
    assert.doesNotMatch(result.stderr, /unexpected removed export/u);
  },
);
