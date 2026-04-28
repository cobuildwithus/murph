import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  mergeVaultSyncImportIntoVault,
  readVaultSyncImportManifest,
  restoreVaultSyncImportPack,
  VAULT_SCHEMA_VERSION,
} from "@murphai/core";
import { decodeHostedBundleBase64 } from "@murphai/runtime-state/node";
import type {
  HostedExecutionRunnerVaultSyncImport,
  HostedExecutionWake,
} from "@murphai/hosted-execution";

import type { HostedMailboxEffect } from "../models.ts";

export async function handleHostedVaultSyncImportWake(input: {
  vaultRoot: string;
  vaultSyncImport: HostedExecutionRunnerVaultSyncImport;
  wake: Extract<HostedExecutionWake, { kind: "vault.sync.import" }>;
}): Promise<HostedMailboxEffect> {
  const importRef = input.wake.vaultSync;
  const pack = input.vaultSyncImport;
  const wakeSourceSchemaVersion = requireSupportedSourceSchemaVersion(
    importRef.sourceSchemaVersion,
    "canonical wake reference",
  );
  const payloadSourceSchemaVersion = requireSupportedSourceSchemaVersion(
    pack.sourceSchemaVersion,
    "side-input payload",
  );

  if (pack.sessionId !== importRef.sessionId) {
    throw new TypeError("Hosted vault sync import sessionId must match the canonical wake reference.");
  }

  if (payloadSourceSchemaVersion !== wakeSourceSchemaVersion) {
    throw new TypeError(
      "Hosted vault sync import source schema version must match between the canonical wake reference and side-input payload.",
    );
  }

  const bytes = decodeHostedBundleBase64(pack.bundleBase64);
  if (!bytes || bytes.byteLength === 0) {
    throw new TypeError("Hosted vault sync import requires a non-empty import bundle.");
  }

  const restoreRoot = await fs.mkdtemp(path.join(tmpdir(), "murph-hosted-vault-sync-import-"));
  try {
    const restored = await restoreVaultSyncImportPack({
      bundle: bytes,
      workspaceRoot: restoreRoot,
    });
    const manifest = await readVaultSyncImportManifest(restored.metaRoot);
    const manifestSourceSchemaVersion = requireSupportedSourceSchemaVersion(
      manifest.sourceVault.schemaVersion,
      "restored import manifest",
    );

    if (manifest.manifestHash !== importRef.localManifestHash) {
      throw new TypeError("Hosted vault sync import manifest hash must match the canonical wake reference.");
    }

    if (manifestSourceSchemaVersion !== wakeSourceSchemaVersion) {
      throw new TypeError(
        "Hosted vault sync import source schema version must match the canonical wake reference.",
      );
    }

    if ((manifest.sourceVault.vaultId ?? null) !== (importRef.sourceVaultId ?? null)) {
      throw new TypeError("Hosted vault sync import source vault id must match the canonical wake reference.");
    }

    if ((manifest.sourceVault.title ?? null) !== (importRef.sourceVaultTitle ?? null)) {
      throw new TypeError("Hosted vault sync import source vault title must match the canonical wake reference.");
    }

    const vaultSyncImportResult = await mergeVaultSyncImportIntoVault({
      importMetaRoot: restored.metaRoot,
      importVaultRoot: restored.vaultRoot,
      sessionId: pack.sessionId,
      targetVaultRoot: input.vaultRoot,
    });

    return {
      conversationMetrics: null,
      vaultSyncImportResult,
    };
  } finally {
    await fs.rm(restoreRoot, { force: true, recursive: true });
  }
}

function requireSupportedSourceSchemaVersion(
  value: string | null | undefined,
  source: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Hosted vault sync import ${source} source schema version is required.`);
  }

  if (value !== VAULT_SCHEMA_VERSION) {
    throw new TypeError(
      `Hosted vault sync import ${source} source schema version must be ${VAULT_SCHEMA_VERSION}.`,
    );
  }

  return value;
}
