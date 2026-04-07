import type { VaultMetadata } from "./zod.ts";

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
