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
import { isPlainRecord } from "./types.ts";

export interface BuildVaultMetadataInput {
  vaultId: string;
  createdAt: string;
  title: string;
  timezone: string;
}

export interface LoadedVaultMetadata {
  metadata: VaultMetadata;
  repairedFields: string[];
}

export async function loadVaultMetadata(
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

export function validateVaultMetadataWithCompatibility(
  value: unknown,
  code: string,
  message: string,
): LoadedVaultMetadata {
  const { candidate, repairedFields } = applyVaultMetadataCompatibilityDefaults(value);
  const result = safeParseContract(vaultMetadataSchema, candidate);

  if (!result.success) {
    throw new VaultError(code, message, {
      errors: result.errors,
      repairedFields,
    });
  }

  return {
    metadata: result.data,
    repairedFields,
  };
}

function applyVaultMetadataCompatibilityDefaults(value: unknown): {
  candidate: unknown;
  repairedFields: string[];
} {
  if (!isPlainRecord(value)) {
    return {
      candidate: value,
      repairedFields: [],
    };
  }

  const defaults = buildVaultMetadata({
    vaultId: stringOrEmpty(value.vaultId),
    createdAt: stringOrEmpty(value.createdAt),
    title: stringOrEmpty(value.title),
    timezone: stringOrEmpty(value.timezone),
  });
  const repairedFields: string[] = [];
  const candidate: Record<string, unknown> = {
    ...value,
    idPolicy: mergeAdditiveObjectDefaults(
      value.idPolicy,
      defaults.idPolicy as Record<string, unknown>,
      "idPolicy",
      repairedFields,
    ),
    paths: mergeAdditiveObjectDefaults(
      value.paths,
      defaults.paths as Record<string, unknown>,
      "paths",
      repairedFields,
    ),
    shards: mergeAdditiveObjectDefaults(
      value.shards,
      defaults.shards as Record<string, unknown>,
      "shards",
      repairedFields,
    ),
  };

  return {
    candidate,
    repairedFields,
  };
}

function mergeAdditiveObjectDefaults(
  value: unknown,
  defaults: Record<string, unknown>,
  basePath: string,
  repairedFields: string[],
): unknown {
  if (value === undefined) {
    repairedFields.push(basePath);
    return { ...defaults };
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const merged: Record<string, unknown> = { ...value };

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in value)) {
      repairedFields.push(`${basePath}.${key}`);
      merged[key] = defaultValue;
      continue;
    }

    if (isPlainRecord(defaultValue)) {
      merged[key] = mergeAdditiveObjectDefaults(
        value[key],
        defaultValue,
        `${basePath}.${key}`,
        repairedFields,
      );
    }
  }

  return merged;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}
