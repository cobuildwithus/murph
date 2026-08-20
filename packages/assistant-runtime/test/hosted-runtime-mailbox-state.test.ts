import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findNextHostedSystemMailboxQueueItem,
  readHostedSystemMailboxState,
  removeHostedSystemMailboxPendingItemIfCurrent,
  resolveHostedSystemMailboxHandledThroughSeq,
  resolveHostedSystemMailboxNextWakeCandidate,
  setHostedDeviceSyncDenseRawRetentionMailboxWakeAt,
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

    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));
    try {
      await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
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
        reason: "assistant",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("uses the ready approved continuation as the default item and wake authority", async () => {
    const deviceWake = buildPendingDeviceSyncMailboxItem({
      itemId: "pending_device_sync",
      mailboxLaneSeq: "1",
    });
    const approvedContinuation = buildPendingApprovalContinuationMailboxItem({
      effectId: "effect_approved_export",
      itemId: "pending_approved_continuation",
      mailboxLaneSeq: "2",
    });
    const state = {
      pending: [deviceWake, approvedContinuation],
    };

    expect(findNextHostedSystemMailboxQueueItem({
      allowedRouteActions: null,
      now: "2026-04-27T00:00:00.000Z",
      state,
    })).toEqual(approvedContinuation);
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
        reason: "assistant",
      });
      await expect(resolveHostedSystemMailboxNextWakeCandidate({
        allowedRouteActions: ["run-device-sync-wake"],
        now: () => "2026-04-27T00:00:00.000Z",
        vaultRoot,
      })).resolves.toEqual({
        at: "2026-04-27T00:00:00.000Z",
        reason: "device-sync.reconcile",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps a distinct dense raw retention successor after dirty receipt recording", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));

    try {
      await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
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

      await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
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
        reason: "device-sync.reconcile",
      });
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  it("clears only pending dense raw retention successors when retention finishes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-system-mailbox-state-"));

    try {
      await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
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

      await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
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
      await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
        nextWakeAt: "2026-04-08T00:00:30.000Z",
        now: () => "2026-04-08T00:00:00.000Z",
        userId: "member_123",
        vaultRoot,
      });
      const [firstSuccessor] = await readDenseRawRetentionMailboxItems(vaultRoot);
      expect(firstSuccessor).toBeDefined();

      await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
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
