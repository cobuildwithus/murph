import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  mergeVaultSyncImportIntoVault,
  restoreVaultSyncImportPack,
} from "@murphai/core";
import { decodeHostedBundleBase64 } from "@murphai/runtime-state/node";
import type {
  HostedExecutionRunnerVaultSyncImport,
  HostedIngressEnvelope,
} from "@murphai/hosted-execution";

import type { HostedIngressEffect } from "../models.ts";

export async function handleHostedVaultSyncImportWake(input: {
  vaultRoot: string;
  vaultSyncImport: HostedExecutionRunnerVaultSyncImport;
  wake: Extract<HostedIngressEnvelope, { kind: "vault.sync.import" }>;
}): Promise<HostedIngressEffect> {
  const importRef = input.wake.vaultSync;
  const pack = input.vaultSyncImport;

  if (pack.sessionId !== importRef.sessionId) {
    throw new TypeError("Hosted vault sync import sessionId must match the canonical wake reference.");
  }

  if (!importRef.localManifestHash || !pack.localManifestHash || pack.localManifestHash !== importRef.localManifestHash) {
    throw new TypeError("Hosted vault sync import manifest hash must match the canonical wake reference.");
  }

  if ((pack.sourceVaultId ?? null) !== (importRef.sourceVaultId ?? null)) {
    throw new TypeError("Hosted vault sync import source vault id must match the canonical wake reference.");
  }

  if ((pack.sourceVaultTitle ?? null) !== (importRef.sourceVaultTitle ?? null)) {
    throw new TypeError("Hosted vault sync import source vault title must match the canonical wake reference.");
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
    const vaultSyncImportResult = await mergeVaultSyncImportIntoVault({
      importMetaRoot: restored.metaRoot,
      importVaultRoot: restored.vaultRoot,
      sessionId: pack.sessionId,
      targetVaultRoot: input.vaultRoot,
    });

    return {
      conversationMetrics: null,
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult,
    };
  } finally {
    await fs.rm(restoreRoot, { force: true, recursive: true });
  }
}
