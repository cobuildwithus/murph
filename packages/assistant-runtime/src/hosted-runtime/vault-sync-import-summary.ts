import type {
  VaultSyncImportMergeResult,
} from "@murphai/core";
import type {
  HostedRuntimeVaultSyncImportStatus,
} from "@murphai/hosted-execution/runtime-control";

export function resolveHostedVaultSyncImportStatus(
  result: VaultSyncImportMergeResult,
): HostedRuntimeVaultSyncImportStatus {
  return result.conflicts.length > 0 ? "imported_with_conflicts" : "imported";
}

export function createHostedVaultSyncImportSummary(
  result: VaultSyncImportMergeResult,
) {
  return {
    conflictCount: result.conflicts.length,
    importedJsonlRecords: result.imported.jsonlRecords,
    importedRawFiles: result.imported.rawFiles,
    importedTextFiles: result.imported.textFiles,
    skippedDuplicates: result.skipped.duplicates,
    skippedExcludedFiles: result.skipped.excludedFiles,
  };
}
