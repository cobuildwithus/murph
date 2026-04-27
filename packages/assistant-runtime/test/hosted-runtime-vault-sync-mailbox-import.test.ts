import { describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionVaultSyncImportWake,
  HOSTED_RUNTIME_VAULT_SYNC_PAYLOAD_SCHEMA,
  type HostedMailboxItem,
} from "@murphai/hosted-execution";

import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  importHostedVaultSyncMailboxItem,
} from "../src/hosted-runtime/vault-sync-mailbox-import.ts";

const FIXED_NOW = "2026-04-21T00:00:00.000Z";

describe("importHostedVaultSyncMailboxItem", () => {
  it("hydrates side input, merges through the local runtime helper, and records import metrics", async () => {
    const fetchPayload = vi.fn(async () => ({
      fetchedAt: FIXED_NOW,
      payload: {
        bundleBase64: "AQID",
        payloadSchema: HOSTED_RUNTIME_VAULT_SYNC_PAYLOAD_SCHEMA,
        sessionId: "vsi_runtime",
        sourceSchemaVersion: "murph.vault.v1",
      },
    } as const));
    const recordImport = vi.fn(async () => ({
      recorded: true,
      sessionId: "vsi_runtime",
      status: "imported_with_conflicts" as const,
    }));
    const importVaultSyncWake = vi.fn(async () => ({
      conversationMetrics: null,
      shareImportResult: null,
      shareImportTitle: null,
      vaultSyncImportResult: {
        conflictManifestPath: "raw/sync-imports/vsi_runtime/manifest.json",
        conflicts: [{
          kind: "text" as const,
          localSha256: "sha256:local",
          path: "daily/2026-04-21.md",
          reason: "conflict",
          remoteSha256: "sha256:remote",
        }],
        imported: {
          jsonlRecords: 2,
          rawFiles: 3,
          textFiles: 4,
        },
        sessionId: "vsi_runtime",
        skipped: {
          duplicates: 5,
          excludedFiles: 6,
        },
      },
    }));
    const wake = createWake();

    const result = await importHostedVaultSyncMailboxItem({
      importVaultSyncWake,
      item: createResolvedImportItem(),
      now: () => FIXED_NOW,
      platform: {
        vaultSyncPort: {
          fetchPayload,
          recordImport,
        },
      },
      vaultRoot: "/tmp/target-vault",
      wake,
    });

    expect(fetchPayload).toHaveBeenCalledWith({
      requestId: "mailbox_item_1:vault-sync-payload",
      sessionId: "vsi_runtime",
    });
    expect(importVaultSyncWake).toHaveBeenCalledWith({
      vaultRoot: "/tmp/target-vault",
      vaultSyncImport: {
        bundleBase64: "AQID",
        sessionId: "vsi_runtime",
        sourceSchemaVersion: "murph.vault.v1",
      },
      wake,
    });
    expect(recordImport).toHaveBeenCalledWith({
      importedAt: FIXED_NOW,
      sessionId: "vsi_runtime",
      status: "imported_with_conflicts",
      summary: {
        conflictCount: 1,
        importedJsonlRecords: 2,
        importedRawFiles: 3,
        importedTextFiles: 4,
        skippedDuplicates: 5,
        skippedExcludedFiles: 6,
      },
    });
    expect(result).toEqual({
      reasonCode: "vault_sync.imported_with_conflicts",
      status: "imported",
    });
  });

  it("defers when the hosted platform has no vault-sync port", async () => {
    const result = await importHostedVaultSyncMailboxItem({
      item: createResolvedImportItem(),
      platform: {
        vaultSyncPort: null,
      },
      vaultRoot: "/tmp/target-vault",
      wake: createWake(),
    });

    expect(result).toEqual({
      reasonCode: "vault_sync.port_missing",
      status: "deferred",
    });
  });

  it("blocks deterministic side-input misses so the mailbox item can be quarantined", async () => {
    const result = await importHostedVaultSyncMailboxItem({
      importVaultSyncWake: vi.fn(),
      item: createResolvedImportItem(),
      platform: {
        vaultSyncPort: {
          fetchPayload: vi.fn(async () => ({
            fetchedAt: FIXED_NOW,
            payload: null,
            unavailable: {
              code: "gone",
              retryable: false,
            },
          } as const)),
          recordImport: vi.fn(),
        },
      },
      vaultRoot: "/tmp/target-vault",
      wake: createWake(),
    });

    expect(result).toEqual({
      reasonCode: "vault_sync_payload.gone",
      retryable: false,
      status: "blocked",
    });
  });
});

function createWake() {
  return buildHostedExecutionVaultSyncImportWake({
    eventId: "vault-sync.import:vsi_runtime",
    memberId: "member_123",
    occurredAt: FIXED_NOW,
    vaultSync: {
      localManifestHash: "sha256:manifest",
      sessionId: "vsi_runtime",
      sourceSchemaVersion: "murph.vault.v1",
      sourceVaultId: "vault_local",
      sourceVaultTitle: "Local Vault",
    },
  });
}

function createResolvedImportItem(): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "vault-sync.import:vsi_runtime",
    expiresAt: null,
    id: "mailbox_item_1",
    kind: "vault.sync.import",
    lane: "system",
    laneSeq: "1",
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadInlineCiphertext: "ciphertext",
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    updatedAt: FIXED_NOW,
    userId: "member_123",
  };

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext",
      payloadSchema: "murph.hosted-mailbox-payload.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "import-vault-sync",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}
