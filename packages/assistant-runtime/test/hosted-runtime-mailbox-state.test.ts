import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  readHostedSystemMailboxState,
  removeHostedSystemMailboxPendingItemIfCurrent,
  resolveHostedSystemMailboxNextWakeCandidate,
  setHostedDeviceSyncDenseRawRetentionMailboxWakeAt,
  updateHostedSystemMailboxPendingItem,
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
