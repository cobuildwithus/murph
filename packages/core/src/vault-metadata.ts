import type { VaultMetadata } from "@murphai/contracts";
import {
  safeParseContract,
  vaultMetadataSchema,
} from "@murphai/contracts";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  VAULT_LAYOUT,
} from "./constants.ts";
import { VaultError } from "./errors.ts";
import { readJsonFile } from "./fs.ts";
import { isPlainRecord } from "./types.ts";

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
  const storedFormatVersion = detectVaultMetadataFormatVersion(value);

  if (storedFormatVersion !== CURRENT_VAULT_FORMAT_VERSION) {
    throw buildVaultMetadataUpgradeError(storedFormatVersion);
  }

  const strictResult = safeParseContract(vaultMetadataSchema, value);

  if (strictResult.success) {
    return {
      metadata: strictResult.data,
      storedFormatVersion,
    };
  }

  throw new VaultError(code, message, {
    errors: strictResult.errors,
  });
}

export function buildVaultMetadataUpgradeError(storedFormatVersion: number): VaultError {
  if (storedFormatVersion > CURRENT_VAULT_FORMAT_VERSION) {
    return new VaultError(
      "VAULT_UPGRADE_UNSUPPORTED",
      `Vault formatVersion ${storedFormatVersion} is newer than supported formatVersion ${CURRENT_VAULT_FORMAT_VERSION}.`,
      {
        relativePath: VAULT_LAYOUT.metadata,
        storedFormatVersion,
        supportedFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
      },
    );
  }

  return new VaultError(
    "VAULT_UPGRADE_REQUIRED",
    `Vault formatVersion ${storedFormatVersion} must be upgraded to ${CURRENT_VAULT_FORMAT_VERSION} before current-format operations can continue. Run "vault upgrade" first.`,
    {
      relativePath: VAULT_LAYOUT.metadata,
      storedFormatVersion,
      targetFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
    },
  );
}

export function detectVaultMetadataFormatVersion(rawMetadata: unknown): number {
  if (!isPlainRecord(rawMetadata)) {
    throw new VaultError(
      "VAULT_INVALID_METADATA",
      "Vault metadata must be a JSON object.",
      {
        relativePath: VAULT_LAYOUT.metadata,
      },
    );
  }

  if (!Object.hasOwn(rawMetadata, "formatVersion")) {
    throw new VaultError(
      "VAULT_INVALID_METADATA",
      "Vault metadata formatVersion is required.",
      {
        relativePath: VAULT_LAYOUT.metadata,
      },
    );
  }

  const formatVersion = rawMetadata.formatVersion;

  if (
    typeof formatVersion !== "number" ||
    !Number.isInteger(formatVersion) ||
    formatVersion < 0
  ) {
    throw new VaultError(
      "VAULT_INVALID_METADATA",
      "Vault metadata formatVersion must be a non-negative integer.",
      {
        relativePath: VAULT_LAYOUT.metadata,
      },
    );
  }

  return formatVersion;
}
