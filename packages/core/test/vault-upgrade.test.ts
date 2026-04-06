import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  initializeVault,
  loadVault,
  repairVault,
  upgradeVault,
  validateVault,
} from "../src/index.ts";

async function createTempVaultRoot(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `${name}-`));
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function rewriteVaultMetadataAsLegacy(vaultRoot: string): Promise<Record<string, unknown>> {
  const metadataPath = path.join(vaultRoot, "vault.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
  const legacyMetadata = {
    schemaVersion: metadata.schemaVersion,
    vaultId: metadata.vaultId,
    createdAt: metadata.createdAt,
    title: metadata.title,
    timezone: metadata.timezone,
  } satisfies Record<string, unknown>;

  await writeJsonFile(metadataPath, legacyMetadata);

  return legacyMetadata;
}

function hasVaultErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === expectedCode
  );
}

test("validateVault classifies legacy metadata as upgrade required", async () => {
  const vaultRoot = await createTempVaultRoot("murph-vault-upgrade-required");

  try {
    const initialized = await initializeVault({
      vaultRoot,
      timezone: "Australia/Melbourne",
    });
    const legacyMetadata = await rewriteVaultMetadataAsLegacy(vaultRoot);

    const result = await validateVault({ vaultRoot });

    assert.equal(result.valid, false);
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.code === "VAULT_UPGRADE_REQUIRED" &&
          issue.severity === "error" &&
          issue.path === "vault.json",
      ),
    );
    assert.equal(result.metadata?.vaultId, initialized.metadata.vaultId);
    assert.equal(result.metadata?.title, legacyMetadata.title);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("loadVault and repairVault reject legacy metadata until upgradeVault runs", async () => {
  const vaultRoot = await createTempVaultRoot("murph-vault-upgrade-gate");

  try {
    await initializeVault({ vaultRoot, timezone: "Australia/Melbourne" });
    await rewriteVaultMetadataAsLegacy(vaultRoot);

    await assert.rejects(
      () => loadVault({ vaultRoot }),
      (error) => hasVaultErrorCode(error, "VAULT_UPGRADE_REQUIRED"),
    );
    await assert.rejects(
      () => repairVault({ vaultRoot }),
      (error) => hasVaultErrorCode(error, "VAULT_UPGRADE_REQUIRED"),
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
          issue.code === "VAULT_UPGRADE_UNSUPPORTED" &&
          issue.severity === "error" &&
          issue.path === "vault.json",
      ),
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("upgradeVault plans and applies the initial canonical vault migration without touching rebuildable runtime stores", async () => {
  const vaultRoot = await createTempVaultRoot("murph-vault-upgrade-apply");

  try {
    await initializeVault({ vaultRoot, timezone: "America/New_York" });

    const legacyMetadata = await rewriteVaultMetadataAsLegacy(vaultRoot);
    const metadataPath = path.join(vaultRoot, "vault.json");
    await unlink(path.join(vaultRoot, "CORE.md"));

    const dryRun = await upgradeVault({ vaultRoot, dryRun: true });

    assert.equal(dryRun.updated, false);
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.auditPath, null);
    assert.equal(dryRun.fromFormatVersion, 0);
    assert.equal(dryRun.toFormatVersion, CURRENT_VAULT_FORMAT_VERSION);
    assert.deepEqual(dryRun.rebuildableProjectionStores, []);
    assert.deepEqual(dryRun.affectedFiles, ["CORE.md", "vault.json"]);
    assert.deepEqual(dryRun.steps, [
      {
        description:
          "Write explicit vault formatVersion metadata and restore the canonical CORE.md baseline when missing.",
        fromFormatVersion: 0,
        toFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
      },
    ]);
    assert.equal(JSON.parse(await readFile(metadataPath, "utf8")).formatVersion, undefined);

    const applied = await upgradeVault({ vaultRoot });

    assert.equal(applied.updated, true);
    assert.equal(applied.dryRun, false);
    assert.equal(applied.fromFormatVersion, 0);
    assert.equal(applied.toFormatVersion, CURRENT_VAULT_FORMAT_VERSION);
    assert.deepEqual(applied.rebuildableProjectionStores, []);
    assert.deepEqual(applied.affectedFiles, ["CORE.md", "vault.json"]);
    assert.match(applied.auditPath ?? "", /^audit\/.+\.jsonl$/u);

    const upgradedMetadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    assert.equal(upgradedMetadata.formatVersion, CURRENT_VAULT_FORMAT_VERSION);
    assert.ok(typeof upgradedMetadata.idPolicy === "object" && upgradedMetadata.idPolicy !== null);
    assert.ok(typeof upgradedMetadata.paths === "object" && upgradedMetadata.paths !== null);
    assert.ok(typeof upgradedMetadata.shards === "object" && upgradedMetadata.shards !== null);

    const coreDocument = await readFile(path.join(vaultRoot, "CORE.md"), "utf8");
    assert.ok(coreDocument.startsWith("---\n"));
    assert.match(coreDocument, /docType: core/u);
    assert.ok(coreDocument.includes(`# ${legacyMetadata.title}`));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
