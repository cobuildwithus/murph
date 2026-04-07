import type { VaultMetadata } from "@murphai/contracts";
import {
  detectVaultMetadataFormatVersion as detectContractVaultMetadataFormatVersion,
  validateCurrentVaultMetadata,
} from "@murphai/contracts";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  VAULT_LAYOUT,
} from "./constants.ts";
import { VaultError } from "./errors.ts";
import { readJsonFile } from "./fs.ts";

export interface BuildVaultMetadataInput {
  vaultId: string;
  createdAt: string;
  title: string;
  timezone: string;
}

export interface LoadedVaultMetadata {
  metadata: VaultMetadata;
  storedFormatVersion: number;
}

export async function loadVaultMetadata(
  vaultRoot: string,
  code: string,
  message: string,
): Promise<LoadedVaultMetadata> {
  const rawMetadata = await readJsonFile(vaultRoot, VAULT_LAYOUT.metadata);
  return validateVaultMetadata(rawMetadata, code, message);
}

export function buildVaultMetadata({
  vaultId,
  createdAt,
  title,
  timezone,
}: BuildVaultMetadataInput): VaultMetadata {
  return {
    formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    vaultId,
    createdAt,
    title,
    timezone,
  };
}

export function resolveVaultMetadataFormatVersion(
  metadata: Pick<VaultMetadata, "formatVersion">,
): number {
  return metadata.formatVersion;
}

export function validateVaultMetadata(
  value: unknown,
  code: string,
  message: string,
): LoadedVaultMetadata {
  const result = validateCurrentVaultMetadata(value, {
    invalidSchemaMessage: message,
    relativePath: VAULT_LAYOUT.metadata,
  });

  if (!result.success) {
    if (
      result.error.code === "VAULT_INVALID_METADATA" &&
      Object.hasOwn(result.error.details, "errors")
    ) {
      throw new VaultError(code, result.error.message, result.error.details);
    }

    throw new VaultError(result.error.code, result.error.message, result.error.details);
  }

  return result.data;
}

export function detectVaultMetadataFormatVersion(rawMetadata: unknown): number {
  const result = detectContractVaultMetadataFormatVersion(rawMetadata, {
    relativePath: VAULT_LAYOUT.metadata,
  });

  if (!result.success) {
    throw new VaultError(result.error.code, result.error.message, result.error.details);
  }

  return result.storedFormatVersion;
}
