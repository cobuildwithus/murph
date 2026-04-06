import type { VaultMetadata } from "@murphai/contracts";
import {
  safeParseContract,
  vaultMetadataSchema,
} from "@murphai/contracts";

import {
  VAULT_LAYOUT,
  VAULT_PATHS,
  VAULT_SCHEMA_VERSION,
  VAULT_SHARDS,
  ID_PREFIXES,
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
    schemaVersion: VAULT_SCHEMA_VERSION,
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

export function validateVaultMetadata(
  value: unknown,
  code: string,
  message: string,
): LoadedVaultMetadata {
  const result = safeParseContract(vaultMetadataSchema, value);

  if (!result.success) {
    throw new VaultError(code, message, {
      errors: result.errors,
    });
  }

  return {
    metadata: result.data,
  };
}
