import type { VaultMetadata } from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import {
  CURRENT_VAULT_FORMAT_VERSION,
  VAULT_LAYOUT,
} from "./constants.ts";
import { VaultError } from "./errors.ts";
import { readJsonFile } from "./fs.ts";
import { runCanonicalWrite } from "./operations/write-batch.ts";
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

interface VaultUpgradeTextWrite {
  content: string;
  overwrite: boolean;
  relativePath: string;
}

interface PreparedVaultUpgradeStep {
  affectedFiles: string[];
  nextMetadata: VaultMetadata;
  rebuildableProjectionStores?: string[];
  textWrites: VaultUpgradeTextWrite[];
}

interface PreparedVaultUpgradePlan {
  affectedFiles: string[];
  fromFormatVersion: number;
  metadata: VaultMetadata;
  rebuildableProjectionStores: string[];
  steps: VaultUpgradeStep[];
  textWrites: VaultUpgradeTextWrite[];
  toFormatVersion: number;
}

interface VaultUpgradeMigration {
  description: string;
  fromFormatVersion: number;
  prepare(input: {
    occurredAt: string;
    rawMetadata: unknown;
    vaultRoot: string;
  }): Promise<PreparedVaultUpgradeStep>;
  toFormatVersion: number;
}

const VAULT_UPGRADE_MIGRATIONS: readonly VaultUpgradeMigration[] = [] as const;

export async function upgradeVault({
  dryRun = false,
  vaultRoot,
}: UpgradeVaultInput = {}): Promise<UpgradeVaultResult> {
  const absoluteRoot = normalizeVaultRoot(vaultRoot);
  const occurredAt = new Date().toISOString();
  const plan = await planVaultUpgrade({
    occurredAt,
    vaultRoot: absoluteRoot,
  });

  if (plan.steps.length === 0) {
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

  if (dryRun) {
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
      dryRun: true,
      auditPath: null,
    };
  }

  const auditPath = await runCanonicalWrite({
    vaultRoot: absoluteRoot,
    operationType: "vault_upgrade",
    summary: `Upgrade vault ${plan.metadata.vaultId} from formatVersion ${plan.fromFormatVersion} to ${plan.toFormatVersion}`,
    occurredAt,
    mutate: async ({ batch }) => {
      for (const textWrite of plan.textWrites) {
        await batch.stageTextWrite(textWrite.relativePath, textWrite.content, {
          overwrite: textWrite.overwrite,
        });
      }

      const audit = await emitAuditRecord({
        vaultRoot: absoluteRoot,
        batch,
        action: "vault_upgrade",
        commandName: "core.upgradeVault",
        summary: buildVaultUpgradeAuditSummary(plan),
        occurredAt,
        files: plan.affectedFiles,
        targetIds: [plan.metadata.vaultId],
      });

      return audit.relativePath;
    },
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
    updated: true,
    dryRun: false,
    auditPath,
  };
}

async function planVaultUpgrade(input: {
  occurredAt: string;
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

  if (fromFormatVersion === CURRENT_VAULT_FORMAT_VERSION) {
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
      textWrites: [],
      affectedFiles: [],
      rebuildableProjectionStores: [],
    };
  }

  let currentFormatVersion = fromFormatVersion;
  let currentMetadata = rawMetadata;
  const steps: VaultUpgradeStep[] = [];
  const textWritesByPath = new Map<string, VaultUpgradeTextWrite>();
  const affectedFiles = new Set<string>();
  const rebuildableProjectionStores = new Set<string>();

  while (currentFormatVersion < CURRENT_VAULT_FORMAT_VERSION) {
    const migration = VAULT_UPGRADE_MIGRATIONS.find(
      (candidate) => candidate.fromFormatVersion === currentFormatVersion,
    );

    if (!migration) {
      throw new VaultError(
        "VAULT_UPGRADE_UNSUPPORTED",
        `No vault upgrade migration is registered for formatVersion ${currentFormatVersion}.`,
      );
    }

    const prepared = await migration.prepare({
      occurredAt: input.occurredAt,
      rawMetadata: currentMetadata,
      vaultRoot: input.vaultRoot,
    });

    steps.push({
      description: migration.description,
      fromFormatVersion: migration.fromFormatVersion,
      toFormatVersion: migration.toFormatVersion,
    });

    currentMetadata = prepared.nextMetadata;
    currentFormatVersion = migration.toFormatVersion;

    for (const textWrite of prepared.textWrites) {
      textWritesByPath.set(textWrite.relativePath, textWrite);
    }

    for (const relativePath of prepared.affectedFiles) {
      affectedFiles.add(relativePath);
    }

    for (const store of prepared.rebuildableProjectionStores ?? []) {
      rebuildableProjectionStores.add(store);
    }
  }

  const { metadata } = validateVaultMetadata(
    currentMetadata,
    "VAULT_INVALID_METADATA",
    "Vault metadata failed contract validation after upgrade planning.",
  );

  return {
    fromFormatVersion,
    toFormatVersion: currentFormatVersion,
    metadata,
    steps,
    textWrites: [...textWritesByPath.values()].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
    affectedFiles: [...affectedFiles].sort(),
    rebuildableProjectionStores: [...rebuildableProjectionStores].sort(),
  };
}

function buildVaultUpgradeAuditSummary(plan: PreparedVaultUpgradePlan): string {
  const migrationSummary = plan.steps
    .map((step) => `v${step.fromFormatVersion}->v${step.toFormatVersion} ${step.description}`)
    .join("; ");
  const rebuildableProjectionSummary =
    plan.rebuildableProjectionStores.length > 0
      ? ` Rebuildable projection stores to rebuild: ${plan.rebuildableProjectionStores.join(", ")}.`
      : "";

  return `Applied ${plan.steps.length} vault upgrade step(s): ${migrationSummary}.${rebuildableProjectionSummary}`;
}
