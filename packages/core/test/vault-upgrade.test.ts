import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  initializeVault,
  loadVault,
  repairVault,
  validateVault,
} from "../src/index.ts";

async function createTempVaultRoot(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `${name}-`));
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function rewriteVaultMetadataWithFormatVersion(
  vaultRoot: string,
  formatVersion: number,
): Promise<Record<string, unknown>> {
  const metadataPath = path.join(vaultRoot, "vault.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
  metadata.formatVersion = formatVersion;
  await writeJsonFile(metadataPath, metadata);
  return metadata;
}

function hasVaultErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === expectedCode
  );
}

test("validateVault treats explicit older format versions as unsupported", async () => {
  const vaultRoot = await createTempVaultRoot("murph-vault-upgrade-required");

  try {
    await initializeVault({
      vaultRoot,
      timezone: "Australia/Melbourne",
    });
    await rewriteVaultMetadataWithFormatVersion(vaultRoot, 0);

    const result = await validateVault({ vaultRoot });

    assert.equal(result.valid, false);
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.code === "VAULT_UNSUPPORTED_FORMAT" &&
          issue.severity === "error" &&
          issue.path === "vault.json",
      ),
    );
    assert.equal(result.metadata, null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("loadVault and repairVault reject explicit older format versions", async () => {
  const vaultRoot = await createTempVaultRoot("murph-vault-upgrade-gate");

  try {
    await initializeVault({ vaultRoot, timezone: "Australia/Melbourne" });
    await rewriteVaultMetadataWithFormatVersion(vaultRoot, 0);

    await assert.rejects(
      () => loadVault({ vaultRoot }),
      (error) => hasVaultErrorCode(error, "VAULT_UNSUPPORTED_FORMAT"),
    );
    await assert.rejects(
      () => repairVault({ vaultRoot }),
      (error) => hasVaultErrorCode(error, "VAULT_UNSUPPORTED_FORMAT"),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("validateVault surfaces unsupported future vault formats as hard errors", async () => {
  const vaultRoot = await createTempVaultRoot("murph-vault-upgrade-unsupported");

  try {
    await initializeVault({ vaultRoot, timezone: "Australia/Melbourne" });

    const metadataPath = path.join(vaultRoot, "vault.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.formatVersion = CURRENT_VAULT_FORMAT_VERSION + 1;
    await writeJsonFile(metadataPath, metadata);

    const result = await validateVault({ vaultRoot });

    assert.equal(result.valid, false);
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.code === "VAULT_UNSUPPORTED_FORMAT" &&
          issue.severity === "error" &&
          issue.path === "vault.json",
      ),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
