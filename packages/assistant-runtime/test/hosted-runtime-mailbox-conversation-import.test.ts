import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { VAULT_LAYOUT } from "@murphai/contracts";
import {
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
} from "@murphai/hosted-execution/contracts";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";
import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedMailboxItem,
  HostedRuntimeLatencyTraceRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";
import {
  ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH,
  listAssistantInputEvents,
  updateAssistantInputAttachmentEvidence,
} from "@murphai/assistant-engine";
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  serializeHostedEmailThreadTarget,
} from "@murphai/runtime-state";

import {
  createHostedConversationMailboxImportItem,
  importHostedConversationMailboxItem,
  type HostedConversationMailboxPayloadDecoder,
} from "../src/hosted-runtime/mailbox-conversation-import.ts";
import {
  createHostedMailboxRoutingPlan,
} from "../src/hosted-runtime/mailbox-routing.ts";
import {
  createHostedAssistantInputSource,
} from "../src/hosted-runtime/turn-input.ts";
import {
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";
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
const HASHED_IDENTIFIER_PATTERN = /^hid_[0-9a-f]{32}$/u;
const HOSTED_ASSISTANT_SEED_ENV = {
  HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
  HOSTED_ASSISTANT_MODEL: "gpt-5.5",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
  HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
} as const;
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
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_synthetic_projection_failure",
          parts: [
            {
              type: "text",
              value:
                "hello https://signed.example.invalid/raw\nfile file:///tmp/fixture\npath /tmp/fixture\nAuthorization: fixture-header",
            },
            {
              attachmentId: "att_voice_1",
              fileName: "voice.m4a",
              mimeType: "audio/mp4",
              size: 12_345,
              type: "voice_memo",
              url: "redacted-attachment-url-sentinel",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
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
    assert.deepEqual(outcome.linqDeliveryContext, {
      directRecipientPhoneNumber: "redacted-contact-sentinel",
      fromPhoneNumber: null,
      replyToMessageId: "msg_synthetic_projection_failure",
      routeAuthority: null,
      target: "chat_synthetic",
    });

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    const event = listed.events[0]!;
    assert.equal(event.sourceRef.kind, "hosted-mailbox");
    assert.equal(
      event.content.text,
      "hello https://signed.example.invalid/raw\nfile file:///tmp/fixture\npath /tmp/fixture\nAuthorization: fixture-header",
    );
    assert.match(event.sourceRef.dedupeKey ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.sourceRef.eventId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.sourceRef.itemId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.accountId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.actorId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.threadId ?? "", HASHED_IDENTIFIER_PATTERN);
    const replyTarget = event.replyTarget;
    assert.deepEqual(replyTarget, {
      channel: "linq",
      messageId: "msg_synthetic_projection_failure",
      threadId: "chat_synthetic",
    });
    assert.deepEqual(event.sourceMetadata, {
      kind: "linq",
      partCount: 2,
      reactionEligible: false,
      replyToMessageId: null,
      service: null,
    });
    assert.ok(replyTarget);
    assert.equal(replyTarget.messageId?.startsWith("hid_"), false);
    assert.equal(replyTarget.threadId?.startsWith("hid_"), false);
    assert.equal(event.content.attachmentDescriptors.length, 1);
    assert.match(
      event.content.attachmentDescriptors[0]?.attachmentId ?? "",
      HASHED_IDENTIFIER_PATTERN,
    );
    assert.deepEqual(event.content.attachmentDescriptors[0], {
      attachmentId: event.content.attachmentDescriptors[0]?.attachmentId,
      contentType: "audio/mp4",
      fileName: "voice.m4a",
      kind: "voice_memo",
      sizeBytes: 12_345,
    });
    assert.deepEqual(event.projection, {
      captureId: null,
      lastAttemptedAt: event.projection.lastAttemptedAt,
      reasonCode: "conversation-import.projection-failed",
      status: "failed",
      updatedAt: event.projection.updatedAt,
    });
    assert.ok(event.projection.lastAttemptedAt);
    assert.equal(
      event.content.text,
      "hello https://signed.example.invalid/raw\nfile file:///tmp/fixture\npath /tmp/fixture\nAuthorization: fixture-header",
    );
    assert.equal(JSON.stringify(event).includes("redacted-attachment-url-sentinel"), false);
    assert.equal(JSON.stringify(event).includes("voice.m4a"), true);
    assert.equal(JSON.stringify(event).includes("+15550100000"), false);

    const afterProjection = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(afterProjection.events[0]?.projection.status, "failed");
    assert.equal(
      afterProjection.events[0]?.projection.reasonCode,
      "conversation-import.projection-failed",
    );
    assert.ok(afterProjection.events[0]?.projection.lastAttemptedAt);
    assert.equal(afterProjection.events[0]?.attachmentEvidence.status, "failed");
    assert.equal(
      afterProjection.events[0]?.attachmentEvidence.reasonCode,
      "conversation-import.attachment-evidence-failed",
    );
    assert.equal(afterProjection.events[0]?.attachmentEvidence.source, "hosted-inbox-projection");
    assert.equal(afterProjection.events[0]?.attachmentEvidence.attachments.length, 0);
  });

  test("stages a durably consumed conversation item with a null reply target", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-consumed-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item: HostedMailboxResolvedImportItem = {
      ...createResolvedConversationMailboxItem(),
      durablyConsumed: true,
    };
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_consumed_replay",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_consumed_replay",
          parts: [
            {
              type: "text",
              value: "already handled replayed message",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: null,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      item,
      latencyMilestones: {
        phaseBreakdown: {
          schemaVersion: 1,
          wake: {
            foregroundImportStartedAtEpochMs: 1_777_000_000_300,
            foregroundWaitResolvedAtEpochMs: 1_777_000_000_200,
            runtimeWakeNotifiedAtEpochMs: 1_777_000_000_100,
          },
        },
      },
      runtime: createRuntime({
        platform: {
          latencyTracePort: {
            async record(request) {
              latencyTraceRequests.push(request);
              return {
                matchedCount: 1,
                recorded: true,
                unmatchedCount: 0,
              };
            },
          },
        },
      }),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    // Replayed, already-handled messages stay conversation context only: a null
    // replyTarget fails the reply-eligibility channel match in assistant-engine.
    assert.equal(listed.events[0]?.replyTarget, null);
    assert.equal(
      listed.events[0]?.content.text,
      "already handled replayed message",
    );
    assert.deepEqual(
      await readHostedPendingAssistantInputIds({ vaultRoot }),
      [],
    );
    assert.equal(latencyTraceRequests.length, 0);
  });

  test("keeps the reply target for a fresh conversation item", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-fresh-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_fresh_input",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_fresh_input",
          parts: [
            {
              type: "text",
              value: "fresh message",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: null,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    assert.deepEqual(listed.events[0]?.replyTarget, {
      channel: "linq",
      messageId: "msg_fresh_input",
      threadId: "chat_fresh_input",
    });
  });

  test("adds runtime latency milestones to Linq staged trace callbacks", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-latency-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_latency",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_latency",
          parts: [
            {
              type: "text",
              value: "latency trace message body",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "canonical inbox capture unavailable",
        );
      },
      async prepareWakeContext() {},
      item,
      latencyMilestones: {
        runnerJobAcceptedAt: "2026-04-26T00:00:00.100Z",
        runtimePhaseStartedAt: "2026-04-26T00:00:00.200Z",
        workspaceRestoreDoneAt: "2026-04-26T00:00:00.300Z",
      },
      runtime: createRuntime({
        platform: {
          latencyTracePort: {
            async record(request) {
              latencyTraceRequests.push(request);
              return {
                matchedCount: 1,
                recorded: true,
                unmatchedCount: 0,
              };
            },
          },
        },
      }),
      runtimeAttemptId: "attempt_latency_trace_1",
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    expect(latencyTraceRequests.map((request) => request.event)).toEqual([
      expect.objectContaining({
        mailboxItemId: item.item.id,
        runnerJobAcceptedAt: "2026-04-26T00:00:00.100Z",
        runtimeAttemptId: "attempt_latency_trace_1",
        runtimePhaseStartedAt: "2026-04-26T00:00:00.200Z",
        source: "linq",
        type: "assistant_input_staged",
        workspaceRestoreDoneAt: "2026-04-26T00:00:00.300Z",
      }),
    ]);
    assert.equal(JSON.stringify(latencyTraceRequests).includes("latency trace message body"), false);
  });

  test("omits impossible runtime wake notify time without dropping foreground wake timings", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-latency-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const staleWakeNotifiedAtEpochMs = Date.parse("2026-04-26T00:00:01.000Z");
    const itemOccurredAt = "2026-04-26T00:00:10.000Z";
    const item = createResolvedConversationMailboxItem({
      occurredAt: itemOccurredAt,
    });
    const decodedWake = createConversationWake({
      occurredAt: itemOccurredAt,
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_latency_stale_wake",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_latency_stale_wake",
          parts: [
            {
              type: "text",
              value: "stale wake trace message body",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "canonical inbox capture unavailable",
        );
      },
      async prepareWakeContext() {},
      item,
      latencyMilestones: {
        phaseBreakdown: {
          schemaVersion: 1,
          wake: {
            runtimeWakeNotifiedAtEpochMs: staleWakeNotifiedAtEpochMs,
            foregroundWaitResolvedAtEpochMs: staleWakeNotifiedAtEpochMs + 100,
            foregroundImportStartedAtEpochMs: staleWakeNotifiedAtEpochMs + 200,
          },
        },
      },
      runtime: createRuntime({
        platform: {
          latencyTracePort: {
            async record(request) {
              latencyTraceRequests.push(request);
              return {
                matchedCount: 1,
                recorded: true,
                unmatchedCount: 0,
              };
            },
          },
        },
      }),
      runtimeAttemptId: "attempt_latency_trace_stale_wake",
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    assert.equal(latencyTraceRequests.length, 1);
    const event = latencyTraceRequests[0]?.event;
    assert.equal(event?.type, "assistant_input_staged");
    if (!event || event.type !== "assistant_input_staged") {
      throw new Error("Expected assistant input staged latency trace event.");
    }
    assert.deepEqual(event.phaseBreakdown?.wake, {
      foregroundWaitResolvedAtEpochMs: staleWakeNotifiedAtEpochMs + 100,
      foregroundImportStartedAtEpochMs: staleWakeNotifiedAtEpochMs + 200,
    });
    assert.equal(JSON.stringify(latencyTraceRequests).includes("stale wake trace message body"), false);
  });

  test("self-heals Linq auto-reply before staging a mailbox input", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-admission-"));
    tempRoots.push(parentRoot);
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, Buffer.from("{}\n"));
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_admission",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_admission",
          parts: [
            {
              type: "text",
              value: "quick ack",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });

    const outcome = await withOperatorHomeRoot(operatorHomeRoot, () =>
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        item,
        runtime: createRuntime({
          userEnv: HOSTED_ASSISTANT_SEED_ENV,
        }),
        async stageAssistantInputEvent() {
          const state = await readAssistantAutomationState(vaultRoot);
          assert.deepEqual(
            state.autoReply.map((entry) => ({
              channel: entry.channel,
              eligibleAfter: entry.eligibleAfter,
            })),
            [{
              channel: "linq",
              eligibleAfter: null,
            }],
          );
          return {
            inputId: "input_linq_admission",
            async recordProjection() {},
          };
        },
        vaultRoot,
      })
    );

    assert.equal(outcome.status, "imported");
    assert.equal(outcome.assistantInputId !== null, true);
    const state = await readAssistantAutomationState(vaultRoot);
    assert.deepEqual(
      state.autoReply.map((entry) => ({
        channel: entry.channel,
        eligibleAfter: entry.eligibleAfter,
      })),
      [{
        channel: "linq",
        eligibleAfter: null,
      }],
    );
  });

  test("enqueues pending Telegram input for a reply-eligible import", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-telegram-pending-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_telegram_pending_001",
      message: {
        channel: "telegram",
        telegramMessage: {
          attachments: [],
          messageId: "777",
          schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
          text: "telegram pending input",
          threadId: "123456789",
        },
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: null,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_telegram_pending_001",
      }),
      async prepareWakeContext() {},
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    const event = listed.events[0]!;
    assert.deepEqual(event.replyTarget, {
      channel: "telegram",
      messageId: "777",
      threadId: "123456789",
    });
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), [
      event.inputId,
    ]);
  });

  test("enqueues pending Telegram input when the channel is already enabled", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-telegram-enabled-"));
    tempRoots.push(parentRoot);
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, Buffer.from("{}\n"));
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "telegram",
        eligibleAfter: null,
        enabledAt: TEST_NOW,
      }],
      updatedAt: TEST_NOW,
      version: 1,
    });
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_telegram_enabled_001",
      message: {
        channel: "telegram",
        telegramMessage: {
          attachments: [],
          messageId: "778",
          schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
          text: "telegram already enabled input",
          threadId: "123456789",
        },
      },
    });

    const outcome = await withOperatorHomeRoot(operatorHomeRoot, () =>
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        async importConversationWake() {
          return {
            captureId: null,
            metrics: {
              nextWakeAt: null,
              parserProcessed: 0,
            },
          };
        },
        item: createResolvedConversationMailboxItem({
          dedupeKey: decodedWake.eventId,
          id: "mailbox_item_telegram_enabled_001",
        }),
        runtime: createRuntime({
          resolvedConfig: {
            channelCapabilities: {
              emailSendReady: false,
              telegramBotConfigured: true,
              whatsappCloudApiConfigured: false,
            },
            deviceSync: null,
            managedAutoReplyChannels: [
              {
                capabilityReady: true,
                channel: "telegram",
                memberChannel: "telegram",
              },
            ],
          },
          userEnv: HOSTED_ASSISTANT_SEED_ENV,
        }),
        vaultRoot,
      })
    );

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), [
      listed.events[0]!.inputId,
    ]);
  });

  test("does not enqueue pending input when the hosted assistant is unconfigured", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-unconfigured-"));
    tempRoots.push(parentRoot);
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, Buffer.from("{}\n"));
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "linq",
        eligibleAfter: null,
        enabledAt: TEST_NOW,
      }],
      updatedAt: TEST_NOW,
      version: 1,
    });
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_unconfigured",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_unconfigured",
          parts: [
            {
              type: "text",
              value: "assistant is unavailable",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });

    const outcome = await withOperatorHomeRoot(operatorHomeRoot, () =>
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        async importConversationWake() {
          return {
            captureId: null,
            metrics: {
              nextWakeAt: null,
              parserProcessed: 0,
            },
          };
        },
        item,
        runtime: createRuntime(),
        vaultRoot,
      })
    );

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.deepEqual(listed.events[0]?.replyTarget, {
      channel: "linq",
      messageId: "msg_unconfigured",
      threadId: "chat_unconfigured",
    });
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), []);
  });

  test("does not enqueue pending email input when the assistant is configured but email is unavailable", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-email-unavailable-"));
    tempRoots.push(parentRoot);
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, Buffer.from("{}\n"));
    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [{
        channel: "email",
        eligibleAfter: null,
        enabledAt: TEST_NOW,
      }],
      updatedAt: TEST_NOW,
      version: 1,
    });
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake();

    const outcome = await withOperatorHomeRoot(operatorHomeRoot, () =>
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        async importConversationWake() {
          return {
            captureId: null,
            metrics: {
              nextWakeAt: null,
              parserProcessed: 0,
            },
          };
        },
        item,
        runtime: createRuntime({
          resolvedConfig: {
            channelCapabilities: {
              emailSendReady: false,
              telegramBotConfigured: false,
              whatsappCloudApiConfigured: false,
            },
            deviceSync: null,
            managedAutoReplyChannels: [
              {
                capabilityReady: false,
                channel: "email",
                memberChannel: "email",
              },
            ],
          },
          userEnv: HOSTED_ASSISTANT_SEED_ENV,
        }),
        vaultRoot,
      })
    );

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events[0]?.replyTarget?.channel, "email");
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), []);
  });

  test("self-heals email auto-reply before staging a mailbox input", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-email-admission-"));
    tempRoots.push(parentRoot);
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, Buffer.from("{}\n"));
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake();

    const outcome = await withOperatorHomeRoot(operatorHomeRoot, () =>
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        item,
        runtime: createRuntime({
          resolvedConfig: {
            channelCapabilities: {
              emailSendReady: true,
              telegramBotConfigured: false,
              whatsappCloudApiConfigured: false,
            },
            deviceSync: null,
            managedAutoReplyChannels: [
              {
                capabilityReady: true,
                channel: "email",
                memberChannel: "email",
              },
              {
                capabilityReady: true,
                channel: "linq",
                memberChannel: "linq",
              },
            ],
          },
          userEnv: HOSTED_ASSISTANT_SEED_ENV,
        }),
        async stageAssistantInputEvent() {
          const state = await readAssistantAutomationState(vaultRoot);
          assert.deepEqual(
            state.autoReply.map((entry) => ({
              channel: entry.channel,
              eligibleAfter: entry.eligibleAfter,
            })),
            [{
              channel: "email",
              eligibleAfter: null,
            }],
          );
          return {
            inputId: "input_email_admission",
            async recordProjection() {},
          };
        },
        vaultRoot,
      })
    );

    assert.equal(outcome.status, "imported");
    assert.equal(outcome.assistantInputId !== null, true);
    const state = await readAssistantAutomationState(vaultRoot);
    assert.deepEqual(
      state.autoReply.map((entry) => ({
        channel: entry.channel,
        eligibleAfter: entry.eligibleAfter,
      })),
      [{
        channel: "email",
        eligibleAfter: null,
      }],
    );
  });

  test("does not self-heal consent-gated WhatsApp auto-reply during mailbox import", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-whatsapp-admission-"));
    tempRoots.push(parentRoot);
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, Buffer.from("{}\n"));
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "whatsapp",
        whatsappMessage: {
          fromWaId: "15550100001",
          messageId: "wamid.admission",
          phoneNumberId: "phone-number-id",
          schema: "murph.hosted-whatsapp-message.v1",
          text: "quick ack",
          threadId: "15550100001",
        },
      },
    });

    const outcome = await withOperatorHomeRoot(operatorHomeRoot, () =>
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        item,
        runtime: createRuntime({
          resolvedConfig: {
            channelCapabilities: {
              emailSendReady: false,
              telegramBotConfigured: false,
              whatsappCloudApiConfigured: true,
            },
            deviceSync: null,
            managedAutoReplyChannels: [
              {
                capabilityReady: true,
                channel: "whatsapp",
                memberChannel: "whatsapp",
              },
            ],
          },
          userEnv: HOSTED_ASSISTANT_SEED_ENV,
        }),
        vaultRoot,
      })
    );

    assert.equal(outcome.status, "imported");
    const state = await readAssistantAutomationState(vaultRoot);
    assert.equal(
      state.autoReply.some((entry) => entry.channel === "whatsapp"),
      false,
    );
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), []);
  });

  test("uses the Linq email contact lookup as the assistant conversation identity seed", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-email-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const contactLookupKey = "hbidx:email:v1:mailbox";
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        contactKind: "email",
        contactLookupKey,
        linqMessage: {
          chatId: "chat_email_identity",
          from: "buddy@example.test",
          isFromMe: false,
          messageId: "msg_email_identity",
          parts: [
            {
              type: "text",
              value: "hello from email",
            },
          ],
          reactionEligible: true,
          service: "iMessage",
        },
        phoneLookupKey: null,
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_email_identity_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_email_identity_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    const event = listed.events[0];
    assert.ok(event);
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: contactLookupKey,
      userId: TEST_USER_ID,
    });
    const expectedAccountId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      contactLookupKey,
    );
    const expectedThreadId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      "chat_email_identity",
    );

    assert.equal(event.conversation?.accountId, expectedAccountId);
    assert.equal(event.conversation?.source, "linq");
    assert.equal(event.conversation?.threadId, expectedThreadId);
    assert.equal(event.replyTarget?.threadId, "chat_email_identity");
    assert.equal(event.replyTarget?.messageId, "msg_email_identity");
    assert.deepEqual(event.sourceMetadata, {
      kind: "linq",
      partCount: 1,
      reactionEligible: true,
      replyToMessageId: null,
      service: "iMessage",
    });
  });

  test("uses Linq route account lookup and group directness for assistant conversation identity", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-linq-group-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const accountLookupKey = "hbidx:phone:v1:route-account";
    const contactLookupKey = "hbidx:phone:v1:participant";
    const decodedWake = createConversationWake({
      message: {
        accountLookupKey,
        channel: "linq",
        contactKind: "phone",
        contactLookupKey,
        linqMessage: {
          chatId: "chat_group_identity",
          from: "+15551110000",
          isFromMe: false,
          messageId: "msg_group_identity",
          parts: [
            {
              type: "text",
              value: "hello group",
            },
          ],
          threadIsDirect: false,
        },
        phoneLookupKey: contactLookupKey,
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "canonical inbox projection unavailable",
        );
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_linq_group_identity_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    const event = listed.events[0];
    assert.ok(event);
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: accountLookupKey,
      userId: TEST_USER_ID,
    });
    const expectedAccountId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      accountLookupKey,
    );
    const unexpectedSenderAccountId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      contactLookupKey,
    );
    const expectedThreadId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      "chat_group_identity",
    );

    assert.equal(event.conversation?.accountId, expectedAccountId);
    assert.notEqual(event.conversation?.accountId, unexpectedSenderAccountId);
    assert.equal(event.conversation?.source, "linq");
    assert.equal(event.conversation?.threadId, expectedThreadId);
    assert.equal(event.conversation?.threadIsDirect, false);
    assert.equal(event.replyTarget?.threadId, "chat_group_identity");
  });

  test("stages WhatsApp input with hashed conversation metadata and private reply target", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-whatsapp-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_whatsapp_001",
      message: {
        channel: "whatsapp",
        whatsappMessage: {
          fromWaId: "15551234567",
          messageId: "wamid.synthetic",
          phoneNumberId: "phone-number-id",
          schema: "murph.hosted-whatsapp-message.v1",
          text: "CHECKIN https://signed.example.invalid/raw",
          threadId: "15551234567",
        },
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: null,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_whatsapp_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    const event = listed.events[0];
    assert.ok(event);

    assert.equal(event.content.text, "CHECKIN https://signed.example.invalid/raw");
    assert.equal(event.conversation?.source, "whatsapp");
    assert.match(event.conversation?.accountId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.actorId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.threadId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.equal(event.replyTarget?.channel, "whatsapp");
    assert.equal(event.replyTarget?.messageId, "wamid.synthetic");
    assert.equal(event.replyTarget?.threadId, "15551234567");
    assert.equal(event.sourceMetadata, null);
    assert.equal(JSON.stringify(event.conversation).includes("15551234567"), false);
  });

  test("records hosted attachment evidence after successful inbox projection", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-evidence-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_evidence_001",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic_evidence",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_synthetic_evidence",
          parts: [
            {
              attachmentId: "voice_part_1",
              fileName: "voice-note.m4a",
              mimeType: "audio/mp4",
              size: 256,
              type: "voice_memo",
              url: "https://signed.example.invalid/voice",
            },
          ],
        },
        phoneLookupKey: "+15550100000",
      },
    });
    const loadCalls: unknown[] = [];
    await writeVaultFile(
      vaultRoot,
      "raw/inbox/linq/cap_synthetic_evidence_001/attachments/01__voice-note.m4a",
      Buffer.from("audio bytes"),
    );

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_evidence_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 1,
          },
        };
      },
      async loadAttachmentEvidenceCapture(input) {
        loadCalls.push(input);
        return {
          captureId: input.captureId,
          attachments: [
            {
              attachmentId: "att_voice_1",
              byteSize: 256,
              derivedPath:
                "derived/inbox/cap_synthetic_evidence_001/attachments/att_voice_1/manifest.json",
              extractedText: "Redacted attachment text sentinel.",
              fileName: "voice-note.m4a",
              kind: "audio",
              mime: "audio/mp4",
              ordinal: 1,
              parseState: "succeeded",
              sha256: "b".repeat(64),
              storedPath:
                "raw/inbox/linq/cap_synthetic_evidence_001/attachments/01__voice-note.m4a",
              transcriptText: null,
            },
          ],
        };
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_evidence_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");

    assert.deepEqual(loadCalls, [
      {
        captureId: "cap_synthetic_evidence_001",
        requestId: "evt_synthetic_evidence_001",
        vaultRoot,
      },
    ]);
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    const evidence = listed.events[0]?.attachmentEvidence;
    assert.equal(evidence?.optionalInboxCaptureId, "cap_synthetic_evidence_001");
    assert.equal(evidence?.reasonCode, null);
    assert.equal(evidence?.source, "hosted-inbox-projection");
    assert.equal(evidence?.status, "available");
    assert.ok(evidence?.updatedAt);
    assert.deepEqual(evidence?.attachments, [
      {
        byteSize: 256,
        descriptorAttachmentId: "att_voice_1",
        derived: {
          allowedRoot:
            "derived/inbox/cap_synthetic_evidence_001/attachments/att_voice_1",
          kind: "parser-manifest",
          manifestPath:
            "derived/inbox/cap_synthetic_evidence_001/attachments/att_voice_1/manifest.json",
        },
        fileName: "voice-note.m4a",
        inlineFragments: [
          {
            kind: "attachment_extracted_text",
            label: "attachment-1-extracted-text",
            text: "Redacted attachment text sentinel.",
            truncated: false,
          },
        ],
        kind: "audio",
        mime: "audio/mp4",
        ordinal: 1,
        parseState: "succeeded",
        raw: {
          byteSize: 256,
          kind: "vault-relative-file",
          mediaType: "audio/mp4",
          path: "raw/inbox/linq/cap_synthetic_evidence_001/attachments/01__voice-note.m4a",
          sha256: "b".repeat(64),
        },
        sourceAttachmentId: "att_voice_1",
      },
    ]);
    assert.equal(JSON.stringify(listed.events[0]).includes("https://signed.example.invalid"), false);
  });

  test("blocks the mailbox item for retry when local parser work requests a retry wake", async () => {
    const decodedWake = createConversationWake({
      eventId: "evt_parser_retry_projection",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_parser_retry",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_parser_retry",
          parts: [
            {
              attachmentId: "voice_part_1",
              fileName: "voice-note.m4a",
              mimeType: "audio/mp4",
              size: 256,
              type: "voice_memo",
              url: "https://signed.example.invalid/voice",
            },
          ],
        },
        phoneLookupKey: "+15550100000",
      },
    });
    const projectionUpdates: unknown[] = [];

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_parser_retry_projection",
          metrics: {
            nextWakeAt: "2026-04-26T00:01:00.000Z",
            parserProcessed: 0,
          },
        };
      },
      async loadAttachmentEvidenceCapture(input) {
        return {
          captureId: input.captureId,
          attachments: [],
        };
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_parser_retry_projection",
      }),
      runtime: createRuntime(),
      stageAssistantInputEvent: createAssistantInputEventStager({
        projectionUpdates,
      }),
      vaultRoot: "synthetic-vault-root",
    });

    assert.deepEqual(outcome, {
      reasonCode: "conversation-import.parser-retry",
      retryable: true,
      status: "blocked",
    });
    assert.deepEqual(projectionUpdates, [
      {
        captureId: "cap_parser_retry_projection",
        reasonCode: null,
        status: "succeeded",
      },
    ]);
  });

  test("records inbox runtime unavailable as a specific projection and evidence reason", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-inbox-unavailable-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_inbox_unavailable_001",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic_inbox_unavailable",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_synthetic_inbox_unavailable",
          parts: [
            {
              attachmentId: "zip_part_1",
              fileName: "archive.zip",
              mimeType: "application/zip",
              size: 512,
              type: "media",
              url: "https://signed.example.invalid/archive.zip",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw Object.assign(new Error("inbox runtime not initialized"), {
          code: "INBOX_NOT_INITIALIZED",
        });
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_inbox_unavailable_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    assert.equal(outcome.reasonCode, "conversation-import.inbox-runtime-unavailable");

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events[0]?.projection.status, "failed");
    assert.equal(
      listed.events[0]?.projection.reasonCode,
      "conversation-import.inbox-runtime-unavailable",
    );
    assert.equal(listed.events[0]?.attachmentEvidence.status, "failed");
    assert.equal(
      listed.events[0]?.attachmentEvidence.reasonCode,
      "conversation-import.inbox-runtime-unavailable",
    );
  });

  test("does not downgrade useful hosted attachment evidence after replayed projection failure", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-evidence-replay-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_evidence_replay_001",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic_evidence_replay",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_synthetic_evidence_replay",
          parts: [
            {
              attachmentId: "voice_part_1",
              fileName: "voice-note.m4a",
              mimeType: "audio/mp4",
              size: 256,
              type: "voice_memo",
              url: "redacted-attachment-url-sentinel",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    const item = createResolvedConversationMailboxItem({
      dedupeKey: decodedWake.eventId,
      id: "mailbox_item_evidence_replay_001",
    });
    await writeVaultFile(
      vaultRoot,
      "raw/inbox/linq/cap_synthetic_evidence_replay_001/attachments/01__voice-note.m4a",
      Buffer.from("audio bytes"),
    );

    const firstOutcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_evidence_replay_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 1,
          },
        };
      },
      async loadAttachmentEvidenceCapture(input) {
        return {
          captureId: input.captureId,
          attachments: [
            {
              attachmentId: "att_voice_1",
              byteSize: 256,
              derivedPath:
                "derived/inbox/cap_synthetic_evidence_replay_001/attachments/att_voice_1/manifest.json",
              extractedText: "Redacted attachment text sentinel.",
              fileName: "voice-note.m4a",
              kind: "audio",
              mime: "audio/mp4",
              ordinal: 1,
              parseState: "succeeded",
              sha256: "b".repeat(64),
              storedPath:
                "raw/inbox/linq/cap_synthetic_evidence_replay_001/attachments/01__voice-note.m4a",
              transcriptText: null,
            },
          ],
        };
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot,
    });
    assert.equal(firstOutcome.status, "imported");

    const replayOutcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "canonical inbox projection unavailable on replay",
        );
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot,
    });
    assert.equal(replayOutcome.status, "imported");
    assert.equal(replayOutcome.reasonCode, "conversation-import.projection-failed");

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    const evidence = listed.events[0]?.attachmentEvidence;
    assert.equal(listed.events[0]?.projection.status, "succeeded");
    assert.equal(evidence?.status, "available");
    assert.equal(evidence?.reasonCode, null);
    assert.equal(evidence?.source, "hosted-inbox-projection");
    assert.equal(
      evidence?.optionalInboxCaptureId,
      "cap_synthetic_evidence_replay_001",
    );
    assert.equal(evidence?.attachments.length, 1);
    assert.equal(
      evidence?.attachments[0]?.raw?.path,
      "raw/inbox/linq/cap_synthetic_evidence_replay_001/attachments/01__voice-note.m4a",
    );
  });

  test("does not downgrade partial hosted attachment evidence after replayed projection failure", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-evidence-partial-replay-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_evidence_partial_replay_001",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic_evidence_partial_replay",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_synthetic_evidence_partial_replay",
          parts: [
            {
              attachmentId: "voice_part_1",
              fileName: "voice-note.m4a",
              mimeType: "audio/mp4",
              size: 256,
              type: "voice_memo",
              url: "redacted-attachment-url-sentinel",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    const item = createResolvedConversationMailboxItem({
      dedupeKey: decodedWake.eventId,
      id: "mailbox_item_evidence_partial_replay_001",
    });
    await writeVaultFile(
      vaultRoot,
      "raw/inbox/linq/cap_synthetic_evidence_partial_replay_001/attachments/01__voice-note.m4a",
      Buffer.from("audio bytes"),
    );

    const firstOutcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_evidence_partial_replay_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 1,
          },
        };
      },
      async loadAttachmentEvidenceCapture(input) {
        return {
          captureId: input.captureId,
          attachments: [
            {
              attachmentId: "att_voice_1",
              byteSize: 256,
              derivedPath:
                "derived/inbox/cap_synthetic_evidence_partial_replay_001/attachments/att_voice_1/manifest.json",
              extractedText: "Redacted attachment text sentinel.",
              fileName: "voice-note.m4a",
              kind: "audio",
              mime: "audio/mp4",
              ordinal: 1,
              parseState: "succeeded",
              sha256: "c".repeat(64),
              storedPath:
                "raw/inbox/linq/cap_synthetic_evidence_partial_replay_001/attachments/01__voice-note.m4a",
              transcriptText: null,
            },
          ],
        };
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot,
    });
    assert.equal(firstOutcome.status, "imported");

    const seeded = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    const inputId = seeded.events[0]?.inputId;
    if (!inputId) {
      throw new Error("Expected seeded hosted input event.");
    }
    await updateAssistantInputAttachmentEvidence({
      attachmentEvidence: {
        ...seeded.events[0]!.attachmentEvidence,
        reasonCode: "attachment.evidence_partial",
        status: "partial",
      },
      inputId,
      vault: vaultRoot,
    });

    const replayOutcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "canonical inbox projection unavailable on replay",
        );
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot,
    });
    assert.equal(replayOutcome.status, "imported");
    assert.equal(replayOutcome.reasonCode, "conversation-import.projection-failed");

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    const evidence = listed.events[0]?.attachmentEvidence;
    assert.equal(listed.events[0]?.projection.status, "succeeded");
    assert.equal(evidence?.status, "partial");
    assert.equal(evidence?.reasonCode, "attachment.evidence_partial");
    assert.equal(evidence?.source, "hosted-inbox-projection");
    assert.equal(evidence?.attachments.length, 1);
  });

  test("keeps hosted attachment evidence hydration failures nonblocking", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-evidence-failed-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_evidence_failed_001",
      message: {
        channel: "telegram",
        telegramMessage: {
          attachments: [
            {
              fileId: "telegram_photo_file_1",
              fileName: "private-photo.jpg",
              fileSize: 2048,
              kind: "photo",
              mimeType: "image/jpeg",
            },
          ],
          messageId: "777",
          schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
          text: "",
          threadId: "123456789",
        },
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_evidence_failed_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async loadAttachmentEvidenceCapture() {
        throw new Error("canonical capture detail unavailable");
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_evidence_failed_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events[0]?.projection.status, "succeeded");
    assert.equal(listed.events[0]?.projection.captureId, "cap_synthetic_evidence_failed_001");
    assert.equal(listed.events[0]?.attachmentEvidence.optionalInboxCaptureId, "cap_synthetic_evidence_failed_001");
    assert.equal(
      listed.events[0]?.attachmentEvidence.reasonCode,
      "conversation-import.attachment-evidence-failed",
    );
    assert.equal(listed.events[0]?.attachmentEvidence.source, "hosted-inbox-projection");
    assert.equal(listed.events[0]?.attachmentEvidence.status, "failed");
    assert.equal(listed.events[0]?.attachmentEvidence.attachments.length, 0);
  });

  test("classifies raw attachment materialization failures as partial evidence", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-raw-materialization-failed-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_raw_materialization_failed_001",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic_raw_materialization_failed",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_synthetic_raw_materialization_failed",
          parts: [
            {
              attachmentId: "zip_part_1",
              fileName: "archive.zip",
              mimeType: "application/zip",
              size: 512,
              type: "media",
              url: "https://signed.example.invalid/archive.zip",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_raw_materialization_failed_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async loadAttachmentEvidenceCapture() {
        throw Object.assign(new Error("raw attachment materialization failed"), {
          code: "RAW_MATERIALIZATION_FAILED",
        });
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_raw_materialization_failed_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    assert.equal(outcome.reasonCode, "attachment.evidence_partial");

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events[0]?.projection.status, "succeeded");
    assert.equal(listed.events[0]?.projection.reasonCode, null);
    assert.equal(listed.events[0]?.attachmentEvidence.status, "failed");
    assert.equal(
      listed.events[0]?.attachmentEvidence.reasonCode,
      "attachment.evidence_partial",
    );
    assert.equal(
      listed.events[0]?.attachmentEvidence.optionalInboxCaptureId,
      "cap_synthetic_raw_materialization_failed_001",
    );
  });

  test.each([
    ["ENOENT"],
    ["ATTACHMENT_MATERIALIZATION_FAILED"],
  ] as const)(
    "classifies %s attachment materialization failures as partial evidence",
    async (failureCode) => {
      const parentRoot = await mkdtemp(
        path.join(tmpdir(), "murph-hosted-input-raw-materialization-code-"),
      );
      tempRoots.push(parentRoot);
      const vaultRoot = path.join(parentRoot, "vault");
      const suffix = failureCode.toLowerCase();
      const decodedWake = createConversationWake({
        eventId: `evt_synthetic_${suffix}_001`,
        message: {
          channel: "linq",
          linqMessage: {
            chatId: `chat_synthetic_${suffix}`,
            from: "+15550100000",
            isFromMe: false,
            messageId: `msg_synthetic_${suffix}`,
            parts: [
              {
                attachmentId: "zip_part_1",
                fileName: "archive.zip",
                mimeType: "application/zip",
                size: 512,
                type: "media",
                url: "https://signed.example.invalid/archive.zip",
              },
            ],
          },
          phoneLookupKey: "redacted-contact-sentinel",
        },
      });

      const outcome = await importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        async importConversationWake() {
          return {
            captureId: `cap_synthetic_${suffix}_001`,
            metrics: {
              nextWakeAt: null,
              parserProcessed: 0,
            },
          };
        },
        async loadAttachmentEvidenceCapture() {
          throw Object.assign(new Error("raw attachment materialization failed"), {
            code: failureCode,
          });
        },
        async prepareWakeContext() {},
        item: createResolvedConversationMailboxItem({
          dedupeKey: decodedWake.eventId,
          id: `mailbox_item_${suffix}_001`,
        }),
        runtime: createRuntime(),
        vaultRoot,
      });

      assert.equal(outcome.status, "imported");
      assert.equal(outcome.reasonCode, "attachment.evidence_partial");

      const listed = await listAssistantInputEvents({
        vault: vaultRoot,
      });
      assert.equal(listed.events[0]?.projection.status, "succeeded");
      assert.equal(listed.events[0]?.projection.reasonCode, null);
      assert.equal(listed.events[0]?.attachmentEvidence.status, "failed");
      assert.equal(
        listed.events[0]?.attachmentEvidence.reasonCode,
        "attachment.evidence_partial",
      );
    },
  );

  test.each([
    ["SOME_UNKNOWN_CODE"],
    ["conversation-import.raw-email-missing"],
    ["x".repeat(128)],
  ] as const)(
    "keeps unallowlisted attachment evidence failure code %s generic",
    async (failureCode) => {
      const parentRoot = await mkdtemp(
        path.join(tmpdir(), "murph-hosted-input-attachment-evidence-code-"),
      );
      tempRoots.push(parentRoot);
      const vaultRoot = path.join(parentRoot, "vault");
      const decodedWake = createConversationWake({
        eventId: `evt_synthetic_attachment_evidence_${failureCode.length}_001`,
        message: {
          channel: "linq",
          linqMessage: {
            chatId: `chat_synthetic_attachment_evidence_${failureCode.length}`,
            from: "+15550100000",
            isFromMe: false,
            messageId: `msg_synthetic_attachment_evidence_${failureCode.length}`,
            parts: [
              {
                attachmentId: "zip_part_1",
                fileName: "archive.zip",
                mimeType: "application/zip",
                size: 512,
                type: "media",
                url: "https://signed.example.invalid/archive.zip",
              },
            ],
          },
          phoneLookupKey: "redacted-contact-sentinel",
        },
      });

      const outcome = await importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        async importConversationWake() {
          return {
            captureId: `cap_synthetic_attachment_evidence_${failureCode.length}_001`,
            metrics: {
              nextWakeAt: null,
              parserProcessed: 0,
            },
          };
        },
        async loadAttachmentEvidenceCapture() {
          throw Object.assign(new Error("attachment evidence unavailable"), {
            code: failureCode,
          });
        },
        async prepareWakeContext() {},
        item: createResolvedConversationMailboxItem({
          dedupeKey: decodedWake.eventId,
          id: `mailbox_item_attachment_evidence_${failureCode.length}_001`,
        }),
        runtime: createRuntime(),
        vaultRoot,
      });

      assert.equal(outcome.status, "imported");
      assert.equal(outcome.reasonCode, "conversation-import.attachment-evidence-failed");

      const listed = await listAssistantInputEvents({
        vault: vaultRoot,
      });
      assert.equal(listed.events[0]?.projection.status, "succeeded");
      assert.equal(
        listed.events[0]?.attachmentEvidence.reasonCode,
        "conversation-import.attachment-evidence-failed",
      );
    },
  );

  test("keeps Telegram conversation metadata hashed while replyTarget uses real thread and message ids", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-telegram-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_telegram_001",
      message: {
        channel: "telegram",
        telegramMessage: {
          attachments: [
            {
              fileId: "telegram_voice_file_1",
              fileName: "private-voice.ogg",
              fileSize: 4096,
              kind: "voice",
              mimeType: "audio/ogg",
            },
            {
              fileId: "telegram_unsafe_file_1",
              fileName: "../private-photo.jpg",
              fileSize: 2048,
              kind: "photo",
              mimeType: "image/jpeg",
            },
            {
              fileId: "telegram_dot_file_1",
              fileName: "..",
              fileSize: 64,
              kind: "document",
              mimeType: "application/octet-stream",
            },
          ],
          mediaGroupId: "album_7",
          messageId: "777",
          replyContextPreview: "Replying to: earlier Telegram message",
          schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
          text: "telegram hello",
          threadId: "123456789",
        },
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "canonical inbox projection unavailable",
        );
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_telegram_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    const event = listed.events[0]!;
    assert.equal(event.conversation?.source, "telegram");
    assert.equal(event.conversation?.threadIsDirect, true);
    assert.match(event.conversation?.accountId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.threadId ?? "", HASHED_IDENTIFIER_PATTERN);
    const replyTarget = event.replyTarget;
    assert.deepEqual(replyTarget, {
      channel: "telegram",
      messageId: "777",
      threadId: "123456789",
    });
    assert.ok(replyTarget);
    assert.equal(replyTarget.messageId?.startsWith("hid_"), false);
    assert.equal(replyTarget.threadId?.startsWith("hid_"), false);
    assert.deepEqual(event.sourceMetadata, {
      kind: "telegram",
      mediaGroupId: event.sourceMetadata?.kind === "telegram"
        ? event.sourceMetadata.mediaGroupId
        : null,
      replyContext: "Replying to: earlier Telegram message",
    });
    assert.match(
      event.sourceMetadata?.kind === "telegram"
        ? event.sourceMetadata.mediaGroupId ?? ""
        : "",
      HASHED_IDENTIFIER_PATTERN,
    );
    assert.equal(event.content.attachmentDescriptors.length, 3);
    assert.deepEqual(event.content.attachmentDescriptors[0], {
      attachmentId: event.content.attachmentDescriptors[0]?.attachmentId,
      contentType: "audio/ogg",
      fileName: "private-voice.ogg",
      kind: "voice",
      sizeBytes: 4096,
    });
    assert.deepEqual(event.content.attachmentDescriptors[1], {
      attachmentId: event.content.attachmentDescriptors[1]?.attachmentId,
      contentType: "image/jpeg",
      fileName: null,
      kind: "photo",
      sizeBytes: 2048,
    });
    assert.deepEqual(event.content.attachmentDescriptors[2], {
      attachmentId: event.content.attachmentDescriptors[2]?.attachmentId,
      contentType: "application/octet-stream",
      fileName: null,
      kind: "document",
      sizeBytes: 64,
    });
    assert.match(
      event.content.attachmentDescriptors[0]?.attachmentId ?? "",
      HASHED_IDENTIFIER_PATTERN,
    );
    assert.equal(JSON.stringify(event).includes("private-voice.ogg"), true);
    assert.equal(JSON.stringify(event).includes("../private-photo.jpg"), false);
    assert.equal(JSON.stringify(event).includes("album_7"), false);
  });

  test("caps staged assistant input text at the shared message budget", async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), "murph-hosted-input-long-"),
    );
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const fullText = "a".repeat(ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH + 512);
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_long_text_001",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic_long_text",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_synthetic_long_text",
          parts: [
            {
              type: "text",
              value: fullText,
            },
          ],
        },
        phoneLookupKey: "+15550100000",
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "canonical inbox projection unavailable",
        );
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_long_text_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    assert.equal(
      listed.events[0]?.content.text?.length,
      ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH,
    );
    assert.equal(
      listed.events[0]?.content.text,
      fullText.slice(0, ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH),
    );
  });

  test("keeps email conversation metadata hashed while replyTarget uses private thread authority", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-email-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_email_001",
      message: {
        channel: "email",
        identityId: "agentmail_inbox_synthetic",
        messageId: "email_message_synthetic_001",
        rawMessageKey: "raw_email_thread_authority",
        selfAddress: "assistant@example.test",
        threadKey: "email_thread_root_synthetic",
        threadTarget: serializeHostedEmailThreadTarget({
          lastMessageId: "email_message_synthetic_001",
          references: ["email_thread_root_synthetic"],
          subject: "Synthetic email",
          to: ["sender@example.test"],
        }),
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_email_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_email_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    const event = listed.events[0]!;
    assert.equal(event.conversation?.source, "email");
    assert.match(event.conversation?.accountId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.threadId ?? "", HASHED_IDENTIFIER_PATTERN);
    const replyTarget = event.replyTarget;
    assert.ok(replyTarget);
    assert.equal(replyTarget.channel, "email");
    assert.equal(replyTarget.messageId, "email_message_synthetic_001");
    assert.ok(replyTarget.threadId?.startsWith("hostedmail:"));
    assert.equal(JSON.stringify(event).includes("raw_email_thread_authority"), false);
    assert.equal(JSON.stringify(event).includes("agentmail_inbox_synthetic"), false);
    assert.equal(JSON.stringify(event).includes("assistant@example.test"), false);
  });

  test("decodes conversation.message through the injected seam and imports it through the local inbox path", async () => {
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_synthetic",
          from: "+15550100000",
          isFromMe: false,
          messageId: "msg_synthetic_import",
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
    const parserToolchain = {
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
          modelPath: "/app/test-parser-toolchain/ggml-test.bin",
        },
      },
    } satisfies NonNullable<NormalizedHostedAssistantRuntimeConfig["parserToolchain"]>;
    const decodeCalls: unknown[] = [];
    const importedWakeIds: string[] = [];
    const importedParserToolchains: NormalizedHostedAssistantRuntimeConfig["parserToolchain"][] = [];
    const preparedWakeIds: string[] = [];
    const preparedParserToolchains: NormalizedHostedAssistantRuntimeConfig["parserToolchain"][] = [];
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
        importedParserToolchains.push(input.runtime.parserToolchain);
        return {
          captureId: "cap_synthetic_conversation_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext(input) {
        order.push(`prepare:${input.wake.eventId}`);
        preparedWakeIds.push(input.wake.eventId);
        preparedParserToolchains.push(input.runtime.parserToolchain);
      },
      item,
      runtime: createRuntime({ parserToolchain }),
      stageAssistantInputEvent: createAssistantInputEventStager({
        order,
        projectionUpdates,
      }),
      vaultRoot: "synthetic-vault-root",
    });

    assert.deepEqual(decodeCalls, [
      {
        itemRef: {
          dedupeKey: "evt_synthetic_conversation_001",
          id: "mailbox_item_conversation_001",
          kind: "conversation.message",
          lane: "conversation",
          laneSeq: "1",
          occurredAt: TEST_NOW,
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
    assert.deepEqual(preparedParserToolchains, [parserToolchain]);
    assert.deepEqual(importedParserToolchains, [parserToolchain]);
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
    assert.equal(outcome.captureId, null);
    assert.deepEqual(outcome.metrics, {
      nextWakeAt: null,
      parserProcessed: 0,
    });
    assert.equal("afterCheckpoint" in outcome, false);
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

  test("treats local inbox import failures as post-checkpoint projection failures", async () => {
    const projectionUpdates: unknown[] = [];

    const outcome = await importHostedConversationMailboxItem({
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
    });
    if (outcome.status !== "imported") {
      throw new Error("Expected imported mailbox outcome.");
    }

    assert.deepEqual(outcome, {
      assistantInputId: "ain_00000000000000000000000000000000",
      captureId: null,
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      reasonCode: "conversation-import.projection-failed",
      status: "imported",
    });
    assert.equal("afterCheckpoint" in outcome, false);
    assert.deepEqual(projectionUpdates, [
      {
        captureId: null,
        reasonCode: "conversation-import.projection-failed",
        status: "failed",
      },
    ]);
  });

  test("does not collapse raw-copy projection failures into the generic projection reason", async () => {
    const projectionUpdates: unknown[] = [];

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(createConversationWake()),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "raw attachment copy failed",
          {
            cause: Object.assign(new Error("raw copy failed"), {
              code: "RAW_COPY_FAILED",
            }),
          },
        );
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem(),
      runtime: createRuntime(),
      stageAssistantInputEvent: createAssistantInputEventStager({
        projectionUpdates,
      }),
      vaultRoot: "synthetic-vault-root",
    });
    if (outcome.status !== "imported") {
      throw new Error("Expected imported mailbox outcome.");
    }

    assert.equal(outcome.reasonCode, "attachment.evidence_partial");
    assert.deepEqual(projectionUpdates, [
      {
        captureId: null,
        reasonCode: "attachment.evidence_partial",
        status: "failed",
      },
    ]);
  });

  test.each([
    ["SOME_UNKNOWN_CODE"],
    ["conversation-import.raw-email-missing"],
    ["x".repeat(128)],
  ] as const)(
    "keeps unallowlisted projection failure code %s generic",
    async (failureCode) => {
      const projectionUpdates: unknown[] = [];

      const outcome = await importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(createConversationWake()),
        async importConversationWake() {
          throw Object.assign(new Error("unexpected projection adapter failure"), {
            code: failureCode,
          });
        },
        async prepareWakeContext() {},
        item: createResolvedConversationMailboxItem(),
        runtime: createRuntime(),
        stageAssistantInputEvent: createAssistantInputEventStager({
          projectionUpdates,
        }),
        vaultRoot: "synthetic-vault-root",
      });
      if (outcome.status !== "imported") {
        throw new Error("Expected imported mailbox outcome.");
      }

      assert.equal(outcome.reasonCode, "conversation-import.projection-failed");
      assert.deepEqual(projectionUpdates, [
        {
          captureId: null,
          reasonCode: "conversation-import.projection-failed",
          status: "failed",
        },
      ]);
    },
  );

  test("returns partial post-checkpoint result when projection update fails", async () => {
    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(createConversationWake()),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_projection_update_failed_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem(),
      runtime: createRuntime(),
      stageAssistantInputEvent: async () => ({
        attachmentDescriptorCount: 0,
        inputId: "ain_00000000000000000000000000000000",
        async recordProjection() {
          throw new Error("projection update unavailable");
        },
      }),
      vaultRoot: "synthetic-vault-root",
    });
    if (outcome.status !== "imported") {
      throw new Error("Expected imported mailbox outcome.");
    }

    assert.equal(outcome.reasonCode, "conversation-import.projection-update-failed");
  });

  test("returns partial post-checkpoint result when attachment evidence update fails", async () => {
    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(createConversationWake()),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_attachment_evidence_update_failed_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async loadAttachmentEvidenceCapture() {
        return {
          attachments: [],
          captureId: "cap_synthetic_attachment_evidence_update_failed_001",
        };
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem(),
      runtime: createRuntime(),
      stageAssistantInputEvent: async () => ({
        attachmentDescriptorCount: 1,
        inputId: "ain_00000000000000000000000000000000",
        async recordAttachmentEvidence() {
          throw new Error("attachment evidence update unavailable");
        },
        async recordProjection() {},
      }),
      vaultRoot: "synthetic-vault-root",
    });
    if (outcome.status !== "imported") {
      throw new Error("Expected imported mailbox outcome.");
    }

    assert.equal(outcome.reasonCode, "conversation-import.attachment-evidence-update-failed");
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
    assert.equal("afterCheckpoint" in outcome, false);
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
    assert.equal("afterCheckpoint" in outcome, false);
  });

  test("keeps deterministic local-capture dedupe out of hosted cursor terms", async () => {
    const item = createResolvedConversationMailboxItem();
    const decodedWakes: HostedExecutionConversationMessageWake[] = [];
    const importItem = createHostedConversationMailboxImportItem({
      decodePayload: createDecodedPayloadDecoder(createConversationWake()),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_conversation_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      onDecodedConversationWake(wake) {
        decodedWakes.push(wake);
      },
      async prepareWakeContext() {},
      runtime: createRuntime(),
      stageAssistantInputEvent: createAssistantInputEventStager(),
      vaultRoot: "synthetic-vault-root",
    });

    const first = await importItem(item);
    const second = await importItem(item);
    if (first.status !== "imported" || second.status !== "imported") {
      throw new Error("Expected imported mailbox outcomes.");
    }
    assert.equal(decodedWakes.length, 2);
    assert.deepEqual(
      decodedWakes.map((wake) => wake.kind),
      ["conversation.message", "conversation.message"],
    );

    assert.deepEqual(
      first,
      {
        assistantInputId: "ain_00000000000000000000000000000000",
        captureId: null,
        metrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
        status: "imported",
      },
    );
    assert.deepEqual(
      second,
      {
        assistantInputId: "ain_00000000000000000000000000000000",
        captureId: null,
        metrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
        status: "imported",
      },
    );
    assert.equal("afterCheckpoint" in first, false);
    assert.equal("afterCheckpoint" in second, false);
    const serialized = JSON.stringify([first, second]);
    assert.equal(serialized.includes("runId"), false);
    assert.equal(serialized.includes("committedSeq"), false);
    assert.equal(serialized.includes("source_cursor"), false);
  });

  test("passes the mailbox import context signal to the local conversation importer", async () => {
    const controller = new AbortController();
    const observedSignals: Array<AbortSignal | null | undefined> = [];
    const importItem = createHostedConversationMailboxImportItem({
      decodePayload: createDecodedPayloadDecoder(createConversationWake()),
      async importConversationWake(input) {
        observedSignals.push(input.signal);
        return {
          captureId: null,
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

    const outcome = await importItem(
      createResolvedConversationMailboxItem(),
      { signal: controller.signal },
    );

    assert.equal(outcome.status, "imported");
    assert.equal(observedSignals[0], controller.signal);
  });

  test("rethrows local conversation import aborts instead of recording projection failure", async () => {
    const abortReason = new DOMException("Stopped", "AbortError");
    const controller = new AbortController();
    controller.abort(abortReason);
    const projectionUpdates: unknown[] = [];
    let importCalled = false;
    let stageCalled = false;

    await assert.rejects(
      () =>
        importHostedConversationMailboxItem({
          decodePayload: createDecodedPayloadDecoder(createConversationWake()),
          async importConversationWake() {
            importCalled = true;
            throw abortReason;
          },
          async prepareWakeContext() {},
          item: createResolvedConversationMailboxItem(),
          runtime: createRuntime(),
          signal: controller.signal,
          async stageAssistantInputEvent(input) {
            stageCalled = true;
            return createAssistantInputEventStager({
              projectionUpdates,
            })(input);
          },
          vaultRoot: "synthetic-vault-root",
        }),
      (error) => error === abortReason,
    );
    assert.equal(stageCalled, false);
    assert.equal(importCalled, false);
    assert.equal(projectionUpdates.length, 0);
  });

  test("keeps staged mailbox input imported when projection preparation fails", async () => {
    const item = createResolvedConversationMailboxItem();
    const projectionUpdates: unknown[] = [];

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(createConversationWake()),
      async importConversationWake() {
        throw new Error("import should not run after preparation failure");
      },
      async prepareWakeContext() {
        throw new Error("inbox projection init unavailable");
      },
      item,
      runtime: createRuntime(),
      stageAssistantInputEvent: createAssistantInputEventStager({
        projectionUpdates,
      }),
      vaultRoot: "synthetic-vault-root",
    });
    if (outcome.status !== "imported") {
      throw new Error("Expected imported mailbox outcome.");
    }

    assert.deepEqual(outcome, {
      assistantInputId: "ain_00000000000000000000000000000000",
      captureId: null,
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      reasonCode: "conversation-import.projection-failed",
      status: "imported",
    });
    assert.equal("afterCheckpoint" in outcome, false);
    assert.deepEqual(projectionUpdates, [
      {
        captureId: null,
        reasonCode: "conversation-import.projection-failed",
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

  test("stages missing raw email events as assistant input without waiting on inbox projection", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-raw-missing-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "email",
        from: "Sender <sender@example.test>",
        identityId: "identity_synthetic",
        rawMessageKey: "raw_email_missing",
        selfAddress: "assistant@example.test",
        subject: "Question about sauna",
        to: ["assistant@example.test"],
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
      vaultRoot,
    });
    if (outcome.status !== "imported") {
      throw new Error("Expected imported mailbox outcome.");
    }

    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.deepEqual(outcome, {
      assistantInputId: listed.events[0]?.inputId,
      captureId: null,
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      reasonCode: "conversation-import.raw-email-missing",
      status: "imported",
    });
    assert.equal("afterCheckpoint" in outcome, false);
    assert.equal(listed.events.length, 1);
    assert.equal(
      listed.events[0]?.content.text,
      [
        "Received an email message.",
        "Sender summary - Sender <sender@example.test>",
        "Recipient summary - assistant@example.test",
        "Email subject - Question about sauna",
        "Email body unavailable.",
      ].join("\n"),
    );
    assert.deepEqual(listed.events[0]?.sourceMetadata, {
      kind: "email",
      promptReady: false,
      promptUnavailableReason: "email.body_unavailable",
    });
    assert.equal(listed.events[0]?.projection.captureId, null);
    assert.equal(
      listed.events[0]?.projection.reasonCode,
      "conversation-import.raw-email-missing",
    );
    assert.equal(listed.events[0]?.projection.status, "failed");
    assert.ok(listed.events[0]?.projection.lastAttemptedAt);
    assert.equal(
      listed.events[0]?.projection.reasonCode,
      "conversation-import.raw-email-missing",
    );
  });

  test("stages hosted email input with minimized prompt-ready metadata and body preview", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-prompt-ready-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        attachmentSummaries: [
          {
            contentType: "application/pdf",
            fileName: "labs.pdf",
            sizeBytes: 321,
          },
        ],
        cc: ["helper@example.test"],
        channel: "email",
        from: "Sender <sender@example.test>",
        identityId: "identity_synthetic",
        messageId: "<message-123@example.test>",
        rawMessageKey: "raw_email_prompt_ready",
        selfAddress: "assistant@example.test",
        subject: "Question about sauna",
        textPreview: "Can you compare my sauna notes from this week?",
        threadTarget: "hostedmail:opaque-thread-target",
        to: ["assistant@example.test"],
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedRawEmailMessageMissingError({
          rawMessageKey: "raw_email_prompt_ready",
          userId: TEST_USER_ID,
        });
      },
      async prepareWakeContext() {},
      item,
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    const event = listed.events[0]!;
    assert.match(event.content.text ?? "", /Sender summary - Sender <sender@example\.test>/u);
    assert.match(event.content.text ?? "", /Recipient summary - assistant@example\.test/u);
    assert.match(event.content.text ?? "", /Cc summary - helper@example\.test/u);
    assert.match(event.content.text ?? "", /Email subject - Question about sauna/u);
    assert.match(
      event.content.text ?? "",
      /Email body preview - Can you compare my sauna notes from this week\?/u,
    );
    assert.deepEqual(event.sourceMetadata, {
      kind: "email",
      promptReady: true,
      promptUnavailableReason: null,
    });
    assert.deepEqual(event.content.attachmentDescriptors[0], {
      attachmentId: event.content.attachmentDescriptors[0]?.attachmentId,
      contentType: "application/pdf",
      fileName: "labs.pdf",
      kind: "email_attachment",
      sizeBytes: 321,
    });
    assert.equal(JSON.stringify(event).includes("labs.pdf"), true);
    assert.equal(event.replyTarget?.threadId, "hostedmail:opaque-thread-target");
  });

  test("makes five rapid staged mailbox conversation messages available without capture projection", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-rapid-input-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const stagedWakes: HostedExecutionConversationMessageWake[] = [];

    for (let index = 1; index <= 5; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const occurredAt = `2026-04-26T00:00:${String(index * 3).padStart(2, "0")}.000Z`;
      const wake = createConversationWake({
        eventId: `evt_synthetic_conversation_${suffix}`,
        message: {
          channel: "linq",
          linqMessage: {
            chatId: "chat_synthetic_rapid",
            from: "+15550100000",
            isFromMe: false,
            messageId: `msg_synthetic_rapid_${suffix}`,
            parts: [
              {
                type: "text",
                value: `rapid message ${index}`,
              },
            ],
          },
          phoneLookupKey: "+15550100000",
        },
        occurredAt,
      });
      stagedWakes.push(wake);
      const outcome = await importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(wake),
        async importConversationWake() {
          throw new HostedConversationInboxProjectionError(
            "canonical inbox projection delayed",
          );
        },
        async prepareWakeContext() {},
        item: createResolvedConversationMailboxItem({
          dedupeKey: wake.eventId,
          id: `mailbox_item_conversation_${suffix}`,
          laneSeq: String(index),
          occurredAt: wake.occurredAt,
        }),
        runtime: createRuntime(),
        vaultRoot,
      });
      assert.equal(outcome.status, "imported");
      assert.equal(outcome.reasonCode, "conversation-import.projection-failed");
    }
    const retryWake = stagedWakes[2]!;
    const retryOutcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(retryWake),
      async importConversationWake() {
        throw new HostedConversationInboxProjectionError(
          "canonical inbox projection delayed",
        );
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: retryWake.eventId,
        id: "mailbox_item_conversation_003",
        laneSeq: "3",
        occurredAt: retryWake.occurredAt,
      }),
      runtime: createRuntime(),
      vaultRoot,
    });
    assert.equal(retryOutcome.status, "imported");
    assert.equal(retryOutcome.reasonCode, "conversation-import.projection-failed");

    const pendingInputIds = await readHostedPendingAssistantInputIds({ vaultRoot });
    assert.equal(pendingInputIds.length, 5);
    const source = createHostedAssistantInputSource({
      selectedInputIds: pendingInputIds,
      vaultRoot,
    });
    const scannerInputs = await source.listInputCandidates({
      sourceId: "linq",
    });
    assert.deepEqual(
      scannerInputs.inputs.map((input) => input.event.text),
      [
        "rapid message 1",
        "rapid message 2",
        "rapid message 3",
        "rapid message 4",
        "rapid message 5",
      ],
    );
    assert.deepEqual(
      scannerInputs.inputs.map((input) => input.projection.status),
      ["failed", "failed", "failed", "failed", "failed"],
    );
    assert.deepEqual(
      scannerInputs.inputs.map((input) => input.event.replyTarget),
      [
        {
          channel: "linq",
          messageId: "msg_synthetic_rapid_001",
          threadId: "chat_synthetic_rapid",
        },
        {
          channel: "linq",
          messageId: "msg_synthetic_rapid_002",
          threadId: "chat_synthetic_rapid",
        },
        {
          channel: "linq",
          messageId: "msg_synthetic_rapid_003",
          threadId: "chat_synthetic_rapid",
        },
        {
          channel: "linq",
          messageId: "msg_synthetic_rapid_004",
          threadId: "chat_synthetic_rapid",
        },
        {
          channel: "linq",
          messageId: "msg_synthetic_rapid_005",
          threadId: "chat_synthetic_rapid",
        },
      ],
    );
    assert.equal(
      scannerInputs.inputs.some((input) =>
        input.event.replyTarget?.messageId?.startsWith("hid_")
        || input.event.replyTarget?.threadId?.startsWith("hid_")
      ),
      false,
    );

    const conversation = scannerInputs.inputs[0]?.event.conversation;
    assert.ok(conversation);
    const activeTurnInputs = await source.listNewConversationInputs({
      afterCursor: null,
      conversation,
      knownProjectionCaptureIds: [],
    });
    assert.deepEqual(
      activeTurnInputs.inputs.map((input) => input.event.text),
      [
        "rapid message 1",
        "rapid message 2",
        "rapid message 3",
        "rapid message 4",
        "rapid message 5",
      ],
    );
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
      payloadSchema: item.payloadInlineCiphertext
        ? item.payloadSchema
        : HOSTED_MAILBOX_PAYLOAD_SCHEMA,
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

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  bytes: Buffer,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

type RuntimeTestConfigInput = Partial<Pick<
  NormalizedHostedAssistantRuntimeConfig,
  | "forwardedEnv"
  | "parserToolchain"
  | "platformEnv"
  | "resolvedConfig"
  | "userEnv"
>> & {
  platform?: Partial<NormalizedHostedAssistantRuntimeConfig["platform"]>;
};

function createRuntime(input: RuntimeTestConfigInput = {}): Pick<
  NormalizedHostedAssistantRuntimeConfig,
  | "forwardedEnv"
  | "parserToolchain"
  | "platform"
  | "platformEnv"
  | "resolvedConfig"
  | "userEnv"
> {
  return {
    forwardedEnv: input.forwardedEnv ?? {},
    parserToolchain: input.parserToolchain ?? null,
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
      ...(input.platform ?? {}),
    },
    platformEnv: input.platformEnv ?? {},
    resolvedConfig: input.resolvedConfig ?? {
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
        whatsappCloudApiConfigured: false,
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
    userEnv: input.userEnv ?? {},
  };
}

async function withOperatorHomeRoot<T>(
  operatorHomeRoot: string,
  run: () => Promise<T>,
): Promise<T> {
  const previousHome = process.env.HOME;
  process.env.HOME = operatorHomeRoot;

  try {
    return await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}
