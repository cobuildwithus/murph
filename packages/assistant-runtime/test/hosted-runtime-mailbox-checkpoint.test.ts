import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, test } from "vitest";

import type {
  HostedMailboxFetchRequest,
  HostedMailboxFetchResponse,
  HostedMailboxItem,
  HostedMailboxPayloadFetchRequest,
  HostedMailboxPayloadFetchResponse,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedWorkspaceCheckpointRequest,
} from "@murphai/hosted-execution/parsers";

import {
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
} from "../src/hosted-runtime/mailbox-checkpoint.ts";
import {
  createEmptyHostedMailboxImportState,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import type {
  HostedMailboxPostCheckpointEffectResult,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimeWorkspacePort,
} from "../src/hosted-runtime-contracts.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_checkpoint";

function createInboxProjectionEffectResult(): HostedMailboxPostCheckpointEffectResult {
  return {
    attachmentEvidenceUpdated: null,
    kind: "inbox_projection",
    projectionUpdated: true,
    reasonCode: null,
    status: "succeeded",
  };
}

describe("hosted mailbox import checkpoint wrapper", () => {
  test("writes changed mailbox import state before checkpointing the workspace", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const item = createMailboxItem({
      id: "mailbox_item_conversation_001",
      laneSeq: "1",
    });
    const { fetchRequests, mailboxPort } = createMailboxPort({
      items: [item],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const observedStateAtCheckpoint: string[] = [];
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        checkpointRequests.push(request);
        const durableState = await readHostedMailboxImportState({ vaultRoot });
        observedStateAtCheckpoint.push(durableState.watermarks.conversation);
        return createCheckpointResponse(request);
      },
    };

    try {
      const result = await importHostedMailboxPrefixAndCheckpoint({
        expectedUserId: TEST_USER_ID,
        async createCheckpointRequest(input) {
          assert.deepEqual(input.redactedStatus, {
            hostedMailboxBlockedCount: 0,
            hostedMailboxConversationImportedSeq: "1",
            hostedMailboxFetchedCount: 1,
            hostedMailboxImportedCount: 1,
            hostedMailboxRetryableBlockedCount: 0,
            hostedMailboxSystemImportedSeq: "0",
          });
          Object.assign(input.redactedStatus, {
            hostedMailboxImportedCount: 999,
            unsafeNote: "ciphertext_inline_synthetic_checkpoint",
          });
          assert.equal(input.previousState.watermarks.conversation, "0");
          assert.equal(input.state.watermarks.conversation, "1");

          return {
            attemptId: "attempt_synthetic_checkpoint_001",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "1",
            nextWakeAt: null,
            nextWakeReason: null,
            reason: "import",
            redactedStatus: {
              hostedMailboxImportedCount: 999,
              unsafeNote: "ciphertext_inline_synthetic_checkpoint",
            },
            snapshotRef: null,
          };
        },
        async importItem(input) {
          assert.equal(input.item.id, "mailbox_item_conversation_001");
          assert.equal(input.route.action, "import-conversation-message");
          assert.equal(input.payload.source, "inline");
          return { status: "imported" };
        },
        limitPerLane: 10,
        mailboxPort,
        now: () => TEST_NOW,
        requestId: "request_synthetic_checkpoint_001",
        vaultRoot,
        workspacePort,
      });

      assert.equal(result.stateChanged, true);
      assert.equal(result.importResult.importedCount, 1);
      assert.equal(result.checkpoint?.checkpointed, true);
      assert.equal(result.checkpointDeferred, false);
      assert.deepEqual(observedStateAtCheckpoint, ["1"]);
      assert.deepEqual(fetchRequests, [
        {
          cursorMode: "imported_seq",
          lanes: [
            { importedSeq: "0", lane: "system" },
            { importedSeq: "0", lane: "conversation" },
          ],
          limitPerLane: 10,
          requestId: "request_synthetic_checkpoint_001",
        },
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.doesNotThrow(() =>
        parseHostedWorkspaceCheckpointRequest(checkpointRequests[0]),
      );
      assert.equal(checkpointRequests[0]?.reason, "import");
      assert.deepEqual(checkpointRequests[0]?.redactedStatus, {
        hostedMailboxBlockedCount: 0,
        hostedMailboxConversationImportedSeq: "1",
        hostedMailboxFetchedCount: 1,
        hostedMailboxImportedCount: 1,
        hostedMailboxRetryableBlockedCount: 0,
        hostedMailboxSystemImportedSeq: "0",
      });
      assert.equal(
        JSON.stringify(checkpointRequests).includes("ciphertext_inline_synthetic_checkpoint"),
        false,
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("returns imported item post-checkpoint effects only after durable checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const item = createMailboxItem({
      id: "mailbox_item_conversation_001",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });
    const order: string[] = [];
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        order.push("checkpoint");
        return createCheckpointResponse(request);
      },
    };

    try {
      const result = await importHostedMailboxPrefixAndCheckpoint({
        expectedUserId: TEST_USER_ID,
        createCheckpointRequest() {
          return {
            attemptId: "attempt_synthetic_checkpoint_effect",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "1",
            nextWakeAt: null,
            nextWakeReason: null,
            reason: "import",
            redactedStatus: {},
            snapshotRef: null,
          };
        },
        async importItem() {
          order.push("import");
          return {
            afterCheckpoint: async () => {
              order.push("afterCheckpoint");
              return createInboxProjectionEffectResult();
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        mailboxPort,
        now: () => TEST_NOW,
        requestId: "request_synthetic_checkpoint_effect",
        vaultRoot,
        workspacePort,
      });

      assert.equal(result.stateChanged, true);
      assert.equal(result.checkpointDeferred, false);
      assert.deepEqual(order, ["import", "checkpoint"]);
      assert.equal(result.afterCheckpointEffects.length, 1);
      const effectResult = await result.afterCheckpointEffects[0]?.();
      assert.deepEqual(effectResult, createInboxProjectionEffectResult());
      assert.deepEqual(order, ["import", "checkpoint", "afterCheckpoint"]);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not run post-checkpoint effects inside the mailbox checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const item = createMailboxItem({
      id: "mailbox_item_conversation_001",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });
    let effectRan = false;
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        return createCheckpointResponse(request);
      },
    };

    try {
      const result = await importHostedMailboxPrefixAndCheckpoint({
        expectedUserId: TEST_USER_ID,
        createCheckpointRequest() {
          return {
            attemptId: "attempt_synthetic_checkpoint_effect_failure",
            expectedWorkspaceVersion: "0",
            leaseGeneration: "1",
            nextWakeAt: null,
            nextWakeReason: null,
            reason: "import",
            redactedStatus: {},
            snapshotRef: null,
          };
        },
        async importItem() {
          return {
            afterCheckpoint: async () => {
              effectRan = true;
              return createInboxProjectionEffectResult();
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        mailboxPort,
        now: () => TEST_NOW,
        requestId: "request_synthetic_checkpoint_effect_failure",
        vaultRoot,
        workspacePort,
      });

      assert.equal(result.stateChanged, true);
      assert.equal(result.checkpointDeferred, false);
      assert.equal(effectRan, false);
      assert.equal(result.afterCheckpointEffects.length, 1);
      assert.equal(result.state.watermarks.conversation, "1");
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "1",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("can defer an imported mailbox checkpoint while preserving local state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const item = createMailboxItem({
      id: "mailbox_item_conversation_deferred",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const order: string[] = [];
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        checkpointRequests.push(request);
        return createCheckpointResponse(request);
      },
    };

    try {
      const result = await importHostedMailboxPrefixAndCheckpoint({
        deferCheckpoint: true,
        expectedUserId: TEST_USER_ID,
        createCheckpointRequest() {
          throw new Error("Deferred imports should not create a checkpoint request.");
        },
        async importItem() {
          order.push("import");
          return {
            afterCheckpoint: async () => {
              order.push("afterCheckpoint");
              return createInboxProjectionEffectResult();
            },
            status: "imported",
          };
        },
        limitPerLane: 10,
        mailboxPort,
        now: () => TEST_NOW,
        requestId: "request_synthetic_checkpoint_deferred",
        vaultRoot,
        workspacePort,
      });

      assert.equal(result.stateChanged, true);
      assert.equal(result.checkpoint, null);
      assert.equal(result.checkpointDeferred, true);
      assert.equal(result.importResult.importedCount, 1);
      assert.equal(result.afterCheckpointEffects.length, 1);
      assert.deepEqual(order, ["import"]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "1",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("does not write or checkpoint when the fetched prefix leaves state unchanged", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const initialState = createEmptyHostedMailboxImportState();
    const { mailboxPort } = createMailboxPort({
      items: [],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        checkpointRequests.push(request);
        return createCheckpointResponse(request);
      },
    };

    try {
      await writeHostedMailboxImportState({
        state: initialState,
        vaultRoot,
      });

      const result = await importHostedMailboxPrefixAndCheckpoint({
        expectedUserId: TEST_USER_ID,
        createCheckpointRequest() {
          throw new Error("Checkpoint request should not be created without state changes.");
        },
        async importItem() {
          throw new Error("Import should not run when no mailbox items are fetched.");
        },
        limitPerLane: 10,
        mailboxPort,
        now: () => TEST_NOW,
        requestId: "request_synthetic_checkpoint_idle",
        vaultRoot,
        workspacePort,
      });

      assert.equal(result.stateChanged, false);
      assert.equal(result.checkpoint, null);
      assert.equal(result.checkpointDeferred, false);
      assert.deepEqual(result.previousState, initialState);
      assert.deepEqual(result.importResult.state, initialState);
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("returns retry wake for retryable mailbox payload blocks without checkpointing unchanged state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const item = createMailboxItem({
      id: "mailbox_item_conversation_sidecar",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_conversation_sidecar",
    });
    const { mailboxPort, payloadFetchRequests } = createMailboxPort({
      items: [item],
    });
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        checkpointRequests.push(request);
        throw new Error("Retry-only mailbox scheduling should not checkpoint unchanged state.");
      },
    };

    try {
      const result = await importHostedMailboxPrefixAndCheckpoint({
        expectedUserId: TEST_USER_ID,
        async createCheckpointRequest() {
          throw new Error("Retry-only mailbox scheduling should not build checkpoint requests.");
        },
        async importItem() {
          throw new Error("Import should not run while the payload is unavailable.");
        },
        limitPerLane: 10,
        mailboxPort,
        now: () => TEST_NOW,
        requestId: "request_synthetic_checkpoint_retryable",
        vaultRoot,
        workspacePort,
      });

      assert.equal(result.stateChanged, false);
      assert.equal(result.checkpoint, null);
      assert.equal(result.checkpointDeferred, false);
      assert.equal(result.importResult.nextRetryAt, "2026-04-26T00:00:15.000Z");
      assert.equal(result.importResult.blocked[0]?.retryable, true);
      assert.equal(result.state.watermarks.conversation, "0");
      assert.deepEqual(result.state.recentStatuses, []);
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "0",
      );
      assert.deepEqual(payloadFetchRequests, [
        {
          dedupeKey: "dedupe_synthetic_checkpoint",
          mailboxItemId: "mailbox_item_conversation_sidecar",
          payloadRef: "hosted-mailbox-payload:mailbox_item_conversation_sidecar",
          requestId: "request_synthetic_checkpoint_retryable:mailbox_item_conversation_sidecar:payload",
        },
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(
        JSON.stringify(checkpointRequests).includes("ciphertext_inline_synthetic_checkpoint"),
        false,
      );
      assert.equal(JSON.stringify(checkpointRequests).includes("payloadRef"), false);
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("throws when workspace checkpoint rejects changed mailbox import state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const item = createMailboxItem({
      id: "mailbox_item_conversation_conflict",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        return {
          checkpointed: false,
          workspace: {
            checkpointedAt: TEST_NOW,
            createdAt: TEST_NOW,
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: null,
            updatedAt: TEST_NOW,
            userId: TEST_USER_ID,
            version: "2",
          },
        };
      },
    };

    try {
      let caught: unknown;
      try {
        await importHostedMailboxPrefixAndCheckpoint({
          expectedUserId: TEST_USER_ID,
          createCheckpointRequest() {
            return {
              attemptId: "attempt_synthetic_checkpoint_conflict",
              expectedWorkspaceVersion: "0",
              leaseGeneration: "1",
              nextWakeAt: null,
              nextWakeReason: null,
              reason: "import",
              snapshotRef: null,
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          limitPerLane: 10,
          mailboxPort,
          now: () => TEST_NOW,
          requestId: "request_synthetic_checkpoint_conflict",
          vaultRoot,
          workspacePort,
        });
      } catch (error) {
        caught = error;
      }

      assert.ok(caught instanceof HostedMailboxImportCheckpointConflictError);
      assert.equal(caught.checkpoint.checkpointed, false);
      assert.equal(caught.checkpoint.workspace.version, "2");
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "0",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("rolls back changed mailbox import state when checkpointing throws", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const item = createMailboxItem({
      id: "mailbox_item_conversation_checkpoint_throw",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(): Promise<HostedWorkspaceCheckpointResponse> {
        throw new Error("Synthetic checkpoint transport failure.");
      },
    };

    try {
      await assert.rejects(
        () =>
          importHostedMailboxPrefixAndCheckpoint({
            expectedUserId: TEST_USER_ID,
            createCheckpointRequest() {
              return {
                attemptId: "attempt_synthetic_checkpoint_throw",
                expectedWorkspaceVersion: "0",
                leaseGeneration: "1",
                nextWakeAt: null,
                nextWakeReason: null,
                reason: "import",
                snapshotRef: null,
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            limitPerLane: 10,
            mailboxPort,
            now: () => TEST_NOW,
            requestId: "request_synthetic_checkpoint_throw",
            vaultRoot,
            workspacePort,
          }),
        /Synthetic checkpoint transport failure/,
      );
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "0",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("throws and rolls back when workspace checkpoint returns another user", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-mailbox-checkpoint-"));
    const item = createMailboxItem({
      id: "mailbox_item_conversation_checkpoint_user_mismatch",
      laneSeq: "1",
    });
    const { mailboxPort } = createMailboxPort({
      items: [item],
    });
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
        return {
          checkpointed: true,
          workspace: {
            checkpointedAt: TEST_NOW,
            createdAt: TEST_NOW,
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: null,
            updatedAt: TEST_NOW,
            userId: "member_synthetic_checkpoint_other",
            version: "1",
          },
        };
      },
    };

    try {
      await assert.rejects(
        () =>
          importHostedMailboxPrefixAndCheckpoint({
            expectedUserId: TEST_USER_ID,
            createCheckpointRequest() {
              return {
                attemptId: "attempt_synthetic_checkpoint_user_mismatch",
                expectedWorkspaceVersion: "0",
                leaseGeneration: "1",
                nextWakeAt: null,
                nextWakeReason: null,
                reason: "import",
                snapshotRef: null,
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            limitPerLane: 10,
            mailboxPort,
            now: () => TEST_NOW,
            requestId: "request_synthetic_checkpoint_user_mismatch",
            vaultRoot,
            workspacePort,
          }),
        HostedMailboxImportCheckpointUserMismatchError,
      );
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "0",
      );
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }
  });
});

function createMailboxPort(input: {
  items: readonly HostedMailboxItem[];
}): {
  fetchRequests: HostedMailboxFetchRequest[];
  mailboxPort: HostedRuntimeMailboxPort;
  payloadFetchRequests: HostedMailboxPayloadFetchRequest[];
} {
  const fetchRequests: HostedMailboxFetchRequest[] = [];
  const payloadFetchRequests: HostedMailboxPayloadFetchRequest[] = [];

  return {
    fetchRequests,
    mailboxPort: {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          items: input.items.filter((item) =>
            request.lanes.some((lane) =>
              lane.lane === item.lane && BigInt(item.laneSeq) > BigInt(lane.importedSeq)
            )
          ),
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: input.items
              .filter((item) => item.lane === lane.lane)
              .reduce((maxSeq, item) =>
                BigInt(item.laneSeq) > BigInt(maxSeq) ? item.laneSeq : maxSeq,
              lane.importedSeq),
          })),
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload(request): Promise<HostedMailboxPayloadFetchResponse> {
        payloadFetchRequests.push(request);
        return {
          fetchedAt: TEST_NOW,
          payload: null,
          unavailable: {
            code: "not_found",
            retryable: true,
          },
        };
      },
    },
    payloadFetchRequests,
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: "dedupe_synthetic_checkpoint",
    expiresAt: null,
    id: "mailbox_item_conversation_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_inline_synthetic_checkpoint",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

function createCheckpointResponse(
  request: HostedWorkspaceCheckpointRequest,
): HostedWorkspaceCheckpointResponse {
  return {
    checkpointed: true,
    workspace: {
      checkpointedAt: TEST_NOW,
      createdAt: TEST_NOW,
      nextWakeAt: request.nextWakeAt ?? null,
      nextWakeReason: request.nextWakeReason ?? null,
      redactedStatus: request.redactedStatus ?? null,
      snapshotRef: request.snapshotRef,
      updatedAt: TEST_NOW,
      userId: TEST_USER_ID,
      version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
    },
  };
}
