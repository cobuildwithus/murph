import assert from "node:assert/strict";

import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

const mocks = vi.hoisted(() => ({
  recordHostedProviderCleanupBeforeCommit: vi.fn(),
}));

vi.mock("../src/hosted-runtime/provider-cleanup.ts", () => ({
  recordHostedProviderCleanupBeforeCommit: mocks.recordHostedProviderCleanupBeforeCommit,
}));

import {
  createHostedConversationMailboxImportItem,
  importHostedConversationMailboxItem,
  type HostedConversationMailboxPayloadDecoder,
} from "../src/hosted-runtime/mailbox-conversation-import.ts";
import {
  createHostedMailboxRoutingPlan,
} from "../src/hosted-runtime/mailbox-routing.ts";
import {
  HostedRawEmailMessageMissingError,
} from "../src/hosted-runtime/events/email.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/models.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_conversation_import";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordHostedProviderCleanupBeforeCommit.mockResolvedValue(undefined);
});

describe("hosted mailbox conversation import adapter", () => {
  test("decodes conversation.message through the injected seam and imports it through the local inbox path", async () => {
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake();
    const decodeCalls: unknown[] = [];
    const importedWakeIds: string[] = [];
    const preparedWakeIds: string[] = [];
    const afterCheckpoint = vi.fn(async () => undefined);

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: {
        async decode(input) {
          decodeCalls.push(input);
          return {
            status: "decoded",
            wake: decodedWake,
          };
        },
      },
      async importConversationWake(input) {
        importedWakeIds.push(input.wake.eventId);
        return {
          afterCheckpoint,
          captureId: "cap_synthetic_conversation_001",
          deduped: false,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext(input) {
        preparedWakeIds.push(input.wake.eventId);
      },
      item,
      runtime: createRuntime(),
      vaultRoot: "synthetic-vault-root",
    });

    assert.deepEqual(decodeCalls, [
      {
        itemRef: {
          id: "mailbox_item_conversation_001",
          laneSeq: "1",
          userId: TEST_USER_ID,
        },
        payloadCiphertext: "ciphertext_inline_synthetic",
        payloadRequestId: null,
        payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        payloadSource: "inline",
      },
    ]);
    assert.deepEqual(preparedWakeIds, ["evt_synthetic_conversation_001"]);
    assert.deepEqual(importedWakeIds, ["evt_synthetic_conversation_001"]);
    assert.equal(outcome.status, "imported");
    assert.equal(outcome.captureId, "cap_synthetic_conversation_001");
    assert.deepEqual(outcome.metrics, {
      nextWakeAt: null,
      parserProcessed: 0,
    });
    assert.equal(outcome.afterCheckpointBeforeAssistant, undefined);
    assert.equal(typeof outcome.afterCheckpoint, "function");
    await outcome.afterCheckpoint?.();
    expect(afterCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
  });

  test("records Linq provider message ids after the accepted capture checkpoint", async () => {
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic",
          from: "+15550100000",
          isFromMe: false,
          messageId: " msg_linq_cleanup_123 ",
          parts: [
            {
              type: "text",
              value: "hello",
            },
          ],
        },
        phoneLookupKey: "+15550100000",
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
        return {
          captureId: "cap_synthetic_linq_conversation_001",
          deduped: false,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot: "synthetic-vault-root",
    });

    assert.equal(outcome.status, "imported");
    expect(mocks.recordHostedProviderCleanupBeforeCommit).not.toHaveBeenCalled();
    assert.equal(outcome.afterCheckpoint, undefined);
    assert.equal(typeof outcome.afterCheckpointBeforeAssistant, "function");
    await outcome.afterCheckpointBeforeAssistant?.();
    expect(mocks.recordHostedProviderCleanupBeforeCommit).toHaveBeenCalledWith({
      checkpoint: {
        nextWakeAt: null,
      },
      linqMessageIds: ["msg_linq_cleanup_123"],
      vaultRoot: "synthetic-vault-root",
    });
  });

  test("does not fail accepted imports when Linq provider cleanup recording fails", async () => {
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_linq_cleanup_fails",
          parts: [],
        },
        phoneLookupKey: "+15550100000",
      },
    });
    mocks.recordHostedProviderCleanupBeforeCommit.mockRejectedValueOnce(
      new Error("cleanup state unavailable"),
    );

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_linq_conversation_001",
          deduped: false,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot: "synthetic-vault-root",
    });

    assert.equal(outcome.status, "imported");
    await assert.doesNotReject(async () => outcome.afterCheckpointBeforeAssistant?.());
  });

  test("reports deterministic local-capture dedupe as a skipped import without hosted cursor terms", async () => {
    const item = createResolvedConversationMailboxItem();
    const importItem = createHostedConversationMailboxImportItem({
      decodePayload: createDecodedPayloadDecoder(createConversationWake()),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_conversation_001",
          deduped: true,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      runtime: createRuntime(),
      vaultRoot: "synthetic-vault-root",
    });

    const first = await importItem(item);
    const second = await importItem(item);

    assert.deepEqual(first, {
      captureId: "cap_synthetic_conversation_001",
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      reasonCode: "capture.deduped",
      status: "skipped",
    });
    assert.deepEqual(second, first);
    const serialized = JSON.stringify([first, second]);
    assert.equal(serialized.includes("runId"), false);
    assert.equal(serialized.includes("committedSeq"), false);
    assert.equal(serialized.includes("source_cursor"), false);
  });

  test("defers unexpected routes before decrypting or importing", async () => {
    const item = createResolvedSystemMailboxItem();
    let decodeCalls = 0;
    let importCalls = 0;

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: {
        async decode() {
          decodeCalls += 1;
          return {
            status: "decoded",
            wake: createConversationWake(),
          };
        },
      },
      async importConversationWake() {
        importCalls += 1;
        return {
          captureId: "cap_synthetic_conversation_001",
          deduped: false,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      item,
      runtime: createRuntime(),
      vaultRoot: "synthetic-vault-root",
    });

    assert.deepEqual(outcome, {
      reasonCode: "conversation_import.unexpected_route",
      status: "deferred",
    });
    assert.equal(decodeCalls, 0);
    assert.equal(importCalls, 0);
  });

  test("defers unavailable or mismatched decrypted payloads without importing", async () => {
    const item = createResolvedConversationMailboxItem();
    let importCalls = 0;
    const importer = async () => {
      importCalls += 1;
      return {
        captureId: "cap_synthetic_conversation_001",
        deduped: false,
        metrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
      };
    };

    const blocked = await importHostedConversationMailboxItem({
      decodePayload: {
        async decode() {
          return {
            reasonCode: "  unavailable payload!  ",
            retryable: true,
            status: "blocked",
          };
        },
      },
      importConversationWake: importer,
      item,
      runtime: createRuntime(),
      vaultRoot: "synthetic-vault-root",
    });
    const mismatched = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(
        createConversationWake({
          userId: "member_synthetic_other",
        }),
      ),
      importConversationWake: importer,
      item,
      runtime: createRuntime(),
      vaultRoot: "synthetic-vault-root",
    });

    assert.deepEqual(blocked, {
      reasonCode: "payload.decode_unavailable",
      retryable: true,
      status: "blocked",
    });
    assert.deepEqual(mismatched, {
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    });
    assert.equal(importCalls, 0);
  });

  test("blocks retryably when raw email bytes are unavailable during local import", async () => {
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "email",
        identityId: "identity_synthetic",
        rawMessageKey: "raw_email_missing",
        selfAddress: "assistant@example.test",
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedRawEmailMessageMissingError({
          rawMessageKey: "raw_email_missing",
          userId: TEST_USER_ID,
        });
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot: "synthetic-vault-root",
    });

    assert.deepEqual(outcome, {
      reasonCode: "conversation_import.raw_email_missing",
      retryable: true,
      status: "blocked",
    });
  });
});

function createDecodedPayloadDecoder(
  wake: HostedExecutionConversationMessageWake,
): HostedConversationMailboxPayloadDecoder {
  return {
    async decode() {
      return {
        status: "decoded",
        wake,
      };
    },
  };
}

function createResolvedConversationMailboxItem(
  overrides: Partial<HostedMailboxItem> = {},
): HostedMailboxResolvedImportItem {
  return createResolvedMailboxItem(createMailboxItem(overrides));
}

function createResolvedSystemMailboxItem(): HostedMailboxResolvedImportItem {
  return createResolvedMailboxItem(
    createMailboxItem({
      id: "mailbox_item_system_001",
      kind: "member.activated",
      lane: "system",
    }),
  );
}

function createResolvedMailboxItem(
  item: HostedMailboxItem,
): HostedMailboxResolvedImportItem {
  const route = createHostedMailboxRoutingPlan(item);
  if (route.state !== "route") {
    throw new Error(`Expected routed mailbox item in test fixture.`);
  }

  return {
    item,
    payload: {
      payloadCiphertext: item.payloadInlineCiphertext ?? "ciphertext_sidecar_synthetic",
      payloadSchema: item.payloadSchema,
      requestId: null,
      source: item.payloadInlineCiphertext ? "inline" : "sidecar",
      status: "resolved",
    },
    route,
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: "evt_synthetic_conversation_001",
    expiresAt: null,
    id: "mailbox_item_conversation_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_inline_synthetic",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

function createConversationWake(
  overrides: Partial<HostedExecutionConversationMessageWake> = {},
): HostedExecutionConversationMessageWake {
  return {
    eventId: "evt_synthetic_conversation_001",
    kind: "conversation.message",
    message: {
      channel: "email",
      identityId: "email_identity_synthetic",
      rawMessageKey: "raw_message_synthetic",
      selfAddress: null,
    },
    occurredAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

function createRuntime(): Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
> {
  return {
    forwardedEnv: {},
    platform: {
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
    },
    platformEnv: {},
    resolvedConfig: {
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: null,
      managedAutoReplyChannels: [
        {
          capabilityReady: false,
          channel: "email",
          memberChannel: "email",
        },
        {
          capabilityReady: true,
          channel: "linq",
          memberChannel: "linq",
        },
        {
          capabilityReady: false,
          channel: "telegram",
          memberChannel: "telegram",
        },
      ],
    },
    userEnv: {},
  };
}
