import type {
  VaultSyncImportMergeResult,
} from "@murphai/core";
import type {
  HostedExecutionWake,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeVaultSyncImportStatus,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedRuntimePlatform,
} from "./platform.ts";
import {
  handleHostedVaultSyncImportWake,
} from "./events/vault-sync.ts";

type HostedVaultSyncImportWake = Extract<HostedExecutionWake, { kind: "vault.sync.import" }>;

export interface HostedVaultSyncMailboxImportInput {
  importVaultSyncWake?: typeof handleHostedVaultSyncImportWake;
  item: HostedMailboxResolvedImportItem;
  now?: () => string;
  platform: Pick<HostedRuntimePlatform, "vaultSyncPort">;
  vaultRoot: string;
  wake: HostedVaultSyncImportWake;
}

export async function importHostedVaultSyncMailboxItem(
  input: HostedVaultSyncMailboxImportInput,
): Promise<HostedMailboxItemImportOutcome> {
  if (
    input.item.route.action !== "import-vault-sync"
    || input.item.item.kind !== "vault.sync.import"
  ) {
    return {
      reasonCode: "vault_sync.unsupported_mailbox_route",
      status: "deferred",
    };
  }

  if (!decodedVaultSyncWakeMatchesMailboxItem(input.wake, input.item)) {
    return {
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  const vaultSyncPort = input.platform.vaultSyncPort ?? null;
  if (!vaultSyncPort) {
    return {
      reasonCode: "vault_sync.port_missing",
      status: "deferred",
    };
  }

  const fetched = await vaultSyncPort.fetchPayload({
    requestId: `${input.item.item.id}:vault-sync-payload`,
    sessionId: input.wake.vaultSync.sessionId,
  });

  if (!fetched.payload) {
    const unavailable = fetched.unavailable ?? null;
    const reasonCode = unavailable
      ? `vault_sync_payload.${unavailable.code}`
      : "vault_sync_payload.missing";

    return unavailable?.retryable === false
      ? {
          reasonCode,
          retryable: false,
          status: "blocked",
        }
      : {
          reasonCode,
          status: "deferred",
        };
  }

  const importVaultSyncWake = input.importVaultSyncWake ?? handleHostedVaultSyncImportWake;
  const effect = await importVaultSyncWake({
    vaultRoot: input.vaultRoot,
    vaultSyncImport: {
      bundleBase64: fetched.payload.bundleBase64,
      sessionId: fetched.payload.sessionId,
      ...(fetched.payload.sourceSchemaVersion === undefined
        ? {}
        : { sourceSchemaVersion: fetched.payload.sourceSchemaVersion }),
    },
    wake: input.wake,
  });
  const result = effect.vaultSyncImportResult;

  if (!result) {
    throw new TypeError("Hosted vault sync mailbox import did not return merge metrics.");
  }

  const status = resolveHostedVaultSyncImportStatus(result);
  const recorded = await vaultSyncPort.recordImport({
    importedAt: (input.now ?? (() => new Date().toISOString()))(),
    sessionId: input.wake.vaultSync.sessionId,
    status,
    summary: createHostedVaultSyncImportSummary(result),
  });

  if (!recorded.recorded) {
    return {
      reasonCode: "vault_sync.import_already_recorded",
      status: "skipped",
    };
  }

  return {
    ...(status === "imported_with_conflicts"
      ? { reasonCode: "vault_sync.imported_with_conflicts" }
      : {}),
    status: "imported",
  };
}

function decodedVaultSyncWakeMatchesMailboxItem(
  wake: HostedVaultSyncImportWake,
  item: HostedMailboxResolvedImportItem,
): boolean {
  return wake.userId === item.item.userId
    && wake.occurredAt === item.item.occurredAt
    && wake.eventId === item.item.dedupeKey;
}

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
