import path from "node:path";

export type VaultLocalStateClassification = "operational" | "projection" | "ephemeral";
export type VaultLocalStatePortability = "portable" | "machine_local";

export interface VaultLocalStateBucketDescriptor {
  classification: VaultLocalStateClassification;
  defaultPortability: VaultLocalStatePortability;
  description: string;
  rebuildable: boolean;
  rootRelativePath: string;
}

export interface VaultLocalStateDescriptor extends VaultLocalStateBucketDescriptor {
  portability: VaultLocalStatePortability;
}

export const RUNTIME_ROOT_RELATIVE_PATH = ".runtime";
export const RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/operations`;
export const RUNTIME_PROJECTION_ROOT_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/projections`;
export const RUNTIME_CACHE_ROOT_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/cache`;
export const RUNTIME_TEMP_ROOT_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/tmp`;
export const ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/assistant`;

export const vaultLocalStateBucketDescriptors: readonly VaultLocalStateBucketDescriptor[] = [
  {
    classification: "operational",
    defaultPortability: "machine_local",
    description:
      "Durable local operational state such as tokens, cursors, daemon launcher metadata, assistant runtime residue, and user-configured local tool settings. Operational state is machine-local by default and must be classified explicitly before it can move with a hosted snapshot.",
    rebuildable: false,
    rootRelativePath: RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH,
  },
  {
    classification: "projection",
    defaultPortability: "machine_local",
    description:
      "Rebuildable local projections and indexes derived from canonical vault evidence or other durable runtime state.",
    rebuildable: true,
    rootRelativePath: RUNTIME_PROJECTION_ROOT_RELATIVE_PATH,
  },
  {
    classification: "ephemeral",
    defaultPortability: "machine_local",
    description:
      "Throwaway caches and temporary scratch files that may be deleted at any time without affecting durable runtime behavior.",
    rebuildable: true,
    rootRelativePath: RUNTIME_CACHE_ROOT_RELATIVE_PATH,
  },
  {
    classification: "ephemeral",
    defaultPortability: "machine_local",
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

export function describeVaultLocalStateRelativePath(
  relativePath: string,
): VaultLocalStateDescriptor | null {
  const normalized = normalizeVaultLocalStateRelativePath(relativePath);
  const bucket = classifyVaultLocalStateRelativePath(normalized);

  if (!bucket) {
    return null;
  }

  const portability = resolveVaultLocalStatePortability(normalized, bucket);

  return {
    ...bucket,
    portability,
  };
}

export function getVaultLocalStatePortability(
  relativePath: string,
): VaultLocalStatePortability | null {
  return describeVaultLocalStateRelativePath(relativePath)?.portability ?? null;
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

function resolveVaultLocalStatePortability(
  relativePath: string,
  bucket: VaultLocalStateBucketDescriptor,
): VaultLocalStatePortability {
  if (bucket.classification !== "operational") {
    return bucket.defaultPortability;
  }

  if (isPortableOperationalRelativePath(relativePath)) {
    return "portable";
  }

  return bucket.defaultPortability;
}

function isPortableOperationalRelativePath(relativePath: string): boolean {
  return (
    relativePath === INBOX_PROMOTIONS_RELATIVE_PATH
    || relativePath.startsWith(PORTABLE_WRITE_OPERATION_PREFIX)
    || relativePath === ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/automation-state.json`
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/failover.json`
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/cron`
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/cron/automation-runtime.json`
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/cron/jobs.json`
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/outbox`
    || relativePath.startsWith(`${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/outbox/`)
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/receipts`
    || relativePath.startsWith(`${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/receipts/`)
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/sessions`
    || relativePath.startsWith(`${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/sessions/`)
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/transcripts`
    || relativePath.startsWith(`${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/transcripts/`)
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/state/onboarding/first-contact`
    || relativePath.startsWith(`${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/state/onboarding/first-contact/`)
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/usage`
    || relativePath === `${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/usage/pending`
    || relativePath.startsWith(`${ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH}/usage/pending/`)
  );
}

function normalizeVaultLocalStateRelativePath(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "");
}

const INBOX_PROMOTIONS_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/inbox/promotions.json`;
const PORTABLE_WRITE_OPERATION_PREFIX = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/op_`;
