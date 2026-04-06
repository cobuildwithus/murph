import path from "node:path";

export type VaultLocalStateClassification = "operational" | "projection" | "ephemeral";

export interface VaultLocalStateBucketDescriptor {
  classification: VaultLocalStateClassification;
  description: string;
  rebuildable: boolean;
  rootRelativePath: string;
}

export const RUNTIME_ROOT_RELATIVE_PATH = ".runtime";
export const RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/operations`;
export const RUNTIME_PROJECTION_ROOT_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/projections`;
export const RUNTIME_CACHE_ROOT_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/cache`;
export const RUNTIME_TEMP_ROOT_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/tmp`;

export const vaultLocalStateBucketDescriptors: readonly VaultLocalStateBucketDescriptor[] = [
  {
    classification: "operational",
    description:
      "Durable local operational state such as tokens, cursors, daemon launcher metadata, and user-configured local tool settings.",
    rebuildable: false,
    rootRelativePath: RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH,
  },
  {
    classification: "projection",
    description:
      "Rebuildable local projections and indexes derived from canonical vault evidence or other durable runtime state.",
    rebuildable: true,
    rootRelativePath: RUNTIME_PROJECTION_ROOT_RELATIVE_PATH,
  },
  {
    classification: "ephemeral",
    description:
      "Throwaway caches and temporary scratch files that may be deleted at any time without affecting durable runtime behavior.",
    rebuildable: true,
    rootRelativePath: RUNTIME_CACHE_ROOT_RELATIVE_PATH,
  },
  {
    classification: "ephemeral",
    description:
      "Temporary runtime scratch files and sockets that are valid only for the current local process or short-lived task.",
    rebuildable: true,
    rootRelativePath: RUNTIME_TEMP_ROOT_RELATIVE_PATH,
  },
] as const;

export function classifyVaultLocalStateRelativePath(
  relativePath: string,
): VaultLocalStateBucketDescriptor | null {
  const normalized = normalizeVaultLocalStateRelativePath(relativePath);

  return (
    vaultLocalStateBucketDescriptors.find((descriptor) =>
      hasVaultLocalStatePrefix(normalized, descriptor.rootRelativePath),
    ) ?? null
  );
}

export function isVaultOperationalRelativePath(relativePath: string): boolean {
  return hasVaultLocalStatePrefix(
    normalizeVaultLocalStateRelativePath(relativePath),
    RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH,
  );
}

export function isVaultProjectionRelativePath(relativePath: string): boolean {
  return hasVaultLocalStatePrefix(
    normalizeVaultLocalStateRelativePath(relativePath),
    RUNTIME_PROJECTION_ROOT_RELATIVE_PATH,
  );
}

export function isVaultEphemeralRelativePath(relativePath: string): boolean {
  const normalized = normalizeVaultLocalStateRelativePath(relativePath);
  return (
    hasVaultLocalStatePrefix(normalized, RUNTIME_CACHE_ROOT_RELATIVE_PATH)
    || hasVaultLocalStatePrefix(normalized, RUNTIME_TEMP_ROOT_RELATIVE_PATH)
  );
}

function hasVaultLocalStatePrefix(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}${path.posix.sep}`);
}

function normalizeVaultLocalStateRelativePath(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "");
}
