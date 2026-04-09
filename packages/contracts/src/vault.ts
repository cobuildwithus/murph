import { CURRENT_VAULT_FORMAT_VERSION } from "./constants.ts";
import { safeParseContract } from "./validate.ts";
import { vaultMetadataSchema, type JsonObject, type VaultMetadata } from "./zod.ts";

export interface VaultMetadataValidationFailure {
  code:
    | "VAULT_INVALID_METADATA"
    | "VAULT_UNSUPPORTED_FORMAT";
  message: string;
  details: JsonObject;
}

export type DetectVaultMetadataFormatVersionResult =
  | {
      success: true;
      storedFormatVersion: number;
    }
  | {
      success: false;
      error: VaultMetadataValidationFailure;
    };

export type ValidateCurrentVaultMetadataResult =
  | {
      success: true;
      data: {
        metadata: VaultMetadata;
        storedFormatVersion: number;
      };
    }
  | {
      success: false;
      error: VaultMetadataValidationFailure;
    };

export interface ValidateCurrentVaultMetadataOptions {
  invalidSchemaMessage?: string;
  relativePath?: string;
}

export function resolveVaultMetadataFormatVersion(
  metadata: Pick<VaultMetadata, "formatVersion">,
): number;
export function resolveVaultMetadataFormatVersion(
  metadata: Pick<VaultMetadata, "formatVersion"> | null | undefined,
): number | null;
export function resolveVaultMetadataFormatVersion(
  metadata: Pick<VaultMetadata, "formatVersion"> | null | undefined,
): number | null {
  if (!metadata) {
    return null;
  }

  return metadata.formatVersion;
}

export function detectVaultMetadataFormatVersion(
  rawMetadata: unknown,
  options: Pick<ValidateCurrentVaultMetadataOptions, "relativePath"> = {},
): DetectVaultMetadataFormatVersionResult {
  if (!isPlainRecord(rawMetadata)) {
    return {
      success: false,
      error: buildVaultMetadataValidationFailure(
        "VAULT_INVALID_METADATA",
        "Vault metadata must be a JSON object.",
        options.relativePath,
      ),
    };
  }

  if (!Object.hasOwn(rawMetadata, "formatVersion")) {
    return {
      success: false,
      error: buildVaultMetadataValidationFailure(
        "VAULT_INVALID_METADATA",
        "Vault metadata formatVersion is required.",
        options.relativePath,
      ),
    };
  }

  const formatVersion = rawMetadata.formatVersion;
  if (
    typeof formatVersion !== "number" ||
    !Number.isInteger(formatVersion) ||
    formatVersion < 0
  ) {
    return {
      success: false,
      error: buildVaultMetadataValidationFailure(
        "VAULT_INVALID_METADATA",
        "Vault metadata formatVersion must be a non-negative integer.",
        options.relativePath,
      ),
    };
  }

  return {
    success: true,
    storedFormatVersion: formatVersion,
  };
}

export function validateCurrentVaultMetadata(
  value: unknown,
  options: ValidateCurrentVaultMetadataOptions = {},
): ValidateCurrentVaultMetadataResult {
  const formatVersionResult = detectVaultMetadataFormatVersion(value, options);

  if (!formatVersionResult.success) {
    return formatVersionResult;
  }

  const { storedFormatVersion } = formatVersionResult;
  if (storedFormatVersion !== CURRENT_VAULT_FORMAT_VERSION) {
    return {
      success: false,
      error: buildVaultMetadataValidationFailure(
        "VAULT_UNSUPPORTED_FORMAT",
        `Vault formatVersion ${storedFormatVersion} is unsupported; expected formatVersion ${CURRENT_VAULT_FORMAT_VERSION}.`,
        options.relativePath,
        {
          storedFormatVersion,
          supportedFormatVersion: CURRENT_VAULT_FORMAT_VERSION,
        },
      ),
    };
  }

  const strictResult = safeParseContract(vaultMetadataSchema, value);
  if (!strictResult.success) {
    return {
      success: false,
      error: buildVaultMetadataValidationFailure(
        "VAULT_INVALID_METADATA",
        options.invalidSchemaMessage ?? "Vault metadata failed contract validation.",
        options.relativePath,
        {
          errors: strictResult.errors,
        },
      ),
    };
  }

  return {
    success: true,
    data: {
      metadata: strictResult.data,
      storedFormatVersion,
    },
  };
}

function buildVaultMetadataValidationFailure(
  code: VaultMetadataValidationFailure["code"],
  message: string,
  relativePath?: string,
  details: JsonObject = {},
): VaultMetadataValidationFailure {
  return {
    code,
    message,
    details: relativePath ? { relativePath, ...details } : details,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
