import type { VaultMetadata } from "@murphai/contracts";
import {
  safeParseContract,
  vaultMetadataSchema,
} from "@murphai/contracts";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  VAULT_LAYOUT,
  VAULT_PATHS,
  VAULT_SCHEMA_VERSION,
  VAULT_SHARDS,
  ID_PREFIXES,
} from "./constants.ts";
import { VaultError } from "./errors.ts";
import { readJsonFile } from "./fs.ts";
import type { UnknownRecord } from "./types.ts";
import { isPlainRecord } from "./types.ts";

const SUPPORTED_LEGACY_VAULT_METADATA_KEYS = new Set([
  "createdAt",
  "formatVersion",
  "idPolicy",
  "paths",
  "schemaVersion",
  "shards",
  "timezone",
  "title",
  "vaultId",
]);

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
  const loaded = await loadVaultMetadataWithCompatibility(vaultRoot, code, message);

  if (loaded.storedFormatVersion !== CURRENT_VAULT_FORMAT_VERSION) {
    throw buildVaultMetadataUpgradeError(loaded.storedFormatVersion);
  }

  return loaded;
}

export async function loadVaultMetadataWithCompatibility(
  vaultRoot: string,
  code: string,
  message: string,
): Promise<LoadedVaultMetadata> {
  const rawMetadata = await readJsonFile(vaultRoot, VAULT_LAYOUT.metadata);
  return validateVaultMetadataWithCompatibility(rawMetadata, code, message);
}

export function buildVaultMetadata({
  vaultId,
  createdAt,
  title,
  timezone,
}: BuildVaultMetadataInput): VaultMetadata {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    formatVersion: CURRENT_VAULT_FORMAT_VERSION,
    vaultId,
    createdAt,
    title,
    timezone,
    idPolicy: {
      format: "prefix_ulid",
      prefixes: { ...ID_PREFIXES },
    },
    paths: { ...VAULT_PATHS },
    shards: { ...VAULT_SHARDS },
  };
}

export function resolveVaultMetadataFormatVersion(
  metadata: Pick<VaultMetadata, "formatVersion">,
): number {
  return metadata.formatVersion ?? 0;
}

export function validateVaultMetadata(
  value: unknown,
  code: string,
  message: string,
): LoadedVaultMetadata {
  const loaded = validateVaultMetadataWithCompatibility(value, code, message);

  if (loaded.storedFormatVersion !== CURRENT_VAULT_FORMAT_VERSION) {
    throw buildVaultMetadataUpgradeError(loaded.storedFormatVersion);
  }

  return loaded;
}

export function validateVaultMetadataWithCompatibility(
  value: unknown,
  code: string,
  message: string,
): LoadedVaultMetadata {
  const storedFormatVersion = detectVaultMetadataFormatVersion(value);

  if (storedFormatVersion > CURRENT_VAULT_FORMAT_VERSION) {
    throw buildVaultMetadataUpgradeError(storedFormatVersion);
  }

  const strictResult = safeParseContract(vaultMetadataSchema, value);

  if (strictResult.success) {
    return {
      metadata: strictResult.data,
      storedFormatVersion,
    };
  }

  if (storedFormatVersion === 0) {
    return {
      metadata: buildCurrentVaultMetadataFromLegacy(value),
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
    return 0;
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

export function buildCurrentVaultMetadataFromLegacy(rawMetadata: unknown): VaultMetadata {
  const record = requireSupportedLegacyVaultMetadataRecord(rawMetadata);
  const fallbackMetadata = buildVaultMetadata({
    vaultId: requireMetadataString(record, "vaultId"),
    createdAt: requireMetadataString(record, "createdAt"),
    title: requireMetadataString(record, "title"),
    timezone: requireMetadataString(record, "timezone"),
  });
  const schemaVersion = requireMetadataString(record, "schemaVersion");

  if (schemaVersion !== VAULT_SCHEMA_VERSION) {
    throw new VaultError(
      "VAULT_INVALID_METADATA",
      `Vault metadata schemaVersion must be ${VAULT_SCHEMA_VERSION}.`,
      {
        relativePath: VAULT_LAYOUT.metadata,
      },
    );
  }

  const candidate = {
    ...fallbackMetadata,
    schemaVersion,
    idPolicy: Object.hasOwn(record, "idPolicy") ? record.idPolicy : fallbackMetadata.idPolicy,
    paths: Object.hasOwn(record, "paths") ? record.paths : fallbackMetadata.paths,
    shards: Object.hasOwn(record, "shards") ? record.shards : fallbackMetadata.shards,
    formatVersion: CURRENT_VAULT_FORMAT_VERSION,
  } satisfies UnknownRecord;

  return validateVaultMetadata(
    candidate,
    "VAULT_INVALID_METADATA",
    "Vault metadata failed contract validation during legacy compatibility hydration.",
  ).metadata;
}

function requireMetadataString(record: UnknownRecord, key: string): string {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VaultError(
      "VAULT_INVALID_METADATA",
      `Vault metadata ${key} must be a non-empty string.`,
      {
        relativePath: VAULT_LAYOUT.metadata,
      },
    );
  }

  return value;
}

function requireSupportedLegacyVaultMetadataRecord(rawMetadata: unknown): UnknownRecord {
  if (!isPlainRecord(rawMetadata)) {
    throw new VaultError(
      "VAULT_INVALID_METADATA",
      "Vault metadata must be a JSON object.",
      {
        relativePath: VAULT_LAYOUT.metadata,
      },
    );
  }

  const unknownKeys = Object.keys(rawMetadata)
    .filter((key) => !SUPPORTED_LEGACY_VAULT_METADATA_KEYS.has(key))
    .sort();

  if (unknownKeys.length > 0) {
    throw new VaultError(
      "VAULT_INVALID_METADATA",
      `Vault metadata includes unsupported field(s): ${unknownKeys.join(", ")}.`,
      {
        relativePath: VAULT_LAYOUT.metadata,
      },
    );
  }

  return rawMetadata;
}
