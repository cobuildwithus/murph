import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionDeviceSyncWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, it } from "vitest";

import {
  findNextHostedSystemMailboxQueueItem,
  readHostedSystemMailboxState,
  removeHostedSystemMailboxPendingItemIfCurrent,
  resolveHostedSystemMailboxHandledThroughSeq,
  resolveHostedSystemMailboxProgress,
  resolveHostedSystemMailboxNextWakeCandidate,
  resolveHostedSystemMailboxWakeCandidates,
  setHostedDeviceSyncMaintenanceMailboxWakeAt,
  updateHostedSystemMailboxPendingItem,
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
  type HostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  advanceHostedMailboxLaneWatermark,
  createEmptyHostedMailboxImportState,
  parseHostedMailboxImportStateEnvelope,
  readHostedMailboxImportState,
  recordHostedMailboxImportQuarantine,
  recordHostedMailboxImportStatus,
  resolveHostedMailboxImportStatePath,
  writeHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";

const DENSE_RAW_RETENTION_MAILBOX_DEDUPE_KEY = "device-sync.wake:dense-raw-retention";

function listDenseRawRetentionMailboxItems(
  state: HostedSystemMailboxState,
): HostedSystemMailboxPendingItem[] {
  return state.pending.filter((item) =>
    item.mailboxDedupeKey === DENSE_RAW_RETENTION_MAILBOX_DEDUPE_KEY
  );
}

async function readDenseRawRetentionMailboxItems(
  vaultRoot: string,
): Promise<HostedSystemMailboxPendingItem[]> {
  return listDenseRawRetentionMailboxItems(await readHostedSystemMailboxState(vaultRoot));
}

describe("hosted runtime mailbox import state", () => {
  it("initializes empty runtime-local state at the assistant operations path", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-mailbox-state-"));

    try {
      expect(resolveHostedMailboxImportStatePath(vaultRoot)).toBe(
        path.join(vaultRoot, HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH),
      );
      await expect(readHostedMailboxImportState({ vaultRoot })).resolves.toEqual({
        recentStatuses: [],
        watermarks: {
          conversation: "0",
          system: "0",
        },
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("writes and reads an explicit schema-versioned state envelope privately", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-mailbox-state-"));

    try {
      let state = createEmptyHostedMailboxImportState();
      state = advanceHostedMailboxLaneWatermark(state, {
        lane: "conversation",
        seq: "900719925474099312345",
      }).state;
      state = recordHostedMailboxImportStatus(state, {
        itemKind: "conversation.message",
        lane: "conversation",
        occurredAt: "2026-04-26T00:00:00.000Z",
        seq: "900719925474099312345",
        status: "imported",
      });

      await writeHostedMailboxImportState({
        state,
        vaultRoot,
      });

      await expect(readHostedMailboxImportState({ vaultRoot })).resolves.toEqual(state);

      const mode = (await stat(resolveHostedMailboxImportStatePath(vaultRoot))).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("rejects malformed schema, lanes, and decimal sequence strings", () => {
    const validEnvelope = {
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: {
        recentStatuses: [],
        watermarks: {
          conversation: "1",
          system: "0",
        },
      },
    };

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        ...validEnvelope,
        schema: "murph.hosted-mailbox-import-state.v0",
      }),
    ).toThrow(/schema must be murph\.hosted-mailbox-import-state\.v1/u);

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        ...validEnvelope,
        schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION + 1,
      }),
    ).toThrow(/schemaVersion must be 1/u);

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        ...validEnvelope,
        value: {
          recentStatuses: [],
          watermarks: {
            conversation: "1",
            system: "0",
            web: "2",
          },
        },
      }),
    ).toThrow(/must be one of: conversation, system/u);

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        ...validEnvelope,
        value: {
          recentStatuses: [],
          watermarks: {
            conversation: "01",
            system: "0",
          },
        },
      }),
    ).toThrow(/non-negative decimal string/u);
  });

  it("advances per-lane watermarks monotonically only", () => {
    let state = createEmptyHostedMailboxImportState();

    const firstAdvance = advanceHostedMailboxLaneWatermark(state, {
      lane: "system",
      seq: "3",
    });
    expect(firstAdvance.advanced).toBe(true);
    expect(firstAdvance.state.watermarks).toEqual({
      conversation: "0",
      system: "3",
    });

    const equalAdvance = advanceHostedMailboxLaneWatermark(firstAdvance.state, {
      lane: "system",
      seq: "3",
    });
    expect(equalAdvance.advanced).toBe(false);
    expect(equalAdvance.state.watermarks.system).toBe("3");

    const lowerAdvance = advanceHostedMailboxLaneWatermark(equalAdvance.state, {
      lane: "system",
      seq: "2",
    });
    expect(lowerAdvance.advanced).toBe(false);
    expect(lowerAdvance.state.watermarks.system).toBe("3");

    state = advanceHostedMailboxLaneWatermark(lowerAdvance.state, {
      lane: "conversation",
      seq: "4",
    }).state;
    expect(state.watermarks).toEqual({
      conversation: "4",
      system: "3",
    });
  });

  it("records compact quarantine metadata without accepting sensitive payload fields", () => {
    let state = createEmptyHostedMailboxImportState();

    state = recordHostedMailboxImportQuarantine(
      state,
      {
        itemKind: "conversation.message",
        lane: "conversation",
        occurredAt: "2026-04-26T00:00:00.000Z",
        reasonCode: "payload.missing",
        seq: "5",
      },
      {
        maxRecentStatuses: 2,
      },
    );
    state = recordHostedMailboxImportStatus(
      state,
      {
        itemKind: "system.maintenance",
        lane: "system",
        occurredAt: "2026-04-26T00:01:00.000Z",
        reasonCode: "kind.unsupported",
        seq: "7",
        status: "skipped",
      },
      {
        maxRecentStatuses: 2,
      },
    );

    expect(state.recentStatuses).toEqual([
      {
        itemKind: "conversation.message",
        lane: "conversation",
        occurredAt: "2026-04-26T00:00:00.000Z",
        reasonCode: "payload.missing",
        seq: "5",
        status: "quarantined",
      },
      {
        itemKind: "system.maintenance",
        lane: "system",
        occurredAt: "2026-04-26T00:01:00.000Z",
        reasonCode: "kind.unsupported",
        seq: "7",
        status: "skipped",
      },
    ]);

    expect(() =>
      parseHostedMailboxImportStateEnvelope({
        schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
        schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
        value: {
          recentStatuses: [
            {
              contactIdentifier: "not-allowed",
              itemKind: "conversation.message",
              lane: "conversation",
              occurredAt: "2026-04-26T00:00:00.000Z",
              providerPayload: {
                text: "not-allowed",
              },
              reasonCode: "payload.missing",
              seq: "5",
              status: "quarantined",
            },
          ],
          watermarks: {
            conversation: "5",
            system: "7",
          },
        },
      }),
    ).toThrow(/unsupported field contactIdentifier/u);
  });

  it("compacts status records to the newest bounded entries", () => {
    let state = createEmptyHostedMailboxImportState();

    for (let index = 1; index <= 4; index += 1) {
      state = recordHostedMailboxImportStatus(
        state,
        {
          itemKind: "system.maintenance",
          lane: "system",
          occurredAt: `2026-04-26T00:0${index}:00.000Z`,
          seq: String(index),
          status: "imported",
        },
        {
          maxRecentStatuses: 3,
        },
      );
    }

    expect(state.recentStatuses.map((record) => record.seq)).toEqual(["2", "3", "4"]);
  });
});

describe("hosted runtime system mailbox state", () => {
  it("acknowledges only the contiguous imported prefix before pending system work", () => {
    expect(resolveHostedSystemMailboxHandledThroughSeq({
      importedSeq: "9",
      state: {
        pending: [],
      },
    })).toBe("9");
    expect(resolveHostedSystemMailboxHandledThroughSeq({
      importedSeq: "9",
      state: {
        pending: [
          buildPendingSystemMailboxItem({ itemId: "pending_7", mailboxLaneSeq: "7" }),
          buildPendingSystemMailboxItem({ itemId: "pending_4", mailboxLaneSeq: "4" }),
        ],
      },
    })).toBe("3");
    expect(resolveHostedSystemMailboxProgress({
      importedSeq: "9",
      state: {
        pending: [
          buildPendingSystemMailboxItem({ itemId: "pending_7", mailboxLaneSeq: "7" }),
          buildPendingSystemMailboxItem({ itemId: "pending_4", mailboxLaneSeq: "4" }),
        ],
      },
    })).toEqual({
      deviceSyncContinuationSeqs: [],
      firstPendingClassifierFailures: ["wake_not_device_sync"],
      firstPendingSeq: "4",
      handledThroughSeq: "3",
    });
  });

  it.each([
    { blocker: "9", handled: "8", owner: "4", owners: ["4", "6"] },
    { blocker: "4", handled: "3", owner: "9", owners: ["6", "9"] },
  ])("keeps owner $owner stable across status transitions beside blocker $blocker", ({ blocker, handled, owner, owners }) => {
    const retryAt = "2026-04-28T00:00:00.000Z";
    const retainedDeviceRetry = buildRetainedDeviceSyncMailboxItem({
      itemId: "retained_device_retry",
      mailboxLaneSeq: owner,
      retryAt,
    });
    const pendingBlocker = {
      ...buildPendingDeviceSyncMailboxItem({
        itemId: "pending_blocker",
        mailboxLaneSeq: blocker,
      }),
      nextAttemptAt: "2026-04-29T00:00:00.000Z",
      wake: buildHostedExecutionDeviceSyncWake({
        connectionId: "dsc_pending_blocker",
        eventId: "device-sync.wake:pending_blocker",
        expectedConnectedAt: "2026-04-01T00:00:00.000Z",
        occurredAt: "2026-04-27T00:00:00.000Z",
        provider: "junction",
        reason: "reconcile_due",
        userId: "member_123",
      }),
    };
    const secondRetainedDeviceRetry = buildRetainedDeviceSyncMailboxItem({
      itemId: "second_retained_device_retry",
      mailboxLaneSeq: "6",
      retryAt,
    });

    expect(resolveHostedSystemMailboxProgress({
      importedSeq: "9",
      now: "2026-04-27T00:00:00.000Z",
      state: {
        pending: [pendingBlocker, secondRetainedDeviceRetry, retainedDeviceRetry],
      },
    })).toEqual({
      deviceSyncContinuationSeqs: owners,
      firstPendingClassifierFailures: ["continuation_owner_missing"],
      firstPendingSeq: blocker,
      handledThroughSeq: handled,
    });
    for (const item of [
      retainedDeviceRetry,
      {
        ...retainedDeviceRetry,
        attemptCount: 2,
        nextAttemptAt: null,
        status: "sending" as const,
      },
      {
        ...retainedDeviceRetry,
        attemptCount: 2,
        nextAttemptAt: null,
        postCheckpointRecord: {
          connectionId: "dsc_retained_device_retry",
          kind: "device-sync.dirty-processed" as const,
          processedRevision: "2",
        },
        status: "recording" as const,
      },
    ]) {
      expect(resolveHostedSystemMailboxProgress({
        importedSeq: "9",
        now: retryAt,
        state: { pending: [pendingBlocker, item] },
      })).toEqual({
        deviceSyncContinuationSeqs: [owner],
        firstPendingClassifierFailures: ["continuation_owner_missing"],
        firstPendingSeq: blocker,
        handledThroughSeq: handled,
      });
    }
  });

  it("promotes the exact legacy retained-pending shape to durable ownership", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    try {
      const {
        deviceSyncContinuationOwner: _legacyOwner,
        ...legacyRetained
      } = buildRetainedDeviceSyncMailboxItem({
        itemId: "legacy_retained_device_retry",
        mailboxLaneSeq: "4",
        retryAt: "2026-04-28T00:00:00.000Z",
      });
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [legacyRetained],
      }));

      const state = await readHostedSystemMailboxState(vaultRoot);
      expect(state.pending[0]?.deviceSyncContinuationOwner).toBe(true);
      expect(resolveHostedSystemMailboxProgress({
        importedSeq: "4",
        state,
      })).toEqual({
        deviceSyncContinuationSeqs: ["4"],
        firstPendingClassifierFailures: null,
        firstPendingSeq: null,
        handledThroughSeq: "4",
      });

      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [{
          ...legacyRetained,
          nextAttemptAt: "2026-04-28T00:01:00.000Z",
        }],
      }));
      const mismatchedLegacyState = await readHostedSystemMailboxState(vaultRoot);
      expect(mismatchedLegacyState.pending[0]?.deviceSyncContinuationOwner).toBeUndefined();
      expect(resolveHostedSystemMailboxProgress({
        importedSeq: "4",
        state: mismatchedLegacyState,
      })).toEqual({
        deviceSyncContinuationSeqs: [],
        firstPendingClassifierFailures: ["continuation_owner_missing"],
        firstPendingSeq: "4",
        handledThroughSeq: "3",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when continuation ownership is ambiguous or exceeds runtime authority", () => {
    const retryAt = "2026-04-28T00:00:00.000Z";
    const boundedRetained = Array.from({
      length: HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT,
    }, (_, index) =>
      buildRetainedDeviceSyncMailboxItem({
        itemId: `bounded_retained_${index + 1}`,
        mailboxLaneSeq: String(index + 1),
        retryAt,
      })
    );
    const importedSeq = String(boundedRetained.length);
    expect(resolveHostedSystemMailboxProgress({
      importedSeq,
      now: retryAt,
      state: { pending: [...boundedRetained].reverse() },
    })).toEqual({
      deviceSyncContinuationSeqs: boundedRetained.map((item) => item.mailboxLaneSeq!),
      firstPendingClassifierFailures: null,
      firstPendingSeq: null,
      handledThroughSeq: importedSeq,
    });

    const overflow = buildRetainedDeviceSyncMailboxItem({
      itemId: "bounded_retained_overflow",
      mailboxLaneSeq: String(boundedRetained.length + 1),
      retryAt,
    });
    expect(resolveHostedSystemMailboxProgress({
      importedSeq: overflow.mailboxLaneSeq!,
      now: retryAt,
      state: { pending: [...boundedRetained, overflow] },
    })).toEqual({
      deviceSyncContinuationSeqs: [],
      firstPendingClassifierFailures: ["continuation_projection_invalid"],
      firstPendingSeq: "1",
      handledThroughSeq: "0",
    });

    const duplicateConnection = buildRetainedDeviceSyncMailboxItem({
      connectionId: "dsc_bounded_retained_1",
      itemId: "duplicate_connection_owner",
      mailboxLaneSeq: String(boundedRetained.length + 2),
      retryAt,
    });
    expect(resolveHostedSystemMailboxProgress({
      importedSeq: duplicateConnection.mailboxLaneSeq!,
      now: retryAt,
      state: { pending: [boundedRetained[0]!, duplicateConnection] },
    })).toEqual({
      deviceSyncContinuationSeqs: [],
      firstPendingClassifierFailures: ["continuation_projection_invalid"],
      firstPendingSeq: "1",
      handledThroughSeq: "0",
    });

    const notImportedOwner = buildRetainedDeviceSyncMailboxItem({
      itemId: "not_imported_owner",
      mailboxLaneSeq: "2",
      retryAt,
    });
    expect(resolveHostedSystemMailboxProgress({
      importedSeq: "1",
      now: retryAt,
      state: { pending: [notImportedOwner] },
    })).toEqual({
      deviceSyncContinuationSeqs: [],
      firstPendingClassifierFailures: ["continuation_projection_invalid"],
      firstPendingSeq: "2",
      handledThroughSeq: "1",
    });
  });

  it("derives first-pending diagnostics from ownership, not retry hints", () => {
    const retained = buildRetainedDeviceSyncMailboxItem({
      itemId: "retained_device_retry",
      mailboxLaneSeq: "4",
      retryAt: "2026-04-28T00:00:00.000Z",
    });
    // The wake's job schedule no longer matches, but the explicit owner remains.
    const mismatchedRetry = {
      ...retained,
      nextAttemptAt: "2026-04-28T00:01:00.000Z",
    };
    expect(resolveHostedSystemMailboxProgress({
      importedSeq: "9",
      state: { pending: [mismatchedRetry] },
    })).toEqual({
      deviceSyncContinuationSeqs: ["4"],
      firstPendingClassifierFailures: null,
      firstPendingSeq: null,
      handledThroughSeq: "9",
    });

    const { deviceSyncContinuationOwner: _owner, ...unownedRetry } = mismatchedRetry;
    expect(resolveHostedSystemMailboxProgress({
      importedSeq: "9",
      state: { pending: [unownedRetry] },
    })).toEqual({
      deviceSyncContinuationSeqs: [],
      firstPendingClassifierFailures: ["continuation_owner_missing"],
      firstPendingSeq: "4",
      handledThroughSeq: "3",
    });
  });

  it("blocks legacy unsequenced work without letting synthetic retention wakes block the lane", async () => {
    expect(resolveHostedSystemMailboxHandledThroughSeq({
      importedSeq: "9",
      state: {
        pending: [buildPendingSystemMailboxItem({
          itemId: "pending_legacy",
          mailboxLaneSeq: null,
        })],
      },
    })).toBe("0");
    expect(resolveHostedSystemMailboxProgress({
      importedSeq: "9",
      state: {
        pending: [buildPendingSystemMailboxItem({
          itemId: "pending_legacy",
          mailboxLaneSeq: null,
        })],
      },
    })).toEqual({
      deviceSyncContinuationSeqs: [],
      firstPendingClassifierFailures: ["wake_not_device_sync"],
      firstPendingSeq: null,
      handledThroughSeq: "0",
    });

    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    try {
      await setHostedDeviceSyncMaintenanceMailboxWakeAt({
        nextWakeAt: "2026-04-08T00:00:30.000Z",
        userId: "member_123",
        vaultRoot,
      });
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "9",
        state: {
          pending: (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => ({
            ...item,
            status: "sending",
          })),
        },
      })).toBe("9");
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("serializes projection retries without blocking unrelated runtime controls", async () => {
    const maintenanceRetry = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_maintenance_retry",
      mailboxDedupeKey: "runtime-control:maintenance:retry",
      mailboxLaneSeq: "1",
      nextAttemptAt: "2026-04-27T00:01:00.000Z",
      wakeKind: "runtime.maintenance-requested",
    });
    const projectionRetry = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_projection_retry",
      mailboxDedupeKey: "runtime-control:group-share-projection:generation_1",
      mailboxLaneSeq: "1",
      nextAttemptAt: "2026-04-27T00:01:00.000Z",
      postCheckpointRecord: { kind: "vault-share.projection" },
      wakeKind: "runtime.maintenance-requested",
    });
    const laterProjection = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_projection_later",
      mailboxDedupeKey: "runtime-control:group-share-projection:generation_2",
      mailboxLaneSeq: "2",
      wakeKind: "runtime.maintenance-requested",
    });
    const codexDisconnect = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_codex_disconnect",
      mailboxDedupeKey: "runtime-control:codex-auth:disconnect",
      mailboxLaneSeq: "3",
      wakeKind: "runtime.codex-auth-requested",
    });
    const browserVaultRefresh = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_browser_vault_refresh",
      mailboxDedupeKey: "runtime-control:browser-vault-refresh:generation_1",
      mailboxLaneSeq: "4",
      wakeKind: "runtime.browser-vault-refresh-requested",
    });

    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: ["apply-runtime-control-request"],
      now: "2026-04-27T00:00:00.000Z",
      state: { pending: [projectionRetry, laterProjection, codexDisconnect] },
    })).toEqual(codexDisconnect);

    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: ["apply-runtime-control-request"],
      now: "2026-04-27T00:01:00.000Z",
      state: { pending: [projectionRetry, laterProjection, codexDisconnect] },
    })).toEqual(projectionRetry);

    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: ["apply-runtime-control-request"],
      now: "2026-04-27T00:00:00.000Z",
      state: { pending: [projectionRetry, laterProjection, browserVaultRefresh] },
    })).toEqual(browserVaultRefresh);

    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: ["apply-runtime-control-request"],
      now: "2026-04-27T00:00:00.000Z",
      state: { pending: [laterProjection] },
    })).toEqual(laterProjection);

    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    try {
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [projectionRetry, laterProjection, codexDisconnect],
      }));
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        allowedRouteActions: ["apply-runtime-control-request"],
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        at: "2026-04-27T00:00:00.000Z",
        executionClass: "default_owned",
        reason: "assistant",
      });

      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [maintenanceRetry, codexDisconnect],
      }));
      await expect(resolveHostedSystemMailboxWakeCandidates({
        allowedRouteActions: ["apply-runtime-control-request"],
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: null,
          reason: null,
        },
        next: {
          at: "2026-04-27T00:01:00.000Z",
          executionClass: null,
          reason: "mailbox",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("uses the ready approved continuation as the default item and wake authority", async () => {
    const codexRetry = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_codex_retry",
      mailboxDedupeKey: "runtime-control:codex-auth:retry",
      mailboxLaneSeq: "1",
      nextAttemptAt: "2026-04-27T00:01:00.000Z",
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      wakeKind: "runtime.codex-auth-requested",
    });
    const deviceWake = buildPendingDeviceSyncMailboxItem({
      itemId: "pending_device_sync",
      mailboxLaneSeq: "2",
    });
    const approvedContinuationA = buildPendingApprovalContinuationMailboxItem({
      effectId: "effect_approved_export_a",
      itemId: "pending_approved_continuation_a",
      mailboxLaneSeq: "3",
    });
    const approvedContinuationB = buildPendingApprovalContinuationMailboxItem({
      effectId: "effect_approved_export_b",
      itemId: "pending_approved_continuation_b",
      mailboxLaneSeq: "4",
    });
    const state = {
      pending: [
        codexRetry,
        deviceWake,
        approvedContinuationA,
        approvedContinuationB,
      ],
    };

    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: "2026-04-27T00:00:00.000Z",
      state,
    })).toEqual(approvedContinuationA);
    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: "2026-04-27T00:00:00.000Z",
      state: {
        pending: state.pending.filter((item) =>
          item.itemId !== approvedContinuationA.itemId
        ),
      },
    })).toEqual(approvedContinuationB);
    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: ["run-device-sync-wake", "apply-runtime-control-request"],
      now: "2026-04-27T00:00:00.000Z",
      state,
    })).toEqual(deviceWake);

    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    try {
      await updateHostedSystemMailboxState(vaultRoot, () => state);

      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        at: "2026-04-27T00:00:00.000Z",
        executionClass: "default_owned",
        reason: "assistant",
      });
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: "2026-04-27T00:00:00.000Z",
          reason: "assistant",
        },
        next: {
          at: "2026-04-27T00:00:00.000Z",
          executionClass: "default_owned",
          reason: "assistant",
        },
      });
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        allowedRouteActions: ["run-device-sync-wake"],
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        at: "2026-04-27T00:00:00.000Z",
        executionClass: "model_free",
        reason: "device-sync.reconcile",
      });

      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [deviceWake, approvedContinuationA],
      }));
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: "2026-04-27T00:00:00.000Z",
          reason: "assistant",
        },
        next: {
          at: "2026-04-27T00:00:00.000Z",
          executionClass: "default_owned",
          reason: "assistant",
        },
      });

      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [codexRetry, deviceWake],
      }));
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        at: "2026-04-27T00:00:00.000Z",
        executionClass: "model_free",
        reason: "device-sync.reconcile",
      });
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: "2026-04-27T00:01:00.000Z",
          reason: "assistant",
        },
        next: {
          at: "2026-04-27T00:00:00.000Z",
          executionClass: "model_free",
          reason: "device-sync.reconcile",
        },
      });
      await expect(resolveHostedSystemMailboxWakeCandidates({
        allowedRouteActions: ["run-assistant-ask"],
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: "2026-04-27T00:01:00.000Z",
          reason: "assistant",
        },
        next: {
          at: null,
          executionClass: null,
          reason: null,
        },
      });

      const maintenanceRetry = buildPendingRuntimeControlMailboxItem({
        itemId: "pending_maintenance_before_approved_continuation",
        mailboxDedupeKey: "runtime-control:maintenance:before-approved",
        mailboxLaneSeq: "1",
        nextAttemptAt: "2026-04-27T00:01:00.000Z",
        wakeKind: "runtime.maintenance-requested",
      });
      const approvedContinuationRetry = {
        ...approvedContinuationA,
        nextAttemptAt: "2026-04-27T00:00:30.000Z",
      };
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [maintenanceRetry, approvedContinuationRetry],
      }));
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: "2026-04-27T00:00:30.000Z",
          reason: "assistant",
        },
        next: {
          at: "2026-04-27T00:00:30.000Z",
          executionClass: null,
          reason: "assistant",
        },
      });
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => "2026-04-27T00:00:30.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: "2026-04-27T00:00:30.000Z",
          reason: "assistant",
        },
        next: {
          at: "2026-04-27T00:00:30.000Z",
          executionClass: "default_owned",
          reason: "assistant",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("uses the selected model-free frontier as mailbox wake authority", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    const earlierDefaultOwned = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_earlier_default_owned",
      mailboxDedupeKey: "runtime-control:codex-auth:connect",
      mailboxLaneSeq: "1",
      wakeKind: "runtime.codex-auth-requested",
    });
    const browserVaultRefresh = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_browser_vault_refresh",
      mailboxDedupeKey: "runtime-control:browser-vault-refresh:frontier",
      mailboxLaneSeq: "2",
      wakeKind: "runtime.browser-vault-refresh-requested",
    });
    const laterDefaultOwned = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_default_owned",
      mailboxDedupeKey: "runtime-control:codex-auth:disconnect",
      mailboxLaneSeq: "3",
      wakeKind: "runtime.codex-auth-requested",
    });

    try {
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [earlierDefaultOwned, browserVaultRefresh, laterDefaultOwned],
      }));

      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        at: "2026-04-27T00:00:00.000Z",
        executionClass: "default_owned",
        reason: "assistant",
      });
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        excludeItemId: earlierDefaultOwned.itemId,
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        at: "2026-04-27T00:00:00.000Z",
        executionClass: "model_free",
        reason: "mailbox",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it.each(["runtime.maintenance-requested", "runtime.browser-vault-refresh-requested"] as const)(
    "runs due %s after a transferred device continuation without advancing its retry",
    async (wakeKind) => {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-transferred-frontier-"));
      const now = "2026-04-27T00:00:00.000Z";
      const retryAt = "2026-04-28T00:00:00.000Z";
      const retained = buildRetainedDeviceSyncMailboxItem({
        itemId: "retained_history", mailboxLaneSeq: "1", retryAt,
      });
      const successor = buildPendingRuntimeControlMailboxItem({
        itemId: "due_control", mailboxLaneSeq: "2",
        mailboxDedupeKey: `runtime-control:${wakeKind}:synthetic`, wakeKind,
      });
      try {
        await writeHostedMailboxImportState({
          vaultRoot,
          state: { ...createEmptyHostedMailboxImportState(), watermarks: { conversation: "0", system: "2" } },
        });
        await updateHostedSystemMailboxState(vaultRoot, () => ({ pending: [retained, successor] }));
        const restored = await readHostedSystemMailboxState(vaultRoot);
        expect(resolveHostedSystemMailboxProgress({ importedSeq: "2", state: restored }))
          .toMatchObject({ handledThroughSeq: "1", firstPendingSeq: "2", deviceSyncContinuationSeqs: ["1"] });
        await expect(resolveHostedSystemMailboxWakeCandidates({ vaultRoot, now: () => now }))
          .resolves.toMatchObject({ next: { at: now, executionClass: "model_free", reason: "mailbox" } });
        expect((await readHostedSystemMailboxState(vaultRoot)).pending[0]).toEqual(retained);
        await removeHostedSystemMailboxPendingItemIfCurrent({ item: successor, vaultRoot });
        await expect(resolveHostedSystemMailboxNextWakeCandidate({ vaultRoot, now: () => now }))
          .resolves.toEqual({ at: retryAt, executionClass: null, reason: "device-sync.reconcile" });
      } finally {
        await rm(vaultRoot, { recursive: true, force: true });
      }
    },
  );

  it.each([false, true])("keeps deferred dirty admission separate from default wake priority (approved: %s)", async (approved) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-deferred-default-wake-"));
    const now = "2026-04-27T00:00:00.000Z";
    const retryAt = "2026-04-28T00:00:00.000Z";
    const retained = buildRetainedDeviceSyncMailboxItem({
      connectionId: "synthetic_connection", itemId: "retained", mailboxLaneSeq: "1", retryAt,
    });
    const dirty = buildPendingDeviceSyncMailboxItem({ itemId: "dirty", mailboxLaneSeq: "2" });
    dirty.nextAttemptAt = retryAt;
    dirty.wake = buildHostedExecutionDeviceSyncWake({
      connectionId: "synthetic_connection", eventId: dirty.mailboxDedupeKey,
      expectedConnectedAt: "2026-04-01T00:00:00.000Z", occurredAt: now,
      provider: "junction", reason: "webhook_hint", userId: "member_123",
      hint: { reason: "companion_hrv_rmssd" },
    });
    const foreground = approved
      ? buildPendingApprovalContinuationMailboxItem({ effectId: "synthetic_effect", itemId: "foreground", mailboxLaneSeq: "3" })
      : buildPendingRuntimeControlMailboxItem({ itemId: "foreground", mailboxLaneSeq: "3",
        mailboxDedupeKey: "runtime-control:synthetic-auth", wakeKind: "runtime.codex-auth-requested" });
    try {
      await writeHostedMailboxImportState({ vaultRoot, state: {
        ...createEmptyHostedMailboxImportState(), watermarks: { conversation: "0", system: "3" },
      } });
      await updateHostedSystemMailboxState(vaultRoot, () => ({ pending: [retained, dirty, foreground] }));
      const before = await readHostedSystemMailboxState(vaultRoot);
      await expect(resolveHostedSystemMailboxWakeCandidates({
        allowedRouteActions: ["run-device-sync-wake", "apply-runtime-control-request", "dispatch-assistant-notification"],
        allowedWakeKinds: ["device-sync.wake", "runtime.maintenance-requested", "assistant.notification.requested"],
        now: () => now, vaultRoot,
      })).resolves.toEqual({
        defaultOwned: { at: now, reason: "assistant" },
        next: { at: now, executionClass: "model_free", reason: "device-sync.reconcile" },
      });
      // An already-running default pass keeps its ordinary foreground choice.
      await expect(resolveHostedSystemMailboxWakeCandidates({ now: () => now, vaultRoot }))
        .resolves.toMatchObject({ next: { at: now, executionClass: "default_owned", reason: "assistant" } });
      expect(await readHostedSystemMailboxState(vaultRoot)).toEqual(before);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it.each(["independent", "same-connection", "untransferred", "duplicate-owner", "unimported"] as const)(
    "runs independent connections without advancing invalid continuation authority (%s)", async (boundary) => {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-continuation-boundary-"));
      const now = "2026-04-27T00:00:00.000Z";
      const retryAt = "2026-04-28T00:00:00.000Z";
      const retained = buildRetainedDeviceSyncMailboxItem({
        connectionId: "connection_a", itemId: "history_a", mailboxLaneSeq: "1", retryAt,
      });
      const pending = buildPendingDeviceSyncMailboxItem({ itemId: "fresh_device", mailboxLaneSeq: "2" });
      const successor = {
        ...pending,
        wake: buildHostedExecutionDeviceSyncWake({
          connectionId: boundary === "same-connection" ? "connection_a" : "connection_b",
          eventId: pending.mailboxDedupeKey, expectedConnectedAt: "2026-04-01T00:00:00.000Z",
          occurredAt: now, provider: "junction", reason: "reconcile_due", userId: "member_123",
          hint: { reason: "manual_reconcile" },
        }),
      };
      const { deviceSyncContinuationOwner: _owner, ...untransferred } = retained;
      const state = { pending: [boundary === "untransferred"
        ? { ...untransferred, wake: { ...untransferred.wake, hint: undefined } } : retained,
        successor,
        ...(boundary === "duplicate-owner" ? [buildRetainedDeviceSyncMailboxItem({
          connectionId: "connection_a", itemId: "duplicate_history", mailboxLaneSeq: "3", retryAt,
        })] : []),
      ] };
      try {
        await writeHostedMailboxImportState({ vaultRoot, state: {
          ...createEmptyHostedMailboxImportState(),
          watermarks: { conversation: "0", system: boundary === "unimported" ? "0" : "3" },
        } });
        await updateHostedSystemMailboxState(vaultRoot, () => state);
        await expect(resolveHostedSystemMailboxNextWakeCandidate({ vaultRoot, now: () => now }))
          .resolves.toEqual({ at: boundary === "same-connection" ? retryAt : now,
            executionClass: boundary === "same-connection" ? null : "model_free",
            reason: "device-sync.reconcile" });
        const restored = await readHostedSystemMailboxState(vaultRoot);
        expect(restored.pending).toEqual(state.pending);
        // Admission may pass unrelated work; handled-prefix authority still
        // requires an imported, unique continuation owner.
        const validContinuation = boundary === "independent" || boundary === "same-connection";
        expect(resolveHostedSystemMailboxProgress({
          importedSeq: boundary === "unimported" ? "0" : "3", state: restored,
        })).toMatchObject({
          handledThroughSeq: validContinuation ? "1" : "0",
          deviceSyncContinuationSeqs: validContinuation ? ["1"] : [],
        });
      } finally {
        await rm(vaultRoot, { recursive: true, force: true });
      }
    },
  );

  it("does not delay unrelated due maintenance behind a backed-off device item", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    const now = "2026-04-27T00:00:00.000Z";
    const deviceRetryAt = "2026-04-27T00:01:00.000Z";
    const retainedDeviceFrontier = {
      ...buildPendingDeviceSyncMailboxItem({
        itemId: "pending_retained_device_frontier",
        mailboxLaneSeq: "1",
      }),
      attemptCount: 1,
      lastAttemptAt: now,
      lastErrorCode: "device_sync_retry",
      lastErrorMessage: "redacted",
      nextAttemptAt: deviceRetryAt,
    };
    const dueMaintenanceSuccessor = buildPendingRuntimeControlMailboxItem({
      itemId: "pending_due_maintenance_successor",
      mailboxDedupeKey: "runtime-control:maintenance:successor",
      mailboxLaneSeq: "2",
      wakeKind: "runtime.maintenance-requested",
    });

    try {
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [retainedDeviceFrontier, dueMaintenanceSuccessor],
      }));

      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => now,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: null,
          reason: null,
        },
        next: {
          at: now,
          executionClass: "model_free",
          reason: "mailbox",
        },
      });
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => deviceRetryAt,
        vaultRoot,
      })).resolves.toEqual({
        at: deviceRetryAt,
        executionClass: "model_free",
        reason: "device-sync.reconcile",
      });
      await removeHostedSystemMailboxPendingItemIfCurrent({
        item: retainedDeviceFrontier,
        vaultRoot,
      });
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => deviceRetryAt,
        vaultRoot,
      })).resolves.toEqual({
        at: deviceRetryAt,
        executionClass: "model_free",
        reason: "mailbox",
      });
      await removeHostedSystemMailboxPendingItemIfCurrent({
        item: dueMaintenanceSuccessor,
        vaultRoot,
      });
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => deviceRetryAt,
        vaultRoot,
      })).resolves.toEqual({
        at: null,
        executionClass: null,
        reason: null,
      });

      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [retainedDeviceFrontier, dueMaintenanceSuccessor],
      }));
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        excludeItemId: retainedDeviceFrontier.itemId,
        now: () => now,
        vaultRoot,
      })).resolves.toEqual({
        at: now,
        executionClass: "model_free",
        reason: "mailbox",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps a reported daily metric in the model-free device frontier", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    const deviceWake = buildPendingDeviceSyncMailboxItem({
      itemId: "pending_device_sync_before_reported_metric",
      mailboxLaneSeq: "1",
    });
    const reportedMetric = buildPendingReportedDailyMetricMailboxItem({
      itemId: "pending_reported_metric_after_device_sync",
      mailboxLaneSeq: "2",
    });

    try {
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [deviceWake, reportedMetric],
      }));

      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: null,
          reason: null,
        },
        next: {
          at: "2026-04-27T00:00:00.000Z",
          executionClass: "model_free",
          reason: "device-sync.reconcile",
        },
      });

      await removeHostedSystemMailboxPendingItemIfCurrent({
        item: deviceWake,
        vaultRoot,
      });
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: null,
          reason: null,
        },
        next: {
          at: "2026-04-27T00:00:00.000Z",
          executionClass: "model_free",
          reason: "mailbox",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps assistant readiness independent of a runnable device-sync owner", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-hosted-system-mailbox-state-"),
    );
    const now = "2026-04-27T00:00:00.000Z";
    const deviceRetryAt = "2026-04-27T00:05:00.000Z";
    const deviceWake: HostedSystemMailboxPendingItem = {
      ...buildPendingDeviceSyncMailboxItem({
        itemId: "pending_device_sync_before_generic_notification",
        mailboxLaneSeq: "1",
      }),
      attemptCount: 1,
      lastAttemptAt: now,
      postCheckpointRecord: {
        connectionId: "device_sync_connection_synthetic",
        kind: "device-sync.dirty-processed",
        processedRevision: "7",
      },
      status: "recording",
    };
    const notification = buildPendingAssistantNotificationMailboxItem({
      itemId: "pending_generic_notification_after_device_sync",
      mailboxLaneSeq: "2",
    });

    try {
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [deviceWake, notification],
      }));

      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => now,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: now,
          reason: "assistant",
        },
        next: {
          at: now,
          executionClass: "model_free",
          reason: "device-sync.reconcile",
        },
      });

      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [{
          ...deviceWake,
          lastErrorCode: "device_sync_retry",
          lastErrorMessage: "redacted",
          nextAttemptAt: deviceRetryAt,
        }, notification],
      }));
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => now,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: now,
          reason: "assistant",
        },
        next: {
          at: now,
          executionClass: "default_owned",
          reason: "assistant",
        },
      });

      const retainedDeviceWake = (await readHostedSystemMailboxState(vaultRoot))
        .pending.find((item) => item.itemId === deviceWake.itemId);
      if (!retainedDeviceWake) {
        throw new Error("Expected the synthetic device frontier to remain pending.");
      }
      await removeHostedSystemMailboxPendingItemIfCurrent({
        item: retainedDeviceWake,
        vaultRoot,
      });
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => now,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: now,
          reason: "assistant",
        },
        next: {
          at: now,
          executionClass: "default_owned",
          reason: "assistant",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("lets a fresh same-connection webhook admit the retained device frontier", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-hosted-system-mailbox-state-"),
    );
    const now = "2026-04-27T00:00:00.000Z";
    const retryAt = "2026-04-28T00:00:00.000Z";
    const connectionId = "device_sync_connection_synthetic";
    const retained: HostedSystemMailboxPendingItem = {
      ...buildPendingDeviceSyncMailboxItem({
        itemId: "pending_retained_device_retry",
        mailboxLaneSeq: "1",
      }),
      attemptCount: 1,
      lastAttemptAt: now,
      nextAttemptAt: retryAt,
      wake: {
        connectionId,
        eventId: "device-sync.wake:retained-retry",
        hint: {
          jobs: [{
            availableAt: retryAt,
            dedupeKey: "retained-historical-job",
            kind: "resource",
            maxAttempts: 1,
            payload: {},
            priority: 30,
          }],
        },
        kind: "device-sync.wake",
        occurredAt: now,
        provider: "junction",
        reason: "reconcile_due",
        userId: "member_123",
      },
    };
    const webhook: HostedSystemMailboxPendingItem = {
      ...buildPendingDeviceSyncMailboxItem({
        itemId: "pending_fresh_device_webhook",
        mailboxLaneSeq: "2",
      }),
      occurredAt: "2026-04-27T00:00:01.000Z",
      wake: {
        connectionId,
        eventId: "device-sync.wake:fresh-webhook",
        kind: "device-sync.wake",
        occurredAt: "2026-04-27T00:00:01.000Z",
        provider: "junction",
        reason: "webhook_hint",
        userId: "member_123",
      },
    };

    try {
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [retained, webhook],
      }));

      expect(findNextHostedSystemMailboxQueueItem({
        allowedRouteActions: ["run-device-sync-wake"],
        now,
        state: { pending: [retained, webhook] },
      })).toEqual({
        ...retained,
        nextAttemptAt: null,
      });
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => now,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: null,
          reason: null,
        },
        next: {
          at: now,
          executionClass: "model_free",
          reason: "device-sync.reconcile",
        },
      });

      const scheduledSuccessor: HostedSystemMailboxPendingItem = {
        ...webhook,
        itemId: "pending_repeated_scheduled_reconcile",
        mailboxDedupeKey: "device-sync.wake:repeated-scheduled-reconcile",
        wake: {
          connectionId,
          eventId: "device-sync.wake:repeated-scheduled-reconcile",
          kind: "device-sync.wake",
          occurredAt: "2026-04-27T00:00:01.000Z",
          provider: "junction",
          reason: "reconcile_due",
          userId: "member_123",
        },
      };
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [retained, scheduledSuccessor],
      }));
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => now,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: null,
          reason: null,
        },
        next: {
          at: retryAt,
          executionClass: null,
          reason: "device-sync.reconcile",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps a distinct dense raw retention successor after dirty receipt recording", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));

    try {
      await setHostedDeviceSyncMaintenanceMailboxWakeAt({
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        now: () => "2026-04-07T23:59:30.000Z",
        userId: "member_123",
        vaultRoot,
      });
      const [dueItem] = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(dueItem).toBeDefined();

      const sendingItem: HostedSystemMailboxPendingItem = {
        ...dueItem!,
        attemptCount: 1,
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
        nextAttemptAt: null,
        status: "sending",
      };
      await updateHostedSystemMailboxPendingItem({
        item: sendingItem,
        vaultRoot,
      });

      await setHostedDeviceSyncMaintenanceMailboxWakeAt({
        nextWakeAt: "2026-04-08T00:00:30.000Z",
        now: () => "2026-04-08T00:00:00.000Z",
        userId: "member_123",
        vaultRoot,
      });

      let denseItems = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(denseItems).toHaveLength(2);
      const successor = denseItems.find((item) => item.status === "pending");
      expect(successor).toBeDefined();
      expect(successor!.itemId).not.toBe(sendingItem.itemId);
      expect(successor!.nextAttemptAt).toBe("2026-04-08T00:00:30.000Z");
      expect(successor!.routeAction).toBe("run-device-sync-wake");
      expect(successor!.wake.kind).toBe("device-sync.wake");
      expect(successor!.wake.eventId).toBe(successor!.itemId);

      const recordingItem: HostedSystemMailboxPendingItem = {
        ...sendingItem,
        postCheckpointRecord: {
          connectionId: "conn_123",
          kind: "device-sync.dirty-processed",
          processedRevision: "rev_1",
        },
        status: "recording",
      };
      await updateHostedSystemMailboxPendingItem({
        item: recordingItem,
        vaultRoot,
      });

      denseItems = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(denseItems.map((item) => item.itemId).sort()).toEqual(
        [recordingItem.itemId, successor!.itemId].sort(),
      );

      await removeHostedSystemMailboxPendingItemIfCurrent({
        item: recordingItem,
        vaultRoot,
      });

      denseItems = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(denseItems).toHaveLength(1);
      expect(denseItems[0].itemId).toBe(successor!.itemId);
      expect(denseItems[0].nextAttemptAt).toBe("2026-04-08T00:00:30.000Z");

      await expect(
        resolveHostedSystemMailboxNextWakeCandidate({
          now: () => "2026-04-08T00:00:00.000Z",
          vaultRoot,
        }),
      ).resolves.toEqual({
        at: "2026-04-08T00:00:30.000Z",
        executionClass: null,
        reason: "device-sync.reconcile",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("keeps due sequence-less dense raw retention on the model-free owner", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    const dueAt = "2026-04-08T00:00:00.000Z";

    try {
      await setHostedDeviceSyncMaintenanceMailboxWakeAt({
        nextWakeAt: dueAt,
        now: () => "2026-04-07T23:59:30.000Z",
        userId: "member_123",
        vaultRoot,
      });

      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        now: () => dueAt,
        vaultRoot,
      })).resolves.toEqual({
        at: dueAt,
        executionClass: "model_free",
        reason: "device-sync.reconcile",
      });
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => dueAt,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: null,
          reason: null,
        },
        next: {
          at: dueAt,
          executionClass: "model_free",
          reason: "device-sync.reconcile",
        },
      });

      const defaultOwnedAt = "2026-04-08T00:05:00.000Z";
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: [
          ...state.pending,
          {
            ...buildPendingSystemMailboxItem({
              itemId: "pending_default_owned_after_dense_raw_retention",
              mailboxLaneSeq: "1",
            }),
            nextAttemptAt: defaultOwnedAt,
          },
        ],
      }));
      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => dueAt,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: defaultOwnedAt,
          reason: "assistant",
        },
        next: {
          at: dueAt,
          executionClass: "model_free",
          reason: "device-sync.reconcile",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it.each(["pending", "recording"] as const)("keeps sequence-less device work on the system owner while %s", async (status) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    const dueAt = "2026-04-27T00:00:00.000Z";
    try {
      const timer = {
        ...buildPendingDeviceSyncMailboxItem({ itemId: "local_timer", mailboxLaneSeq: "1" }),
        mailboxLaneSeq: null,
        status,
      };
      await updateHostedSystemMailboxState(vaultRoot, () => ({ pending: [timer] }));
      // Re-read persisted state at successive invocation times. Rewriting a
      // due timer must never turn unchanged system work into foreground work.
      for (const offsetMs of [0, 10_000, 30_000]) {
        const now = new Date(Date.parse(dueAt) + offsetMs).toISOString();
        await expect(resolveHostedSystemMailboxWakeCandidates({ now: () => now, vaultRoot }))
          .resolves.toEqual({
            defaultOwned: { at: null, reason: null },
            next: { at: now, executionClass: "model_free", reason: "device-sync.reconcile" },
          });
      }
      expect((await readHostedSystemMailboxState(vaultRoot)).pending).toHaveLength(1);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps legacy sequence-less model-free kinds on the system owner", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    const dueAt = "2026-04-27T00:00:00.000Z";

    try {
      const legacyMaintenanceItem = {
        ...buildPendingRuntimeControlMailboxItem({
          itemId: "pending_legacy_sequence_less_maintenance",
          mailboxDedupeKey: "runtime-control:maintenance:legacy-sequence-less",
          mailboxLaneSeq: "1",
          wakeKind: "runtime.maintenance-requested",
        }),
        mailboxLaneSeq: null,
      };
      await updateHostedSystemMailboxState(vaultRoot, () => ({
        pending: [legacyMaintenanceItem],
      }));

      await expect(resolveHostedSystemMailboxWakeCandidates({
        now: () => dueAt,
        vaultRoot,
      })).resolves.toEqual({
        defaultOwned: {
          at: null,
          reason: null,
        },
        next: {
          at: dueAt,
          executionClass: "model_free",
          reason: "mailbox",
        },
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("clears only pending dense raw retention successors when retention finishes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));

    try {
      await setHostedDeviceSyncMaintenanceMailboxWakeAt({
        nextWakeAt: "2026-04-08T00:00:00.000Z",
        now: () => "2026-04-07T23:59:30.000Z",
        userId: "member_123",
        vaultRoot,
      });
      const [dueItem] = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(dueItem).toBeDefined();

      const sendingItem: HostedSystemMailboxPendingItem = {
        ...dueItem!,
        attemptCount: 1,
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
        nextAttemptAt: null,
        status: "sending",
      };
      await updateHostedSystemMailboxPendingItem({
        item: sendingItem,
        vaultRoot,
      });

      await setHostedDeviceSyncMaintenanceMailboxWakeAt({
        nextWakeAt: null,
        now: () => "2026-04-08T00:00:00.000Z",
        userId: "member_123",
        vaultRoot,
      });

      let denseItems = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(denseItems).toHaveLength(1);
      expect(denseItems[0]).toMatchObject({
        itemId: sendingItem.itemId,
        status: "sending",
      });

      const recordingRetry: HostedSystemMailboxPendingItem = {
        ...sendingItem,
        lastErrorCode: "device_sync_ack_failed",
        lastErrorMessage: "ack failed",
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        postCheckpointRecord: {
          connectionId: "conn_123",
          kind: "device-sync.dirty-processed",
          processedRevision: "rev_1",
        },
        status: "recording",
      };
      await updateHostedSystemMailboxPendingItem({
        item: recordingRetry,
        vaultRoot,
      });

      denseItems = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(denseItems).toHaveLength(1);
      expect(denseItems[0]).toMatchObject({
        itemId: recordingRetry.itemId,
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        status: "recording",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("coalesces pending dense raw retention successors without touching in-flight items", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));

    try {
      await setHostedDeviceSyncMaintenanceMailboxWakeAt({
        nextWakeAt: "2026-04-08T00:00:30.000Z",
        now: () => "2026-04-08T00:00:00.000Z",
        userId: "member_123",
        vaultRoot,
      });
      const [firstSuccessor] = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(firstSuccessor).toBeDefined();

      await setHostedDeviceSyncMaintenanceMailboxWakeAt({
        nextWakeAt: "2026-04-08T00:01:00.000Z",
        now: () => "2026-04-08T00:00:30.000Z",
        userId: "member_123",
        vaultRoot,
      });

      const denseItems = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(denseItems).toHaveLength(1);
      expect(denseItems[0].itemId).not.toBe(firstSuccessor!.itemId);
      expect(denseItems[0]).toMatchObject({
        nextAttemptAt: "2026-04-08T00:01:00.000Z",
        status: "pending",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });
});

function buildPendingSystemMailboxItem(input: {
  itemId: string;
  mailboxLaneSeq: string | null;
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: `member.preferences.updated:${input.itemId}`,
    mailboxLaneSeq: input.mailboxLaneSeq,
    nextAttemptAt: null,
    occurredAt: "2026-04-27T00:00:00.000Z",
    postCheckpointRecord: null,
    preferenceCausalSeq: input.mailboxLaneSeq,
    requestId: null,
    routeAction: "apply-member-preferences",
    status: "pending",
    wake: {
      eventId: `member.preferences.updated:${input.itemId}`,
      kind: "member.preferences.updated",
      occurredAt: "2026-04-27T00:00:00.000Z",
      preferences: {
        tone: "formal",
      },
      userId: "member_123",
    },
  };
}

function buildPendingRuntimeControlMailboxItem(input: {
  itemId: string;
  mailboxDedupeKey: string;
  mailboxLaneSeq: string;
  nextAttemptAt?: string | null;
  postCheckpointRecord?: HostedSystemMailboxPendingItem["postCheckpointRecord"];
  wakeKind:
    | "runtime.browser-vault-refresh-requested"
    | "runtime.codex-auth-requested"
    | "runtime.maintenance-requested";
}): HostedSystemMailboxPendingItem {
  const wake = input.wakeKind === "runtime.codex-auth-requested"
    ? {
        action: "disconnect" as const,
        attemptId: "hca_abcdefghijklmnop",
        eventId: input.mailboxDedupeKey,
        kind: input.wakeKind,
        occurredAt: "2026-04-27T00:00:00.000Z",
        userId: "member_123",
      }
    : {
        eventId: input.mailboxDedupeKey,
        kind: input.wakeKind,
        occurredAt: "2026-04-27T00:00:00.000Z",
        userId: "member_123",
      };
  return {
    attemptCount: 1,
    itemId: input.itemId,
    lastAttemptAt: "2026-04-27T00:00:00.000Z",
    lastErrorCode: input.nextAttemptAt ? "projection_failed" : null,
    lastErrorMessage: input.nextAttemptAt ? "redacted" : null,
    mailboxDedupeKey: input.mailboxDedupeKey,
    mailboxLaneSeq: input.mailboxLaneSeq,
    nextAttemptAt: input.nextAttemptAt ?? null,
    occurredAt: "2026-04-27T00:00:00.000Z",
    postCheckpointRecord: input.postCheckpointRecord ?? null,
    preferenceCausalSeq: null,
    requestId: null,
    routeAction: "apply-runtime-control-request",
    status: input.postCheckpointRecord ? "recording" : "pending",
    wake,
  };
}

function buildPendingApprovalContinuationMailboxItem(input: {
  effectId: string;
  itemId: string;
  mailboxLaneSeq: string;
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: `runtime-control:pending-effects:${input.effectId}`,
    mailboxLaneSeq: input.mailboxLaneSeq,
    nextAttemptAt: null,
    occurredAt: "2026-04-27T00:00:00.000Z",
    postCheckpointRecord: null,
    preferenceCausalSeq: null,
    requestId: null,
    routeAction: "apply-runtime-control-request",
    status: "pending",
    wake: {
      effectId: input.effectId,
      eventId: `runtime-control:pending-effects:${input.effectId}`,
      kind: "runtime.pending-effects-reconcile-requested",
      occurredAt: "2026-04-27T00:00:00.000Z",
      userId: "member_123",
    },
  };
}

function buildPendingDeviceSyncMailboxItem(input: {
  itemId: string;
  mailboxLaneSeq: string;
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: `device-sync.wake:${input.itemId}`,
    mailboxLaneSeq: input.mailboxLaneSeq,
    nextAttemptAt: null,
    occurredAt: "2026-04-27T00:00:00.000Z",
    postCheckpointRecord: null,
    preferenceCausalSeq: null,
    requestId: null,
    routeAction: "run-device-sync-wake",
    status: "pending",
    wake: {
      eventId: `device-sync.wake:${input.itemId}`,
      kind: "device-sync.wake",
      occurredAt: "2026-04-27T00:00:00.000Z",
      reason: "reconcile_due",
      userId: "member_123",
    },
  };
}

function buildRetainedDeviceSyncMailboxItem(input: {
  connectionId?: string;
  itemId: string;
  mailboxLaneSeq: string;
  retryAt: string;
}): HostedSystemMailboxPendingItem {
  const pending = buildPendingDeviceSyncMailboxItem(input);
  return {
    ...pending,
    attemptCount: 1,
    deviceSyncContinuationOwner: true,
    lastAttemptAt: "2026-04-27T00:00:00.000Z",
    nextAttemptAt: input.retryAt,
    wake: buildHostedExecutionDeviceSyncWake({
      connectionId: input.connectionId ?? `dsc_${input.itemId}`,
      eventId: `device-sync.wake:${input.itemId}`,
      expectedConnectedAt: "2026-04-01T00:00:00.000Z",
      hint: {
        jobs: [{
          availableAt: input.retryAt,
          dedupeKey: `retained-job:${input.itemId}`,
          kind: "resource",
          maxAttempts: 1,
          payload: {},
        }],
      },
      occurredAt: "2026-04-27T00:00:00.000Z",
      provider: "junction",
      reason: "reconcile_due",
      userId: "member_123",
    }),
  };
}

function buildPendingAssistantNotificationMailboxItem(input: {
  itemId: string;
  mailboxLaneSeq: string;
}): HostedSystemMailboxPendingItem {
  const mailboxDedupeKey =
    `assistant.notification.requested:${input.itemId}`;
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey,
    mailboxLaneSeq: input.mailboxLaneSeq,
    nextAttemptAt: null,
    occurredAt: "2026-04-27T00:00:00.000Z",
    postCheckpointRecord: null,
    preferenceCausalSeq: null,
    requestId: `request_${input.itemId}`,
    routeAction: "dispatch-assistant-notification",
    status: "pending",
    wake: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: mailboxDedupeKey,
      memberId: "member_123",
      notification: {
        instructions: "Handle one synthetic background notification.",
        route: {
          actorId: null,
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "synthetic_notification_thread",
          },
          identityId: "synthetic_notification_identity",
          threadId: "synthetic_notification_thread",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-27T00:00:00.000Z",
    }),
  };
}

function buildPendingReportedDailyMetricMailboxItem(input: {
  itemId: string;
  mailboxLaneSeq: string;
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: `health.daily-metric.reported:${input.itemId}`,
    mailboxLaneSeq: input.mailboxLaneSeq,
    nextAttemptAt: null,
    occurredAt: "2026-04-27T00:00:00.000Z",
    postCheckpointRecord: null,
    preferenceCausalSeq: null,
    requestId: null,
    routeAction: "import-reported-daily-metric",
    status: "pending",
    wake: {
      dailyMetric: {
        date: "2026-04-27",
        metric: "steps",
        unit: "count",
        value: 8_000,
      },
      eventId: `health.daily-metric.reported:${input.itemId}`,
      kind: "health.daily-metric.reported",
      occurredAt: "2026-04-27T00:00:00.000Z",
      userId: "member_123",
    },
  };
}
