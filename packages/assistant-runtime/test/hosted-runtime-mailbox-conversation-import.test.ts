import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import {
  listAssistantInputEvents,
} from "@murphai/assistant-engine";

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
import {
  HostedConversationInboxProjectionError,
} from "../src/hosted-runtime/events/conversation.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/models.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_conversation_import";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      })
    ),
  );
});

describe("hosted mailbox conversation import adapter", () => {
  test("upserts a minimized assistant input event before best-effort inbox projection", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_synthetic_projection_failure",
          parts: [
            {
              type: "text",
              value: "hello https://signed.example.invalid/raw",
            },
            {
              attachmentId: "att_voice_1",
              fileName: "voice.m4a",
              mimeType: "audio/mp4",
              size: 12_345,
              type: "voice_memo",
              url: "https://signed.example.invalid/voice",
            },
          ],
        },
        phoneLookupKey: "+15550100000",
      },
    });
    const order: string[] = [];

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake(input) {
        order.push(`projection:${input.wake.eventId}`);
        throw new HostedConversationInboxProjectionError(
          "canonical inbox capture unavailable",
        );
      },
      async prepareWakeContext(input) {
        order.push(`prepare:${input.wake.eventId}`);
      },
      item,
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.deepEqual(order, [
      "prepare:evt_synthetic_conversation_001",
      "projection:evt_synthetic_conversation_001",
    ]);
    assert.equal(outcome.status, "imported");
    assert.equal(outcome.reasonCode, "conversation-import.projection-failed");

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    const event = listed.events[0]!;
    assert.equal(event.sourceRef.kind, "hosted-mailbox");
    assert.equal(event.content.text, "hello [link omitted]");
    assert.deepEqual(event.content.attachmentDescriptors, [
      {
        attachmentId: "att_voice_1",
        contentType: "audio/mp4",
        fileName: null,
        kind: "voice_memo",
        sizeBytes: 12_345,
      },
    ]);
    assert.deepEqual(event.projection, {
      captureId: null,
      lastAttemptedAt: event.projection.lastAttemptedAt,
      nextAttemptAfter: null,
      reasonCode: "conversation-import.projection-failed",
      status: "failed",
      updatedAt: event.projection.updatedAt,
    });
    assert.equal(JSON.stringify(event).includes("https://signed.example.invalid"), false);
    assert.equal(JSON.stringify(event).includes("voice.m4a"), false);
  });

  test("decodes conversation.message through the injected seam and imports it through the local inbox path", async () => {
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake();
    const decodeCalls: unknown[] = [];
    const importedWakeIds: string[] = [];
    const preparedWakeIds: string[] = [];
    const order: string[] = [];
    const projectionUpdates: unknown[] = [];

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
        order.push(`import:${input.wake.eventId}`);
        importedWakeIds.push(input.wake.eventId);
        return {
          captureId: "cap_synthetic_conversation_001",
          deduped: false,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext(input) {
        order.push(`prepare:${input.wake.eventId}`);
        preparedWakeIds.push(input.wake.eventId);
      },
      item,
      runtime: createRuntime(),
      stageAssistantInputEvent: createAssistantInputEventStager({
        order,
        projectionUpdates,
      }),
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
    assert.deepEqual(order, [
      "stage:evt_synthetic_conversation_001",
      "prepare:evt_synthetic_conversation_001",
      "import:evt_synthetic_conversation_001",
      "projection:succeeded",
    ]);
    assert.deepEqual(projectionUpdates, [
      {
        captureId: "cap_synthetic_conversation_001",
        reasonCode: null,
        status: "succeeded",
      },
    ]);
    assert.equal(outcome.status, "imported");
    assert.equal(outcome.captureId, "cap_synthetic_conversation_001");
    assert.deepEqual(outcome.metrics, {
      nextWakeAt: null,
      parserProcessed: 0,
    });
    assert.equal(outcome.afterCheckpoint, undefined);
  });

  test("requires hosted bootstrap before staging assistant input with the default context preparer", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-unbootstrapped-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    let stageCalls = 0;

    await expect(
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(createConversationWake()),
        async importConversationWake() {
          throw new Error("should not import projection before bootstrap");
        },
        item: createResolvedConversationMailboxItem(),
        runtime: createRuntime(),
        stageAssistantInputEvent: async () => {
          stageCalls += 1;
          return {
            inputId: "ain_00000000000000000000000000000000",
            async recordProjection() {},
          };
        },
        vaultRoot,
      }),
    ).rejects.toThrow(
      "Hosted execution for conversation.message requires member.activated bootstrap first.",
    );
    assert.equal(stageCalls, 0);
  });

  test("does not convert unknown local import failures into acknowledged projection failures", async () => {
    const projectionUpdates: unknown[] = [];

    await expect(
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(createConversationWake()),
        async importConversationWake() {
          throw new TypeError("unexpected projection adapter failure");
        },
        async prepareWakeContext() {},
        item: createResolvedConversationMailboxItem(),
        runtime: createRuntime(),
        stageAssistantInputEvent: createAssistantInputEventStager({
          projectionUpdates,
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toThrow("unexpected projection adapter failure");
    assert.deepEqual(projectionUpdates, []);
  });

  test("does not record Linq provider cleanup during mailbox import", async () => {
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
      stageAssistantInputEvent: createAssistantInputEventStager(),
      vaultRoot: "synthetic-vault-root",
    });

    assert.equal(outcome.status, "imported");
    assert.equal(outcome.afterCheckpoint, undefined);
  });

  test("keeps accepted Linq imports independent from provider cleanup", async () => {
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
      stageAssistantInputEvent: createAssistantInputEventStager(),
      vaultRoot: "synthetic-vault-root",
    });

    assert.equal(outcome.status, "imported");
    assert.equal(outcome.afterCheckpoint, undefined);
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
      stageAssistantInputEvent: createAssistantInputEventStager(),
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

  test("keeps staged mailbox input imported when inbox projection only created transient runtime state", async () => {
    const item = createResolvedConversationMailboxItem();
    const preparedWakeIds: string[] = [];
    const projectionUpdates: unknown[] = [];

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(createConversationWake()),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_runtime_only",
          deduped: false,
          durable: false,
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
      stageAssistantInputEvent: createAssistantInputEventStager({
        projectionUpdates,
      }),
      vaultRoot: "synthetic-vault-root",
    });

    assert.deepEqual(preparedWakeIds, ["evt_synthetic_conversation_001"]);
    assert.deepEqual(outcome, {
      captureId: "cap_synthetic_runtime_only",
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      reasonCode: "conversation-import.capture-persist-failed",
      status: "imported",
    });
    assert.deepEqual(projectionUpdates, [
      {
        captureId: null,
        reasonCode: "conversation-import.capture-persist-failed",
        status: "failed",
      },
    ]);
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
      stageAssistantInputEvent: createAssistantInputEventStager(),
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
      stageAssistantInputEvent: createAssistantInputEventStager(),
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
      stageAssistantInputEvent: createAssistantInputEventStager(),
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

  test("keeps staged email input imported when raw email bytes are unavailable during projection", async () => {
    const item = createResolvedConversationMailboxItem();
    const projectionUpdates: unknown[] = [];
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
      stageAssistantInputEvent: createAssistantInputEventStager({
        projectionUpdates,
      }),
      vaultRoot: "synthetic-vault-root",
    });

    assert.deepEqual(outcome, {
      captureId: null,
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      reasonCode: "conversation-import.raw-email-missing",
      status: "imported",
    });
    assert.deepEqual(projectionUpdates, [
      {
        captureId: null,
        reasonCode: "conversation-import.raw-email-missing",
        status: "failed",
      },
    ]);
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

function createAssistantInputEventStager(input: {
  order?: string[];
  projectionUpdates?: unknown[];
} = {}) {
  return async (stageInput: {
    wake: HostedExecutionConversationMessageWake;
  }) => {
    input.order?.push(`stage:${stageInput.wake.eventId}`);
    return {
      inputId: "ain_00000000000000000000000000000000",
      async recordProjection(projection: unknown) {
        const status = typeof projection === "object" && projection !== null && "status" in projection
          ? String((projection as { status?: unknown }).status)
          : "unknown";
        input.order?.push(`projection:${status}`);
        input.projectionUpdates?.push(projection);
      },
    };
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
