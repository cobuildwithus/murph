import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import {
  buildHostedExecutionVaultShareAcceptedWake,
  buildHostedExecutionVaultSyncImportWake,
} from "@murphai/hosted-execution";
import type {
  VaultSyncImportMergeResult,
} from "@murphai/core";
import type {
  HostedMailboxItem,
  HostedRuntimeShareImportRequest,
  HostedRuntimeSharePayloadFetchRequest,
  HostedRuntimeVaultSyncImportRequest,
  HostedRuntimeVaultSyncPayloadFetchRequest,
} from "@murphai/hosted-execution/runtime-control";
import { describe, it } from "vitest";

import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  HostedRuntimePlatform,
  HostedRuntimeSharePort,
  HostedRuntimeVaultSyncPort,
} from "../src/hosted-runtime/platform.ts";
import {
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedSystemMailboxNextWakeAt,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  createHostedVaultSyncImportSummary,
  resolveHostedVaultSyncImportStatus,
} from "../src/hosted-runtime/vault-sync-import-summary.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const FIXED_NOW = "2026-04-21T00:00:00.000Z";

type HostedSystemMailboxRuntimeForTest =
  Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0]["runtime"];

function createVaultSyncMergeResult(input: {
  conflicts: VaultSyncImportMergeResult["conflicts"];
}): VaultSyncImportMergeResult {
  return {
    conflictManifestPath: input.conflicts.length > 0
      ? "raw/sync-imports/vsi_runtime/conflicts.json"
      : null,
    conflicts: input.conflicts,
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
  };
}

describe("hosted system mailbox checkpoint records", () => {
  it("summarizes runner-owned vault-sync merge results without the deleted direct importer", () => {
    const cleanResult = createVaultSyncMergeResult({ conflicts: [] });
    assert.equal(resolveHostedVaultSyncImportStatus(cleanResult), "imported");
    assert.deepEqual(createHostedVaultSyncImportSummary(cleanResult), {
      conflictCount: 0,
      importedJsonlRecords: 2,
      importedRawFiles: 3,
      importedTextFiles: 4,
      skippedDuplicates: 5,
      skippedExcludedFiles: 6,
    });

    const conflictedResult = createVaultSyncMergeResult({
      conflicts: [{
        kind: "text",
        localSha256: "sha256:local",
        path: "daily/2026-04-21.md",
        reason: "conflict",
        remoteSha256: "sha256:remote",
      }],
    });
    assert.equal(resolveHostedVaultSyncImportStatus(conflictedResult), "imported_with_conflicts");
    assert.equal(createHostedVaultSyncImportSummary(conflictedResult).conflictCount, 1);
  });

  it("keeps the deleted direct vault-sync mailbox importer out of the public runtime surface", async () => {
    await assert.rejects(
      access(new URL("../src/hosted-runtime/vault-sync-mailbox-import.ts", import.meta.url)),
    );

    const runtimeEntrypoint = await readFile(
      new URL("../src/hosted-runtime.ts", import.meta.url),
      "utf8",
    );
    assert.equal(runtimeEntrypoint.includes("importHostedVaultSyncMailboxItem"), false);
    assert.equal(runtimeEntrypoint.includes("vault-sync-mailbox-import"), false);
  });

  it("checkpoints non-retryable share side-input misses before recording quarantine to web", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const payloadFetchRequests: HostedRuntimeSharePayloadFetchRequest[] = [];
    const recordImportRequests: HostedRuntimeShareImportRequest[] = [];
    const sharePort: HostedRuntimeSharePort = {
      async fetchPayload(request) {
        payloadFetchRequests.push(request);
        return {
          fetchedAt: FIXED_NOW,
          payload: null,
          unavailable: {
            code: "gone",
            retryable: false,
          },
        };
      },
      async recordImport(request) {
        recordImportRequests.push(request);
        return {
          recorded: true,
          shareId: request.shareId,
          status: request.status,
        };
      },
    };
    const runtime = createRuntime({
      sharePort,
    });

    try {
      const wake = createShareWake();
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedShareItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "recording");
      if (!prepared || prepared.status !== "recording") {
        assert.fail("Expected terminal share side-input miss to prepare a recording receipt.");
      }
      assert.deepEqual(payloadFetchRequests, [
        {
          eventId: "event_share_accepted_123",
          ownerUserId: "member_sender",
          requestId: "event_share_accepted_123",
          shareId: "share_123",
        },
      ]);
      assert.deepEqual(recordImportRequests, []);
      assert.deepEqual(prepared.item.postCheckpointRecord, {
        kind: "share-import",
        request: {
          errorCode: "share_payload.gone",
          eventId: "event_share_accepted_123",
          importedAt: FIXED_NOW,
          ownerUserId: "member_sender",
          shareId: "share_123",
          status: "quarantined",
        },
      });

      assert.deepEqual(
        await recordHostedSystemMailboxItemAfterCheckpoint({
          item: prepared.item,
          runtime,
          vaultRoot: workspace.vaultRoot,
        }),
        {
          failed: 0,
          nextWakeAt: null,
          recorded: 1,
        },
      );
      assert.deepEqual(recordImportRequests, [
        {
          errorCode: "share_payload.gone",
          eventId: "event_share_accepted_123",
          importedAt: FIXED_NOW,
          ownerUserId: "member_sender",
          shareId: "share_123",
          status: "quarantined",
        },
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("checkpoints non-retryable vault-sync side-input misses before recording failure to web", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const payloadFetchRequests: HostedRuntimeVaultSyncPayloadFetchRequest[] = [];
    const recordImportRequests: HostedRuntimeVaultSyncImportRequest[] = [];
    const vaultSyncPort: HostedRuntimeVaultSyncPort = {
      async fetchPayload(request) {
        payloadFetchRequests.push(request);
        return {
          fetchedAt: FIXED_NOW,
          payload: null,
          unavailable: {
            code: "gone",
            retryable: false,
          },
        };
      },
      async recordImport(request) {
        recordImportRequests.push(request);
        return {
          recorded: true,
          sessionId: request.sessionId,
          status: request.status,
        };
      },
    };
    const runtime = createRuntime({
      vaultSyncPort,
    });

    try {
      const wake = createVaultSyncWake();
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedVaultSyncItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "recording");
      if (!prepared || prepared.status !== "recording") {
        assert.fail("Expected terminal vault-sync side-input miss to prepare a recording receipt.");
      }
      assert.deepEqual(payloadFetchRequests, [
        {
          requestId: "mailbox_item_system_vault_sync:vault-sync-payload",
          sessionId: "vsi_runtime",
        },
      ]);
      assert.deepEqual(recordImportRequests, []);
      assert.deepEqual(prepared.item.postCheckpointRecord, {
        kind: "vault-sync-import",
        request: {
          errorCode: "vault_sync_payload.gone",
          importedAt: FIXED_NOW,
          sessionId: "vsi_runtime",
          status: "failed",
          summary: {
            conflictCount: 0,
            importedJsonlRecords: 0,
            importedRawFiles: 0,
            importedTextFiles: 0,
            skippedDuplicates: 0,
            skippedExcludedFiles: 0,
          },
        },
      });

      assert.deepEqual(
        await recordHostedSystemMailboxItemAfterCheckpoint({
          item: prepared.item,
          runtime,
          vaultRoot: workspace.vaultRoot,
        }),
        {
          failed: 0,
          nextWakeAt: null,
          recorded: 1,
        },
      );
      assert.deepEqual(recordImportRequests, [
        {
          errorCode: "vault_sync_payload.gone",
          importedAt: FIXED_NOW,
          sessionId: "vsi_runtime",
          status: "failed",
          summary: {
            conflictCount: 0,
            importedJsonlRecords: 0,
            importedRawFiles: 0,
            importedTextFiles: 0,
            skippedDuplicates: 0,
            skippedExcludedFiles: 0,
          },
        },
      ]);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        null,
      );
    } finally {
      await workspace.cleanup();
    }
  });
});

function createRuntime(
  platformOverrides: Partial<HostedRuntimePlatform>,
): HostedSystemMailboxRuntimeForTest {
  const platform: HostedRuntimePlatform = {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
    ...platformOverrides,
  };

  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform,
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}

function createShareWake() {
  return buildHostedExecutionVaultShareAcceptedWake({
    eventId: "event_share_accepted_123",
    memberId: "member_123",
    occurredAt: FIXED_NOW,
    share: {
      ownerUserId: "member_sender",
      shareId: "share_123",
    },
  });
}

function createVaultSyncWake() {
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

function createResolvedShareItem(): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "event_share_accepted_123",
    expiresAt: null,
    id: "mailbox_item_system_share",
    kind: "vault.share.accepted",
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
      action: "import-vault-share",
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

function createResolvedVaultSyncItem(): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "vault-sync.import:vsi_runtime",
    expiresAt: null,
    id: "mailbox_item_system_vault_sync",
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
