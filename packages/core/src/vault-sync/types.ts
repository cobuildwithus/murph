import type {
  HostedBundleArtifactRef,
  HostedBundleArtifactRestoreInput,
  HostedBundleArtifactSnapshotInput,
} from "@murphai/runtime-state/node";

export const VAULT_SYNC_IMPORT_MANIFEST_SCHEMA = "murph.vaultSync.importManifest.v1";
export const VAULT_SYNC_CONFLICT_MANIFEST_SCHEMA = "murph.vaultSync.conflictManifest.v1";
export const VAULT_SYNC_IMPORT_BUNDLE_KIND = "vault-sync-import" as const;

export const SYNC_IMPORT_ROOT = "raw/sync-imports";
export const IMPORT_PACK_VAULT_ROOT_KEY = "vault";
export const IMPORT_PACK_META_ROOT_KEY = "meta";
export const IMPORT_PACK_MANIFEST_PATH = "manifest.json";

export type VaultSyncImportFileKind = "jsonl_ledger" | "raw" | "text" | "metadata";

export interface VaultSyncSourceVaultMetadata {
  schemaVersion: string | null;
  title: string | null;
  vaultId: string | null;
}

export interface VaultSyncImportManifestFile {
  bytes: number;
  kind: VaultSyncImportFileKind;
  path: string;
  sha256: string;
}

export interface VaultSyncImportManifestExcludedFile {
  count: number;
  reason: string;
}

export interface VaultSyncImportManifest {
  createdAt: string;
  excluded: VaultSyncImportManifestExcludedFile[];
  files: VaultSyncImportManifestFile[];
  manifestHash: string;
  schema: typeof VAULT_SYNC_IMPORT_MANIFEST_SCHEMA;
  sourceVault: VaultSyncSourceVaultMetadata;
}

export interface VaultSyncImportArtifactSnapshotInput extends HostedBundleArtifactSnapshotInput {
  ref: HostedBundleArtifactRef;
}

export interface BuildVaultSyncImportPackInput {
  artifactSink?: (input: VaultSyncImportArtifactSnapshotInput) => Promise<void>;
  now?: Date;
  vaultRoot: string;
}

export interface BuildVaultSyncImportPackResult {
  bundle: Uint8Array;
  manifest: VaultSyncImportManifest;
  manifestHash: string;
  sourceSchemaVersion: string | null;
  sourceVaultId: string | null;
  sourceVaultTitle: string | null;
}

export interface RestoreVaultSyncImportPackInput {
  artifactResolver?: (input: HostedBundleArtifactRestoreInput) => Promise<Uint8Array | ArrayBuffer>;
  bundle: Uint8Array | ArrayBuffer;
  workspaceRoot?: string;
}

export interface RestoreVaultSyncImportPackResult {
  cleanup: () => Promise<void>;
  metaRoot: string;
  vaultRoot: string;
  workspaceRoot: string;
}

export interface MergeVaultSyncImportConflict {
  kind: "jsonl" | "raw" | "text" | "metadata";
  localSha256: string;
  path: string;
  preservedLocalPath?: string | null;
  reason: string;
  remoteSha256?: string | null;
}

export type VaultSyncImportConflict = MergeVaultSyncImportConflict;

export interface VaultSyncConflictManifest {
  conflicts: MergeVaultSyncImportConflict[];
  createdAt: string;
  schema: typeof VAULT_SYNC_CONFLICT_MANIFEST_SCHEMA;
  sessionId: string;
  sourceVaultId: string | null;
  summary: {
    conflictCount: number;
    importedJsonlRecords: number;
    importedRawFiles: number;
    importedTextFiles: number;
  };
}

export interface MergeVaultSyncImportInput {
  importedAt?: Date;
  importMetaRoot: string;
  importVaultRoot: string;
  sessionId: string;
  targetVaultRoot: string;
}

export interface MergeVaultSyncImportResult {
  conflictManifestPath: string | null;
  conflicts: MergeVaultSyncImportConflict[];
  imported: {
    jsonlRecords: number;
    rawFiles: number;
    textFiles: number;
  };
  sessionId: string;
  skipped: {
    duplicates: number;
    excludedFiles: number;
  };
}

export type VaultSyncImportMergeResult = MergeVaultSyncImportResult;
