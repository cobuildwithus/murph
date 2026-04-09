import type { VaultMetadata } from "@murphai/contracts";

import { CURRENT_VAULT_FORMAT_VERSION, VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { readJsonFile } from "./fs.ts";
import { normalizeVaultRoot } from "./path-safety.ts";
import {
  detectVaultMetadataFormatVersion,
  validateVaultMetadata,
} from "./vault-metadata.ts";

export interface UpgradeVaultInput {
  dryRun?: boolean;
  vaultRoot?: string;
}

export interface VaultUpgradeStep {
  description: string;
  fromFormatVersion: number;
  toFormatVersion: number;
}

export interface UpgradeVaultResult {
  metadataFile: string;
  title: string;
  timezone: string;
  fromFormatVersion: number;
  toFormatVersion: number;
  steps: VaultUpgradeStep[];
  affectedFiles: string[];
  rebuildableProjectionStores: string[];
  updated: boolean;
  dryRun: boolean;
  auditPath: string | null;
}

interface PreparedVaultUpgradePlan {
  affectedFiles: string[];
  fromFormatVersion: number;
  metadata: VaultMetadata;
  rebuildableProjectionStores: string[];
  steps: VaultUpgradeStep[];
  toFormatVersion: number;
}

export async function upgradeVault({
  dryRun = false,
  vaultRoot,
}: UpgradeVaultInput = {}): Promise<UpgradeVaultResult> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const plan = await planVaultUpgrade({
    vaultRoot: absoluteRoot,
  });

  return {
    metadataFile: VAULT_LAYOUT.metadata,
    title: plan.metadata.title,
    timezone: plan.metadata.timezone,
    fromFormatVersion: plan.fromFormatVersion,
    toFormatVersion: plan.toFormatVersion,
    steps: plan.steps,
    affectedFiles: plan.affectedFiles,
    rebuildableProjectionStores: plan.rebuildableProjectionStores,
    updated: false,
    dryRun,
    auditPath: null,
  };
}

async function planVaultUpgrade(input: {
  vaultRoot: string;
}): Promise<PreparedVaultUpgradePlan> {
  const rawMetadata = await readJsonFile(input.vaultRoot, VAULT_LAYOUT.metadata);
  const fromFormatVersion = detectVaultMetadataFormatVersion(rawMetadata);

  if (fromFormatVersion > CURRENT_VAULT_FORMAT_VERSION) {
    throw new VaultError(
      "VAULT_UPGRADE_UNSUPPORTED",
      `Vault formatVersion ${fromFormatVersion} is newer than supported formatVersion ${CURRENT_VAULT_FORMAT_VERSION}.`,
    );
  }

  if (fromFormatVersion < CURRENT_VAULT_FORMAT_VERSION) {
    // The canonical upgrade seam is reserved, but no historical steps are
    // registered yet, so older vaults intentionally fail closed here.
    throw new VaultError(
      "VAULT_UPGRADE_UNSUPPORTED",
      `No vault upgrade migration is registered for formatVersion ${fromFormatVersion}.`,
    );
  }

  const { metadata } = validateVaultMetadata(
    rawMetadata,
    "VAULT_INVALID_METADATA",
    "Vault metadata failed contract validation.",
  );

  return {
    fromFormatVersion,
    toFormatVersion: fromFormatVersion,
    metadata,
    steps: [],
    affectedFiles: [],
    rebuildableProjectionStores: [],
  };
}
