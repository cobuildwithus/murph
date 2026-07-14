import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionCodexAuthRequestedWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionMemberPreferencesUpdatedWake,
  buildHostedExecutionRuntimeControlWake,
} from "@murphai/hosted-execution";
import {
  VAULT_LAYOUT,
} from "@murphai/contracts";
import {
  type HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantExecutionContext,
} from "@murphai/assistant-engine";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node/assistant-state-fs";
import {
  readPreferencesDocument,
  updateAssistantPreferences,
} from "@murphai/core";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeHostedMailboxEvent: vi.fn(),
}));

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedMailboxEvent: mocks.executeHostedMailboxEvent,
}));

import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
  readHostedSystemMailboxCheckpointRollbackState,
  recordHostedDeviceSyncDirtyPostCheckpointRecord,
  recordHostedSystemMailboxItemAfterCheckpoint,
  retainHostedSystemMailboxItemAfterForegroundPreemption,
  resolveHostedSystemMailboxNextWakeAt,
  restoreHostedSystemMailboxCheckpointRollbackState,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const FIXED_NOW = "2026-04-27T00:00:00.000Z";

type HostedSystemMailboxRuntimeForTest =
  Parameters<typeof prepareHostedSystemMailboxItemForCheckpoint>[0]["runtime"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeHostedMailboxEvent.mockResolvedValue({
    bootstrapResult: null,
    conversationMetrics: null,
    mailboxLane: "assistant-notification",
    nextWakeAt: null,
    postCheckpointRecord: null,
    redactedLogEntries: [],
  });
});

describe("hosted system mailbox notification execution context", () => {
  it("bootstraps member activation before queued system maintenance", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:bootstrap-before-maintenance",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      timeZone: "America/New_York",
    });

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedActivationItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );
      await access(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata));
      expect(mocks.executeHostedMailboxEvent).not.toHaveBeenCalled();

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMailboxItemId: "mailbox_item_system_activation",
          wake: expect.objectContaining({
            kind: "member.activated",
          }),
        }),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps hosted member context on queued notification wakes", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:member-context",
      memberId: "member_123",
      notification: {
        instructions: "Send the prepared account update.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    const executionContext: AssistantExecutionContext = {
      hosted: {
        memberId: "member_123",
        userEnvKeys: [],
      },
    };

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedNotificationItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          executionContext: expect.objectContaining({
            hosted: expect.objectContaining({
              memberId: "member_123",
            }),
          }),
          forceQueueOnlyAssistantNotification: true,
          sourceMailboxItemId: "mailbox_item_system_notification",
          wake: expect.objectContaining({
            kind: "assistant.notification.requested",
          }),
        }),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("rollback discards only failed imported system items and preserves concurrent enqueues", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:rollback",
      memberId: "member_123",
      notification: {
        instructions: "Send the prepared account update.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });

    try {
      const rollbackState = await readHostedSystemMailboxCheckpointRollbackState({
        vaultRoot: workspace.vaultRoot,
      });
      const failedImportItem = createResolvedNotificationItem({
        id: "mailbox_item_failed_import",
      });
      const concurrentItem = createResolvedNotificationItem({
        id: "mailbox_item_concurrent_import",
      });
      await enqueueHostedSystemMailboxItem({
        item: failedImportItem,
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      await enqueueHostedSystemMailboxItem({
        item: concurrentItem,
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      await restoreHostedSystemMailboxCheckpointRollbackState({
        discardItemIds: [failedImportItem.item.id],
        state: rollbackState,
        vaultRoot: workspace.vaultRoot,
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMailboxItemId: concurrentItem.item.id,
        }),
      );
      const next = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(next, null);
    } finally {
      await workspace.cleanup();
    }
  });

  it("records device-sync dirty processed revisions only after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const ackDirtyStateProcessed = vi.fn(async () => ({
      connectionId: "dsc_dirty_123",
      dirtyRevision: "12",
      nextWakeAt: null,
      processedRevision: "12",
      recorded: true,
      stillDirty: false,
      userId: "member_123",
    }));
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:dirty-ack",
      memberId: "member_123",
      notification: {
        instructions: "Process the dirty ack.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: null,
      postCheckpointRecord: {
        connectionId: "dsc_dirty_123",
        kind: "device-sync.dirty-processed",
        nextWakeAt: null,
        processedDirtyPayloadIds: ["dsp_payload_1"],
        processedRevision: "12",
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_dirty_ack",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        deviceSyncPort: {
          async applyUpdates() {
            throw new Error("applyUpdates should not be called");
          },
          ackDirtyStateProcessed,
          async createConnectLink() {
            throw new Error("createConnectLink should not be called");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            throw new Error("fetchSnapshot should not be called");
          },
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(ackDirtyStateProcessed).not.toHaveBeenCalled();
      assert.ok(prepared?.item.postCheckpointRecord);

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(ackDirtyStateProcessed).toHaveBeenCalledWith({
        connectionId: "dsc_dirty_123",
        processedDirtyPayloadIds: ["dsp_payload_1"],
        processedRevision: "12",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps an immediate wake when a newer dirty revision arrives before acknowledgement", async () => {
    const immediateWakeAt = "2026-04-05T00:00:01.000Z";
    const localRetryAt = "2026-04-05T00:05:00.000Z";
    const runtime = createRuntime({
      deviceSyncPort: {
        async ackDirtyStateProcessed() {
          return {
            connectionId: "dsc_dirty_newer_revision",
            dirtyRevision: "13",
            nextWakeAt: immediateWakeAt,
            processedRevision: "12",
            recorded: true,
            stillDirty: true,
            userId: "member_123",
          };
        },
        async applyUpdates() {
          throw new Error("applyUpdates should not be called");
        },
        async createConnectLink() {
          throw new Error("createConnectLink should not be called");
        },
        async fetchDirtyStates() {
          return {
            hasMore: false,
            items: [],
            nextWakeAt: null,
            userId: "member_123",
          };
        },
        async fetchSnapshot() {
          throw new Error("fetchSnapshot should not be called");
        },
      },
    });

    await expect(recordHostedDeviceSyncDirtyPostCheckpointRecord({
      record: {
        connectionId: "dsc_dirty_newer_revision",
        kind: "device-sync.dirty-processed",
        nextWakeAt: localRetryAt,
        processedRevision: "12",
      },
      runtime,
    })).resolves.toEqual({
      nextWakeAt: immediateWakeAt,
      recorded: 1,
      stillDirty: true,
    });
  });

  it("records batched device-sync dirty processed revisions after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const ackDirtyStateProcessed = vi.fn()
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_batch_1",
        dirtyRevision: "21",
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        processedRevision: "21",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      })
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_batch_2",
        dirtyRevision: "22",
        nextWakeAt: null,
        processedRevision: "22",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      });
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:dirty-ack-batch",
      memberId: "member_123",
      notification: {
        instructions: "Process the dirty ack batch.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: null,
      postCheckpointRecord: {
        kind: "device-sync.dirty-processed-batch",
        nextWakeAt: "2026-04-05T00:07:00.000Z",
        records: [
          {
            connectionId: "dsc_dirty_batch_1",
            nextWakeAt: "2026-04-05T00:07:00.000Z",
            processedDirtyPayloadIds: ["dsp_payload_21"],
            processedRevision: "21",
          },
          {
            connectionId: "dsc_dirty_batch_2",
            nextWakeAt: null,
            processedDirtyPayloadIds: ["dsp_payload_22", "dsp_payload_23"],
            processedRevision: "22",
          },
        ],
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_dirty_ack_batch",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        deviceSyncPort: {
          async applyUpdates() {
            throw new Error("applyUpdates should not be called");
          },
          ackDirtyStateProcessed,
          async createConnectLink() {
            throw new Error("createConnectLink should not be called");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            throw new Error("fetchSnapshot should not be called");
          },
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(ackDirtyStateProcessed).not.toHaveBeenCalled();
      assert.equal(prepared?.item.postCheckpointRecord?.kind, "device-sync.dirty-processed-batch");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 2,
      });
      expect(ackDirtyStateProcessed).toHaveBeenNthCalledWith(1, {
        connectionId: "dsc_dirty_batch_1",
        processedDirtyPayloadIds: ["dsp_payload_21"],
        processedRevision: "21",
        stagedDirtyAcks: [
          {
            connectionId: "dsc_dirty_batch_2",
            processedDirtyPayloadIds: ["dsp_payload_22", "dsp_payload_23"],
            processedRevision: "22",
          },
        ],
      });
      expect(ackDirtyStateProcessed).toHaveBeenNthCalledWith(2, {
        connectionId: "dsc_dirty_batch_2",
        processedDirtyPayloadIds: ["dsp_payload_22", "dsp_payload_23"],
        processedRevision: "22",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("preserves a batched dirty ack wake when an earlier ack remains dirty", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const ackDirtyStateProcessed = vi.fn()
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_batch_still_dirty_1",
        dirtyRevision: "41",
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        processedRevision: "41",
        recorded: true,
        stillDirty: true,
        userId: "member_123",
      })
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_batch_still_dirty_2",
        dirtyRevision: "42",
        nextWakeAt: null,
        processedRevision: "42",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      });
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:dirty-ack-batch-still-dirty",
      memberId: "member_123",
      notification: {
        instructions: "Process the still-dirty ack batch.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: null,
      postCheckpointRecord: {
        kind: "device-sync.dirty-processed-batch",
        records: [
          {
            connectionId: "dsc_dirty_batch_still_dirty_1",
            processedDirtyPayloadIds: ["dsp_payload_41"],
            processedRevision: "41",
          },
          {
            connectionId: "dsc_dirty_batch_still_dirty_2",
            processedDirtyPayloadIds: ["dsp_payload_42"],
            processedRevision: "42",
          },
        ],
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_dirty_ack_batch_still_dirty",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        deviceSyncPort: {
          async applyUpdates() {
            throw new Error("applyUpdates should not be called");
          },
          ackDirtyStateProcessed,
          async createConnectLink() {
            throw new Error("createConnectLink should not be called");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            throw new Error("fetchSnapshot should not be called");
          },
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        nextWakeReason: "device-sync.reconcile",
        recorded: 2,
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("retries a partially recorded device-sync dirty ack batch idempotently", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const ackDirtyStateProcessed = vi.fn()
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_retry_1",
        dirtyRevision: "31",
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        processedRevision: "31",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      })
      .mockRejectedValueOnce(new Error("temporary ack failure"))
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_retry_1",
        dirtyRevision: "31",
        nextWakeAt: "2026-04-05T00:03:00.000Z",
        processedRevision: "31",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      })
      .mockResolvedValueOnce({
        connectionId: "dsc_dirty_retry_2",
        dirtyRevision: "32",
        nextWakeAt: null,
        processedRevision: "32",
        recorded: true,
        stillDirty: false,
        userId: "member_123",
      });
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:dirty-ack-batch-retry",
      memberId: "member_123",
      notification: {
        instructions: "Process the dirty ack batch retry.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: FIXED_NOW,
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "device-sync",
      nextWakeAt: null,
      postCheckpointRecord: {
        kind: "device-sync.dirty-processed-batch",
        records: [
          {
            connectionId: "dsc_dirty_retry_1",
            processedDirtyPayloadIds: ["dsp_payload_31"],
            processedRevision: "31",
          },
          {
            connectionId: "dsc_dirty_retry_2",
            processedDirtyPayloadIds: ["dsp_payload_32"],
            processedRevision: "32",
          },
        ],
      },
      redactedLogEntries: [],
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_dirty_ack_batch_retry",
        }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        deviceSyncPort: {
          async applyUpdates() {
            throw new Error("applyUpdates should not be called");
          },
          ackDirtyStateProcessed,
          async createConnectLink() {
            throw new Error("createConnectLink should not be called");
          },
          async fetchDirtyStates() {
            return {
              hasMore: false,
              items: [],
              nextWakeAt: null,
              userId: "member_123",
            };
          },
          async fetchSnapshot() {
            throw new Error("fetchSnapshot should not be called");
          },
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      const failedRecord = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      });
      expect(failedRecord).toMatchObject({
        failed: 1,
        recorded: 0,
      });
      expect(ackDirtyStateProcessed).toHaveBeenCalledTimes(2);

      const retryPrepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => failedRecord.nextWakeAt ?? FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retryPrepared?.status, "recording");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: retryPrepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 2,
      });
      expect(ackDirtyStateProcessed).toHaveBeenCalledTimes(4);
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
    } finally {
      await workspace.cleanup();
    }
  });

  it("imports runtime control requests as durable no-op system work", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:manual",
      kind: "runtime.manual-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedRuntimeControlItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMailboxItemId: "mailbox_item_system_runtime_control",
          wake: expect.objectContaining({
            kind: "runtime.manual-requested",
          }),
        }),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("restores prepared no-op control work after foreground preemption", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionRuntimeControlWake({
      eventId: "runtime-control:manual-preempted",
      kind: "runtime.manual-requested",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");
      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual([]);

      await retainHostedSystemMailboxItemAfterForegroundPreemption({
        item: prepared.item,
        vaultRoot: workspace.vaultRoot,
      });

      expect((await readHostedSystemMailboxState(workspace.vaultRoot)).pending)
        .toEqual([
          expect.objectContaining({
            itemId: prepared.item.itemId,
            nextAttemptAt: null,
            status: "pending",
          }),
        ]);
      await expect(prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      })).resolves.toMatchObject({
        itemId: prepared.item.itemId,
        status: "processed",
      });
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(2);
    } finally {
      await workspace.cleanup();
    }
  });

  it("records connected Codex auth updates after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const updateCodexAuth = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      redactedLogEntries: [],
    });

    try {
      assert.deepEqual(
        await enqueueHostedSystemMailboxItem({
          item: createResolvedCodexAuthRuntimeControlItem(),
          vaultRoot: workspace.vaultRoot,
          wake,
        }),
        {
          reasonCode: "system_mailbox.queued",
          status: "imported",
        },
      );

      const runtime = createRuntime({
        codexAuthPort: {
          update: updateCodexAuth,
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      assert.equal(prepared.item.postCheckpointRecord?.kind, "codex-auth.updated");
      expect(updateCodexAuth).not.toHaveBeenCalled();

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(updateCodexAuth).toHaveBeenCalledWith({
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps connected Codex auth updates after the checkpoint boundary", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const updateCodexAuth = vi.fn(async () => ({
      applied: true,
      status: "applied" as const,
    }));
    const authPath = path.join(workspace.operatorHomeRoot, ".codex-hosted", "auth.json");
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      redactedLogEntries: [],
    });

    try {
      await mkdir(path.dirname(authPath), { recursive: true });
      await writeFile(authPath, "{\"auth_mode\":\"chatgpt\"}\n");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedCodexAuthRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        codexAuthPort: {
          update: updateCodexAuth,
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        runtimeEnv: {
          NODE_ENV: "test",
        },
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(updateCodexAuth).toHaveBeenCalledWith({
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      });
      await expect(access(authPath)).resolves.toBeUndefined();
    } finally {
      await workspace.cleanup();
    }
  });

  it("removes connected Codex auth when the checkpoint update is superseded", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const updateCodexAuth = vi.fn(async () => ({
      applied: false,
      status: "superseded" as const,
    }));
    const authPath = path.join(workspace.operatorHomeRoot, ".codex-hosted", "auth.json");
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      redactedLogEntries: [],
    });

    try {
      await mkdir(path.dirname(authPath), { recursive: true });
      await writeFile(authPath, "{\"auth_mode\":\"chatgpt\"}\n");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedCodexAuthRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        codexAuthPort: {
          update: updateCodexAuth,
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        runtimeEnv: {
          NODE_ENV: "test",
        },
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 0,
      });
      expect(updateCodexAuth).toHaveBeenCalledWith({
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      });
      await expect(access(authPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps connected Codex auth when the checkpoint update was already applied", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const updateCodexAuth = vi.fn(async () => ({
      applied: true,
      status: "already_applied" as const,
    }));
    const authPath = path.join(workspace.operatorHomeRoot, ".codex-hosted", "auth.json");
    const wake = buildHostedExecutionCodexAuthRequestedWake({
      action: "connect",
      attemptId: "hca_abcdefghijklmnop",
      eventId: "runtime-control:codex-auth",
      occurredAt: FIXED_NOW,
      userId: "member_123",
    });
    mocks.executeHostedMailboxEvent.mockResolvedValueOnce({
      bootstrapResult: null,
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      nextWakeAt: null,
      postCheckpointRecord: {
        attemptId: "hca_abcdefghijklmnop",
        kind: "codex-auth.updated",
        phase: "connected",
      },
      redactedLogEntries: [],
    });

    try {
      await mkdir(path.dirname(authPath), { recursive: true });
      await writeFile(authPath, "{\"auth_mode\":\"chatgpt\"}\n");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedCodexAuthRuntimeControlItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const runtime = createRuntime({
        codexAuthPort: {
          update: updateCodexAuth,
        },
      });
      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(prepared?.status, "processed");

      await expect(recordHostedSystemMailboxItemAfterCheckpoint({
        item: prepared.item,
        operatorHomeRoot: workspace.operatorHomeRoot,
        runtime,
        vaultRoot: workspace.vaultRoot,
      })).resolves.toEqual({
        failed: 0,
        nextWakeAt: null,
        recorded: 1,
      });
      expect(updateCodexAuth).toHaveBeenCalledWith({
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      });
      await expect(access(authPath)).resolves.toBeUndefined();
    } finally {
      await workspace.cleanup();
    }
  });

  it("forwards foreground-yield hooks to queued device-sync wakes", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const shouldYieldBackgroundMaintenance = vi.fn(() => true);
    const wake = buildHostedExecutionDeviceSyncWake({
      eventId: "device-sync.wake:yield",
      occurredAt: FIXED_NOW,
      reason: "webhook_hint",
      userId: "member_123",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem(),
        vaultRoot: workspace.vaultRoot,
        wake,
      });

      const prepared = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        shouldYieldBackgroundMaintenance,
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(prepared?.status, "processed");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldYieldDeviceSync: shouldYieldBackgroundMaintenance,
          sourceMailboxItemId: "mailbox_item_system_device_sync",
          wake: expect.objectContaining({
            kind: "device-sync.wake",
          }),
        }),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps general system maintenance from blocking unrelated due work behind a backed-off route", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const deviceSyncWake = buildHostedExecutionDeviceSyncWake({
      eventId: "device-sync.wake:backoff",
      occurredAt: FIXED_NOW,
      reason: "webhook_hint",
      userId: "member_123",
    });
    const notificationWake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:after-device-sync-backoff",
      memberId: "member_123",
      notification: {
        instructions: "Send the prepared account update.",
        route: {
          actorId: "+15550001111",
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_thread_123",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: "linq_thread_123",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-27T00:00:01.000Z",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncItem({
          id: "mailbox_item_system_device_sync_backoff",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: deviceSyncWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedNotificationItem({
          id: "mailbox_item_system_notification_after_backoff",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: notificationWake,
      });

      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient device sync failure"), {
          code: "HOSTED_DEVICE_SYNC_TRANSIENT",
        }),
      );
      const first = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(first?.status, "retryable_failed");
      assert.equal(first.itemId, "mailbox_item_system_device_sync_backoff");

      const second = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(second?.status, "processed");
      assert.equal(second.itemId, "mailbox_item_system_notification_after_backoff");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.sourceMailboxItemId
      )).toEqual([
        "mailbox_item_system_device_sync_backoff",
        "mailbox_item_system_notification_after_backoff",
      ]);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        "2026-04-27T00:01:00.000Z",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("blocks newer member-channel snapshots behind the oldest matching queued item", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: "member.channels.updated:older-enable",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: true,
      },
      occurredAt: FIXED_NOW,
    });
    const newerWake = buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: "member.channels.updated:newer-disable",
      memberId: "member_123",
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      occurredAt: "2026-04-27T00:00:01.000Z",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberChannelsItem({
          id: "mailbox_item_system_member_channels_001",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberChannelsItem({
          id: "mailbox_item_system_member_channels_002",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: newerWake,
      });

      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient member channel failure"), {
          code: "HOSTED_MEMBER_CHANNELS_TRANSIENT",
        }),
      );
      const first = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(first?.status, "retryable_failed");
      assert.equal(first.itemId, "mailbox_item_system_member_channels_001");
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          wake: expect.objectContaining({
            eventId: "member.channels.updated:older-enable",
          }),
        }),
      );

      const blocked = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(blocked, null);
      assert.equal(mocks.executeHostedMailboxEvent.mock.calls.length, 1);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          allowedRouteActions: ["apply-member-channels-update"],
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        "2026-04-27T00:01:00.000Z",
      );

      const retry = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retry?.status, "processed");
      assert.equal(retry.itemId, "mailbox_item_system_member_channels_001");

      const next = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(next?.status, "processed");
      assert.equal(next.itemId, "mailbox_item_system_member_channels_002");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.channels.updated:older-enable",
        "member.channels.updated:older-enable",
        "member.channels.updated:newer-disable",
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it.each([
    {
      assistantNotificationRoute: {
        actorId: null,
        channel: "telegram" as const,
        delivery: {
          kind: "thread" as const,
          target: "789:bot:123456",
        },
        identityId: null,
        threadId: "hid_telegram_thread_789",
        threadIsDirect: true,
      },
      scenario: "route replacement",
    },
    {
      assistantNotificationRoute: null,
      scenario: "explicit revocation",
    },
  ])("keeps $scenario behind an earlier pending member activation", async ({
    assistantNotificationRoute,
  }) => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const activationWake = buildHostedExecutionMemberActivatedWake({
      eventId: "member.activated:before-channel-update",
      memberChannels: {
        email: false,
        linq: false,
        telegram: true,
      },
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      signupWelcome: {
        route: {
          actorId: null,
          channel: "telegram",
          delivery: {
            kind: "thread",
            target: "789:bot:123456:business:former-route",
          },
          identityId: null,
          threadId: "hid_telegram_thread_789",
          threadIsDirect: true,
        },
        text: "Welcome to Murph.",
      },
    });
    const channelUpdateWake = buildHostedExecutionMemberChannelsUpdatedWake({
      assistantNotificationRoute,
      eventId: `member.channels.updated:${assistantNotificationRoute ? "replacement" : "revocation"}`,
      memberChannels: {
        email: false,
        linq: false,
        telegram: assistantNotificationRoute !== null,
      },
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });

    try {
      await enqueueHostedSystemMailboxItem({
        item: createResolvedActivationItem(),
        vaultRoot: workspace.vaultRoot,
        wake: activationWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberChannelsItem({
          id: "mailbox_item_system_member_channels_after_activation",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: channelUpdateWake,
      });

      const filteredBeforeActivation = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-channels-update"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(filteredBeforeActivation, null);
      assert.deepEqual(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending.map((item) => ({
          itemId: item.itemId,
          status: item.status,
        })),
        [
          { itemId: "mailbox_item_system_activation", status: "pending" },
          {
            itemId: "mailbox_item_system_member_channels_after_activation",
            status: "pending",
          },
        ],
      );
      expect(mocks.executeHostedMailboxEvent).not.toHaveBeenCalled();

      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient activation failure"), {
          code: "HOSTED_MEMBER_ACTIVATION_TRANSIENT",
        }),
      );
      const failedActivation = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(failedActivation?.status, "retryable_failed");
      assert.equal(failedActivation.itemId, "mailbox_item_system_activation");
      const stateDuringActivationBackoff =
        await readHostedSystemMailboxState(workspace.vaultRoot);
      const activationRetryAt = stateDuringActivationBackoff.pending.find(
        (item) => item.itemId === "mailbox_item_system_activation",
      )?.nextAttemptAt;
      assert.ok(activationRetryAt);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          allowedRouteActions: ["apply-member-channels-update"],
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        activationRetryAt,
      );
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        activationRetryAt,
      );

      const blockedDuringActivationBackoff =
        await prepareHostedSystemMailboxItemForCheckpoint({
          executionContext: null,
          now: () => FIXED_NOW,
          runtime: createRuntime({}),
          runtimeEnv: {},
          vaultRoot: workspace.vaultRoot,
        });
      assert.equal(blockedDuringActivationBackoff, null);

      const activation = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(activation?.status, "processed");
      assert.equal(activation.itemId, "mailbox_item_system_activation");

      const channelUpdate = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(channelUpdate?.status, "processed");
      assert.equal(
        channelUpdate.itemId,
        "mailbox_item_system_member_channels_after_activation",
      );
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) => ({
        kind: call[0]?.wake?.kind,
        route: call[0]?.wake?.kind === "member.channels.updated"
          ? call[0].wake.assistantNotificationRoute
          : undefined,
      }))).toEqual([
        { kind: "member.activated", route: undefined },
        { kind: "member.activated", route: undefined },
        { kind: "member.channels.updated", route: assistantNotificationRoute },
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("applies sparse member preference deltas in mailbox order", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:older",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferences: {
        personality: {
          humor: 8,
        },
      },
    });
    const newerWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:newer",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:01.000Z",
      preferences: {
        personality: {
          detail: 7,
        },
      },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata), "{}", "utf8");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_001",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_002",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: newerWake,
      });

      const first = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(first?.status, "processed");
      assert.equal(first.itemId, "mailbox_item_system_member_preferences_001");
      assert.equal(first.item.mailboxLaneSeq, "1");

      const second = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(second?.status, "processed");
      assert.equal(second.itemId, "mailbox_item_system_member_preferences_002");
      assert.equal(second.item.mailboxLaneSeq, "2");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.preferences.updated:older",
        "member.preferences.updated:newer",
      ]);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          allowedRouteActions: ["apply-member-preferences"],
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        null,
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("preserves mailbox order when rollback restores multiple preference deltas", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const lowerSeqNewerTimestampWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:lower-seq-newer-timestamp",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:05.000Z",
      preferences: {
        personality: {
          humor: 9,
        },
      },
    });
    const higherSeqOlderTimestampWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:higher-seq-older-timestamp",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:01.000Z",
      preferences: {
        personality: {
          push: 8,
        },
      },
    });

    try {
      await restoreHostedSystemMailboxCheckpointRollbackState({
        state: {
          pending: [
            createPendingMemberPreferencesItem({
              itemId: "mailbox_item_system_member_preferences_lower_seq",
              laneSeq: "41",
              occurredAt: "2026-04-27T00:00:05.000Z",
              wake: lowerSeqNewerTimestampWake,
            }),
            createPendingMemberPreferencesItem({
              itemId: "mailbox_item_system_member_preferences_higher_seq",
              laneSeq: "42",
              occurredAt: "2026-04-27T00:00:01.000Z",
              wake: higherSeqOlderTimestampWake,
            }),
          ],
        },
        vaultRoot: workspace.vaultRoot,
      });

      const first = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(first?.status, "processed");
      assert.equal(first.itemId, "mailbox_item_system_member_preferences_lower_seq");
      assert.equal(first.item.mailboxLaneSeq, "41");

      const second = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(second?.status, "processed");
      assert.equal(second.itemId, "mailbox_item_system_member_preferences_higher_seq");
      assert.equal(second.item.mailboxLaneSeq, "42");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.preferences.updated:lower-seq-newer-timestamp",
        "member.preferences.updated:higher-seq-older-timestamp",
      ]);
      assert.deepEqual(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending,
        [],
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("retries an older preference delta before applying a newer delta", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:older-retry",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferences: {
        personality: {
          humor: 8,
        },
      },
    });
    const newerWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:newer-due",
      memberId: "member_123",
      occurredAt: "2026-04-27T00:00:01.000Z",
      preferences: {
        personality: {
          detail: 7,
        },
      },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata), "{}", "utf8");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_retry_001",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });

      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient preference failure"), {
          code: "HOSTED_MEMBER_PREFERENCES_TRANSIENT",
        }),
      );
      const failed = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(failed?.status, "retryable_failed");

      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_retry_002",
          laneSeq: "2",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: newerWake,
      });

      const blocked = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(blocked, null);
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.preferences.updated:older-retry",
      ]);
      assert.equal(
        await resolveHostedSystemMailboxNextWakeAt({
          allowedRouteActions: ["apply-member-preferences"],
          now: () => FIXED_NOW,
          vaultRoot: workspace.vaultRoot,
        }),
        "2026-04-27T00:01:00.000Z",
      );

      const retried = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(retried?.status, "processed");
      assert.equal(retried.itemId, "mailbox_item_system_member_preferences_retry_001");

      const newer = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(newer?.status, "processed");
      assert.equal(newer.itemId, "mailbox_item_system_member_preferences_retry_002");
      expect(mocks.executeHostedMailboxEvent.mock.calls.map((call) =>
        call[0]?.wake?.eventId
      )).toEqual([
        "member.preferences.updated:older-retry",
        "member.preferences.updated:older-retry",
        "member.preferences.updated:newer-due",
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("replays a canonical preference commit after a mailbox crash without regressing siblings", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const olderWake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:older-cross-lane-retry",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferences: {
        personality: {
          detail: 7,
          humor: 2,
        },
      },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata), "{}", "utf8");
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({
          id: "mailbox_item_system_member_preferences_cross_lane",
          laneSeq: "1",
        }),
        vaultRoot: workspace.vaultRoot,
        wake: olderWake,
      });
      mocks.executeHostedMailboxEvent.mockRejectedValueOnce(
        Object.assign(new Error("transient preference failure"), {
          code: "HOSTED_MEMBER_PREFERENCES_TRANSIENT",
        }),
      );

      const failed = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(failed?.status, "retryable_failed");

      await updateAssistantPreferences({
        causalSeq: "2",
        preferences: {
          personality: {
            humor: 9,
          },
        },
        updatedAt: "2026-04-27T00:00:30.000Z",
        vaultRoot: workspace.vaultRoot,
      });

      mocks.executeHostedMailboxEvent.mockImplementationOnce(async (input) => {
        const { applyHostedMemberPreferences } = await import(
          "../src/hosted-runtime/context.ts"
        );
        await applyHostedMemberPreferences(
          input.vaultRoot,
          olderWake,
          input.preferenceCausalSeq ?? "0",
          input.preferenceAppliedAt,
        );
        throw Object.assign(new Error("crash after canonical preference commit"), {
          code: "HOSTED_MEMBER_PREFERENCES_POST_COMMIT_CRASH",
        });
      });

      const crashed = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => "2026-04-27T00:01:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(crashed?.status, "retryable_failed");
      const afterCrash = await readPreferencesDocument(workspace.vaultRoot);
      assert.deepEqual(afterCrash.assistant?.personality, {
        detail: 7,
        humor: 9,
      });
      assert.equal(afterCrash.updatedAt, "2026-04-27T00:01:00.000Z");
      assert.equal(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending.length,
        1,
      );

      mocks.executeHostedMailboxEvent.mockImplementationOnce(async (input) => {
        const { applyHostedMemberPreferences } = await import(
          "../src/hosted-runtime/context.ts"
        );
        await applyHostedMemberPreferences(
          input.vaultRoot,
          olderWake,
          input.preferenceCausalSeq ?? "0",
          input.preferenceAppliedAt,
        );
        return {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-preferences-updated",
          nextWakeAt: null,
          postCheckpointRecord: null,
          redactedLogEntries: [],
        };
      });

      const retried = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => "2026-04-27T00:02:00.000Z",
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      assert.equal(retried?.status, "processed");
      const preferences = await readPreferencesDocument(workspace.vaultRoot);
      assert.deepEqual(
        preferences.assistant?.personality,
        {
          detail: 7,
          humor: 9,
        },
      );
      assert.equal(preferences.updatedAt, "2026-04-27T00:01:00.000Z");
      assert.deepEqual(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending,
        [],
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("drains a restored legacy preference item without a causal token", async () => {
    const workspace = await createHostedRuntimeWorkspace("murph-hosted-system-mailbox-");
    const wake = buildHostedExecutionMemberPreferencesUpdatedWake({
      eventId: "member.preferences.updated:legacy-v1",
      memberId: "member_123",
      occurredAt: FIXED_NOW,
      preferences: { personality: { humor: 2 } },
    });

    try {
      await mkdir(workspace.vaultRoot, { recursive: true });
      await writeFile(path.join(workspace.vaultRoot, VAULT_LAYOUT.metadata), "{}", "utf8");
      await updateAssistantPreferences({
        causalOrigin: "turn",
        causalSeq: "0",
        preferences: { personality: { humor: 9 } },
        vaultRoot: workspace.vaultRoot,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedMemberPreferencesItem({ causalSeq: null }),
        vaultRoot: workspace.vaultRoot,
        wake,
      });
      const statePath = path.join(
        resolveAssistantStatePaths(workspace.vaultRoot).assistantStateRoot,
        "hosted-system-mailbox.json",
      );
      const restoredState: {
        value: { pending: Array<Record<string, unknown>> };
      } = JSON.parse(await readFile(statePath, "utf8"));
      delete restoredState.value.pending[0]?.preferenceCausalSeq;
      await writeFile(statePath, `${JSON.stringify(restoredState, null, 2)}\n`, "utf8");
      mocks.executeHostedMailboxEvent.mockImplementationOnce(async (input) => {
        const { applyHostedMemberPreferences } = await import(
          "../src/hosted-runtime/context.ts"
        );
        await applyHostedMemberPreferences(
          input.vaultRoot,
          wake,
          input.preferenceCausalSeq ?? "0",
          input.preferenceAppliedAt,
        );
        return {
          bootstrapResult: null,
          conversationMetrics: null,
          mailboxLane: "member-preferences-updated",
          nextWakeAt: null,
          postCheckpointRecord: null,
          redactedLogEntries: [],
        };
      });

      const result = await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: ["apply-member-preferences"],
        executionContext: null,
        now: () => FIXED_NOW,
        runtime: createRuntime({}),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });
      assert.equal(result?.status, "processed");
      assert.equal(
        (await readPreferencesDocument(workspace.vaultRoot))
          .assistant?.personality?.humor,
        9,
      );
      assert.deepEqual(
        (await readHostedSystemMailboxState(workspace.vaultRoot)).pending,
        [],
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

function createResolvedNotificationItem(overrides: Partial<{
  id: string;
  laneSeq: string;
}> = {}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "assistant.notification.requested:gateway-billing",
    expiresAt: null,
    id: overrides.id ?? "mailbox_item_system_notification",
    kind: "assistant.notification.requested",
    lane: "system",
    laneSeq: overrides.laneSeq ?? "1",
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
      action: "dispatch-assistant-notification",
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

function createResolvedMemberPreferencesItem(overrides: Partial<{
  causalSeq: string | null;
  id: string;
  laneSeq: string;
}> = {}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    causalSeq: overrides.causalSeq === undefined
      ? (overrides.laneSeq ?? "1")
      : overrides.causalSeq,
    createdAt: FIXED_NOW,
    dedupeKey: "member.preferences.updated:member_123",
    expiresAt: null,
    id: overrides.id ?? "mailbox_item_system_member_preferences",
    kind: "member.preferences.updated",
    lane: "system",
    laneSeq: overrides.laneSeq ?? "1",
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
      action: "apply-member-preferences",
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

function createPendingMemberPreferencesItem(input: {
  itemId: string;
  laneSeq: string;
  occurredAt: string;
  wake: HostedSystemMailboxPendingItem["wake"];
}): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: input.itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: "member.preferences.updated:member_123",
    mailboxLaneSeq: input.laneSeq,
    nextAttemptAt: null,
    occurredAt: input.occurredAt,
    postCheckpointRecord: null,
    requestId: null,
    routeAction: "apply-member-preferences",
    status: "pending",
    wake: input.wake,
  };
}

function createResolvedActivationItem(): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "member.activated:bootstrap-before-maintenance",
    expiresAt: null,
    id: "mailbox_item_system_activation",
    kind: "member.activated",
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
      action: "apply-member-activation",
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

function createResolvedMemberChannelsItem(input: {
  id: string;
  laneSeq: string;
}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: `member.channels.updated:${input.laneSeq}`,
    expiresAt: null,
    id: input.id,
    kind: "member.channels.updated",
    lane: "system",
    laneSeq: input.laneSeq,
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
      action: "apply-member-channels-update",
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

function createResolvedRuntimeControlItem(): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "runtime-control:manual",
    expiresAt: null,
    id: "mailbox_item_system_runtime_control",
    kind: "runtime.manual-requested",
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
      action: "apply-runtime-control-request",
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

function createResolvedCodexAuthRuntimeControlItem(): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "runtime-control:codex-auth",
    expiresAt: null,
    id: "mailbox_item_system_codex_auth",
    kind: "runtime.codex-auth-requested",
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
      action: "apply-runtime-control-request",
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

function createResolvedDeviceSyncItem(overrides: Partial<{
  id: string;
  laneSeq: string;
}> = {}): HostedMailboxResolvedImportItem {
  const item: HostedMailboxItem = {
    createdAt: FIXED_NOW,
    dedupeKey: "device-sync.wake:yield",
    expiresAt: null,
    id: overrides.id ?? "mailbox_item_system_device_sync",
    kind: "device-sync.wake",
    lane: "system",
    laneSeq: overrides.laneSeq ?? "1",
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
      action: "run-device-sync-wake",
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
