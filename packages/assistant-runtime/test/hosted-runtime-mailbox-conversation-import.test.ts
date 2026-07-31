import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { VAULT_LAYOUT } from "@murphai/contracts";
import {
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  readHostedLinqConversationMessageAccountLookupKey,
} from "@murphai/hosted-execution/contracts";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
  hashNullableHostedAssistantConversationIdentifier,
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
  createAssistantActiveTurnInputController,
  listAssistantInputEvents,
  resolveAssistantConversationLookupKey,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
} from "@murphai/assistant-engine";
import {
  reconcileManagedAssistantAutoReplyChannelsLocal,
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
  compactHostedPendingAssistantInputIds,
  readHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
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
import {
  resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs,
} from "../src/hosted-runtime/workspace-runner.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_conversation_import";
const HASHED_IDENTIFIER_PATTERN = /^hid_[0-9a-f]{32}$/u;
const HOSTED_ASSISTANT_SEED_ENV = {
  HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
  HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
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
  test("keeps link-only Linq input on the replay-compatible projection path", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-link-input-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_link_only",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_link_only",
          parts: [
            {
              type: "link",
              value: "https://example.invalid/link-only",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    const prepareWakeContext = vi.fn(async () => {});
    const interruption = new Error("synthetic rollout interruption");
    const signalController = new AbortController();
    let importAttempt = 0;
    const importConversationWake = vi.fn(async () => {
      importAttempt += 1;
      if (importAttempt === 1) {
        signalController.abort(interruption);
        throw interruption;
      }
      return {
        captureId: "cap_link_only",
        metrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
      };
    });
    const item = createResolvedConversationMailboxItem();

    await assert.rejects(
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        importConversationWake,
        prepareWakeContext,
        item,
        runtime: createRuntime(),
        signal: signalController.signal,
        vaultRoot,
      }),
      (error: unknown) => error === interruption,
    );

    const listed = await listAssistantInputEvents({ vault: vaultRoot });
    assert.equal(listed.events.length, 1);
    assert.equal(
      listed.events[0]?.content.text,
      "Received a Linq message.",
    );
    assert.equal(listed.events[0]?.content.attachmentDescriptors.length, 0);
    assert.equal(listed.events[0]?.projection.status, "pending");
    assert.equal(listed.events[0]?.projection.captureId, null);

    const replay = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      importConversationWake,
      prepareWakeContext,
      item,
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(replay.status, "imported");
    const replayed = await listAssistantInputEvents({ vault: vaultRoot });
    assert.equal(replayed.events[0]?.content.text, "Received a Linq message.");
    assert.equal(replayed.events[0]?.projection.status, "succeeded");
    assert.equal(replayed.events[0]?.projection.captureId, "cap_link_only");
    expect(prepareWakeContext).toHaveBeenCalledTimes(2);
    expect(importConversationWake).toHaveBeenCalledTimes(2);
  });

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
          threadIsDirect: null,
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
      service: null,
      target: "chat_synthetic",
      threadIsDirect: null,
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
    assert.notEqual(event.sourceRef.itemId, item.item.id);
    const hydratedInputs = await createHostedAssistantInputSource({
      pendingInputRefreshMode: "none",
      selectedInputIds: [event.inputId],
      vaultRoot,
    }).listInputCandidates({
      sourceId: "linq",
    });
    assert.equal(
      hydratedInputs.inputs[0]?.event.hostedMailboxItemId,
      item.item.id,
    );
    assert.match(event.conversation?.accountId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.actorId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.match(event.conversation?.threadId ?? "", HASHED_IDENTIFIER_PATTERN);
    assert.equal(event.conversation?.threadIsDirect, null);
    const replyTarget = event.replyTarget;
    assert.deepEqual(replyTarget, {
      channel: "linq",
      messageId: "msg_synthetic_projection_failure",
      threadId: "chat_synthetic",
    });
    assert.deepEqual(event.sourceMetadata, {
      externalThreadRouteAuthorityPresent: false,
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

  test("notifies active turn input after staging and before inbox projection completes", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-early-notify-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_early_notify",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_early_notify",
          parts: [
            {
              type: "text",
              value: "please fold this into the turn",
            },
            {
              attachmentId: "att_early_notify",
              fileName: "voice.m4a",
              mimeType: "audio/mp4",
              size: 12_345,
              type: "voice_memo",
              url: "redacted-attachment-url-sentinel",
            },
          ],
          threadIsDirect: true,
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    const notificationObserved = createDeferred<void>();
    const projectionRelease = createDeferred<void>();
    const signalController = new AbortController();
    const order: string[] = [];
    const controller = createAssistantActiveTurnInputController({
      admissionHook: async (input) => {
        assert.equal(input.signal, signalController.signal);
        order.push("notify");
        notificationObserved.resolve(undefined);
        return {
          kind: "no-new-input",
        };
      },
      conversationKeys: [createLinqConversationLookupKey({ item, wake: decodedWake })],
      sessionId: "session_early_notify",
      turnId: "turn_early_notify",
      vault: vaultRoot,
    });

    const importPromise = importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        order.push("projection-started");
        await projectionRelease.promise;
        order.push("projection-finished");
        return {
          captureId: null,
          metrics: {
            nextWakeAt: null,
            parserProcessed: 0,
          },
        };
      },
      async prepareWakeContext() {
        order.push("projection-prepared");
      },
      item,
      onConversationActivityObserved() {
        order.push("activity-callback");
      },
      onConversationInputStaged(channel) {
        assert.equal(channel, "linq");
        order.push("staged-callback");
      },
      runtime: createRuntime(),
      signal: signalController.signal,
      vaultRoot,
    });

    try {
      await notificationObserved.promise;
      assert.deepEqual(order, ["activity-callback", "staged-callback", "notify"]);

      projectionRelease.resolve(undefined);
      const outcome = await importPromise;
      if (outcome.status !== "imported") {
        throw new Error("Expected imported mailbox outcome.");
      }

      const listed = await listAssistantInputEvents({ vault: vaultRoot });
      assert.equal(listed.events.length, 1);
      assert.deepEqual(order, [
        "activity-callback",
        "staged-callback",
        "notify",
        "projection-prepared",
        "projection-started",
        "projection-finished",
      ]);
      assert.equal(outcome.assistantInputId, listed.events[0]?.inputId);
      assert.equal(outcome.captureId, null);
      assert.deepEqual(outcome.metrics, {
        nextWakeAt: null,
        parserProcessed: 0,
      });
      assert.equal(typeof outcome.conversationImportTiming?.projectionPrepareMs, "number");
      assert.equal(typeof outcome.conversationImportTiming?.projectionImportMs, "number");
      assert.equal(typeof outcome.conversationImportTiming?.projectionTotalMs, "number");
      assert.equal("attachmentEvidenceMs" in (outcome.conversationImportTiming ?? {}), false);
      assert.equal(outcome.linqDeliveryContext?.replyToMessageId, "msg_early_notify");
      assert.equal("reasonCode" in outcome, false);
      assert.equal("afterCheckpoint" in outcome, false);
    } finally {
      projectionRelease.resolve(undefined);
      controller.close();
      await importPromise.catch(() => undefined);
    }
  });

  test("does not offer process preparation for self-authored Linq input", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-self-input-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_self_input",
          from: "redacted-self-sentinel",
          isFromMe: true,
          messageId: "msg_self_input",
          parts: [
            {
              type: "text",
              value: "self-authored message",
            },
          ],
          threadIsDirect: true,
        },
        phoneLookupKey: "redacted-self-sentinel",
      },
    });
    let activityCallbackCount = 0;
    let preparationCallbackCount = 0;

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
        id: "mailbox_item_self_input",
      }),
      onConversationActivityObserved() {
        activityCallbackCount += 1;
      },
      onConversationInputStaged() {
        preparationCallbackCount += 1;
      },
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    assert.equal(activityCallbackCount, 1);
    assert.equal(preparationCallbackCount, 0);
  });

  test("does not notify active turn input early for durably consumed replay imports", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-replay-notify-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_replay_notify",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_replay_notify",
          parts: [
            {
              type: "text",
              value: "already consumed",
            },
          ],
          threadIsDirect: true,
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    const item: HostedMailboxResolvedImportItem = {
      ...createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_replay_notify",
      }),
      durablyConsumed: true,
    };
    let notificationCount = 0;
    const controller = createAssistantActiveTurnInputController({
      admissionHook: async () => {
        notificationCount += 1;
        return {
          kind: "no-new-input",
        };
      },
      conversationKeys: [createLinqConversationLookupKey({ item, wake: decodedWake })],
      sessionId: "session_replay_notify",
      turnId: "turn_replay_notify",
      vault: vaultRoot,
    });

    try {
      let activityCallbackCount = 0;
      let stagedCallbackCount = 0;
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
        onConversationActivityObserved() {
          activityCallbackCount += 1;
        },
        onConversationInputStaged() {
          stagedCallbackCount += 1;
        },
        runtime: createRuntime(),
        vaultRoot,
      });

      assert.equal(outcome.status, "imported");
      assert.equal(notificationCount, 0);
      assert.equal(activityCallbackCount, 0);
      assert.equal(stagedCallbackCount, 0);
    } finally {
      controller.close();
    }
  });

  test("keeps mailbox import imported when early active turn notification fails", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-notify-failure-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_notify_failure",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_notify_failure",
          parts: [
            {
              type: "text",
              value: "still import me",
            },
          ],
          threadIsDirect: true,
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    let notificationAttempts = 0;
    const controller = createAssistantActiveTurnInputController({
      admissionHook: async () => {
        notificationAttempts += 1;
        throw new Error("synthetic active-turn notify failure");
      },
      conversationKeys: [createLinqConversationLookupKey({ item, wake: decodedWake })],
      sessionId: "session_notify_failure",
      turnId: "turn_notify_failure",
      vault: vaultRoot,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
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
        onConversationInputStaged() {
          throw new Error("synthetic staged callback failure");
        },
        runtime: createRuntime(),
        vaultRoot,
      });

      if (outcome.status !== "imported") {
        throw new Error("Expected imported mailbox outcome.");
      }
      const listed = await listAssistantInputEvents({ vault: vaultRoot });
      assert.equal(notificationAttempts, 1);
      assert.equal(warn.mock.calls.length > 0, true);
      assert.deepEqual(outcome, {
        assistantInputId: listed.events[0]?.inputId,
        captureId: null,
        linqDeliveryContext: {
          directRecipientPhoneNumber: "redacted-contact-sentinel",
          fromPhoneNumber: null,
          replyToMessageId: "msg_notify_failure",
          routeAuthority: null,
          service: null,
          target: "chat_notify_failure",
          threadIsDirect: true,
        },
        metrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
        status: "imported",
      });
    } finally {
      warn.mockRestore();
      controller.close();
    }
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
    assert.equal("assistantInputId" in outcome, false);
    if (outcome.status === "imported") {
      assert.equal(outcome.reasonCode ?? null, null);
    }
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

  test("adds conversation import stage timings to staged trace callbacks", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-import-timing-"));
    tempRoots.push(parentRoot);
    const operatorHomeRoot = path.join(parentRoot, "home");
    const vaultRoot = path.join(parentRoot, "vault");
    await writeVaultFile(vaultRoot, VAULT_LAYOUT.metadata, Buffer.from("{}\n"));
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_import_timing_001",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_import_timing",
          from: "redacted-contact-sentinel",
          isFromMe: false,
          messageId: "msg_import_timing",
          parts: [
            {
              type: "text",
              value: "timing",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    const item = createResolvedConversationMailboxItem({
      dedupeKey: decodedWake.eventId,
      id: "mailbox_item_import_timing_001",
    });
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];

    let conversationActivityCount = 0;
    let foregroundStagedCount = 0;
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
        onConversationActivityObserved() {
          conversationActivityCount += 1;
        },
        onConversationInputStaged() {
          foregroundStagedCount += 1;
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
        stageAssistantInputEvent: async () => ({
          inputId: "input_import_timing",
          async recordProjection() {},
        }),
        vaultRoot,
      })
    );

    assert.equal(outcome.status, "imported");
    assert.equal(conversationActivityCount, 1);
    assert.equal(foregroundStagedCount, 0);
    assert.equal(latencyTraceRequests.length, 1);
    const event = latencyTraceRequests[0]?.event;
    assert.equal(event?.type, "assistant_input_staged");
    if (!event || event.type !== "assistant_input_staged") {
      throw new Error("Expected assistant input staged latency trace event.");
    }
    const importBreakdown = event.phaseBreakdown?.import;
    if (!importBreakdown) {
      throw new Error("Expected conversation import phase breakdown.");
    }
    const {
      autoReplyPreparedAtEpochMs,
      decodeDoneAtEpochMs,
      decodeStartedAtEpochMs,
      pendingIndexEnsuredAtEpochMs,
      stagedAtEpochMs,
    } = importBreakdown;
    if (
      typeof decodeStartedAtEpochMs !== "number"
      || typeof decodeDoneAtEpochMs !== "number"
      || typeof autoReplyPreparedAtEpochMs !== "number"
      || typeof pendingIndexEnsuredAtEpochMs !== "number"
      || typeof stagedAtEpochMs !== "number"
    ) {
      throw new Error("Expected numeric conversation import timing diagnostics.");
    }
    assert.ok(decodeStartedAtEpochMs <= decodeDoneAtEpochMs);
    assert.ok(decodeDoneAtEpochMs <= autoReplyPreparedAtEpochMs);
    assert.ok(autoReplyPreparedAtEpochMs <= pendingIndexEnsuredAtEpochMs);
    assert.ok(pendingIndexEnsuredAtEpochMs <= stagedAtEpochMs);
    assert.deepEqual(event.phaseBreakdown?.wake, {
      foregroundImportStartedAtEpochMs: 1_777_000_000_300,
      foregroundWaitResolvedAtEpochMs: 1_777_000_000_200,
    });
  });

  test("records Telegram staged trace callbacks with Telegram source", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-telegram-latency-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem({
      dedupeKey: "evt_synthetic_telegram_latency_001",
      id: "mailbox_item_telegram_latency_001",
    });
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_telegram_latency_001",
      message: {
        channel: "telegram",
        telegramMessage: {
          attachments: [],
          messageId: "987654",
          schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
          text: "telegram latency trace message body",
          threadId: "telegram_chat_latency",
        },
      },
    });
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];

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
      runtimeAttemptId: "attempt_telegram_latency_trace_1",
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    expect(latencyTraceRequests.map((request) => request.event)).toEqual([
      expect.objectContaining({
        mailboxItemId: "mailbox_item_telegram_latency_001",
        runtimeAttemptId: "attempt_telegram_latency_trace_1",
        source: "telegram",
        type: "assistant_input_staged",
      }),
    ]);
    assert.equal(
      JSON.stringify(latencyTraceRequests).includes("telegram latency trace message body"),
      false,
    );
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
    assert.equal(event.sourceMetadata, null);
    assert.deepEqual(
      await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
        inputIds: [event.inputId],
        memberId: TEST_USER_ID,
        vaultRoot,
      }),
      {
        channel: "telegram",
        replyToMessageId: "777",
        target: "123456789",
      },
    );
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

  test("does not resurrect either class of ambiguous v1-omitted Telegram input", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-legacy-v1-"));
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
    const configuredRuntime = createRuntime({
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: true,
        },
        deviceSync: null,
        managedAutoReplyChannels: [{
          capabilityReady: true,
          channel: "telegram",
          memberChannel: "telegram",
        }],
      },
      userEnv: HOSTED_ASSISTANT_SEED_ENV,
    });
    const importConversationWake = async () => ({
      captureId: null,
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
    });
    const admittedWake = createConversationWake({
      eventId: "evt_synthetic_telegram_legacy_admitted",
      message: {
        channel: "telegram",
        telegramMessage: {
          attachments: [],
          messageId: "781",
          schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
          text: "admitted before the legacy channel became unavailable",
          threadId: "123456789",
        },
      },
    });
    const admitted = await withOperatorHomeRoot(operatorHomeRoot, () =>
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(admittedWake),
        importConversationWake,
        item: createResolvedConversationMailboxItem({
          dedupeKey: admittedWake.eventId,
          id: "mailbox_item_telegram_legacy_admitted",
          laneSeq: "10",
        }),
        runtime: configuredRuntime,
        vaultRoot,
      })
    );
    assert.equal(admitted.status, "imported");
    assert.equal("assistantInputId" in admitted, true);
    const admittedInputId = "assistantInputId" in admitted
      ? admitted.assistantInputId
      : null;
    assert.notEqual(admittedInputId, null);
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), [
      admittedInputId,
    ]);

    await saveAssistantAutomationState(vaultRoot, {
      autoReply: [],
      updatedAt: "2026-04-26T00:01:00.000Z",
      version: 1,
    });
    const contextWake = createConversationWake({
      eventId: "evt_synthetic_telegram_legacy_context",
      message: {
        channel: "telegram",
        telegramMessage: {
          attachments: [],
          messageId: "782",
          schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
          text: "context retained while Telegram reply was unavailable",
          threadId: "123456789",
        },
      },
    });
    const contextOnly = await withOperatorHomeRoot(operatorHomeRoot, () =>
      importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(contextWake),
        importConversationWake,
        item: createResolvedConversationMailboxItem({
          dedupeKey: contextWake.eventId,
          id: "mailbox_item_telegram_legacy_context",
          laneSeq: "20",
        }),
        runtime: createRuntime(),
        vaultRoot,
      })
    );
    assert.equal(contextOnly.status, "imported");
    assert.equal("assistantInputId" in contextOnly, false);
    const retained = await listAssistantInputEvents({ vault: vaultRoot });
    assert.equal(retained.events.length, 2);

    const filePath = resolveHostedPendingAssistantInputStatePath(vaultRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({
      schema: "murph.hosted-pending-assistant-inputs.v1",
      schemaVersion: 1,
      value: {
        backfilled: true,
        inputIds: [],
      },
    }, null, 2)}\n`, "utf8");
    const enabled = await reconcileManagedAssistantAutoReplyChannelsLocal({
      desiredChannels: ["telegram"],
      vault: vaultRoot,
    });
    assert.deepEqual(enabled.state.autoReply, [{
      channel: "telegram",
      eligibleAfter: retained.events.at(-1)!.cursor,
      enabledAt: retained.events.at(-1)!.cursor.createdAt,
    }]);

    assert.deepEqual(await compactHostedPendingAssistantInputIds({ vaultRoot }), []);
    assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), []);
    const migrated = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(migrated.schema, "murph.hosted-pending-assistant-inputs.v2");
    assert.equal(migrated.schemaVersion, 2);
  });

  test("does not enqueue input when the hosted assistant is unconfigured", async () => {
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
            {
              type: "link",
              value: "https://example.invalid/context",
            },
          ],
        },
        phoneLookupKey: "redacted-contact-sentinel",
      },
    });
    let activeTurnAdmissionCount = 0;
    const controller = createAssistantActiveTurnInputController({
      admissionHook: async () => {
        activeTurnAdmissionCount += 1;
        return {
          kind: "no-new-input",
        };
      },
      conversationKeys: [createLinqConversationLookupKey({ item, wake: decodedWake })],
      sessionId: "session_unconfigured",
      turnId: "turn_unconfigured",
      vault: vaultRoot,
    });
    let stagedCallbackCount = 0;

    try {
      const outcome = await withOperatorHomeRoot(operatorHomeRoot, () =>
        importHostedConversationMailboxItem({
          decodePayload: createDecodedPayloadDecoder(decodedWake),
          item,
          onConversationInputStaged() {
            stagedCallbackCount += 1;
          },
          runtime: createRuntime(),
          vaultRoot,
        })
      );

      assert.equal(outcome.status, "imported");
      assert.equal("assistantInputId" in outcome, false);
      assert.equal(activeTurnAdmissionCount, 0);
      assert.equal(stagedCallbackCount, 0);
      const listed = await listAssistantInputEvents({
        vault: vaultRoot,
      });
      assert.notEqual(listed.events[0]?.projection.status, "not_attempted");
      assert.deepEqual(listed.events[0]?.replyTarget, {
        channel: "linq",
        messageId: "msg_unconfigured",
        threadId: "chat_unconfigured",
      });
      assert.deepEqual(await readHostedPendingAssistantInputIds({ vaultRoot }), []);
    } finally {
      controller.close();
    }
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

  test("uses the Linq email contact lookup as the assistant conversation identity seed", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-email-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const contactLookupKey = "hbidx:email:v1:mailbox";
    const groupReactionContext = "unauthorized group reaction context sentinel";
    const decodedWake = createConversationWake({
      message: {
        channel: "linq",
        contactKind: "email",
        contactLookupKey,
        groupParticipantAdded: true,
        groupReactionContext,
        linqMessage: {
          affirmativeReaction: true,
          chatId: "chat_email_identity",
          from: "buddy@example.test",
          isFromMe: false,
          messageId: "msg_email_identity",
          parts: [
            {
              type: "text",
              value: "Reacted with a like reaction.",
            },
          ],
          reactionEligible: false,
          replyToMessageId: "msg_murph_123",
          service: "iMessage",
          threadIsDirect: false,
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
      affirmativeReaction: true,
      externalThreadRouteAuthorityPresent: false,
      kind: "linq",
      partCount: 1,
      reactionEligible: false,
      replyToMessageId: "msg_murph_123",
      service: "iMessage",
    });
    assert.equal(JSON.stringify(event).includes(groupReactionContext), false);

    const source = createHostedAssistantInputSource({
      pendingInputRefreshMode: "none",
      selectedInputIds: [event.inputId],
      vaultRoot,
    });
    const candidates = await source.listInputCandidates({ sourceId: "linq" });
    assert.equal(candidates.inputs[0]?.event.groupParticipantAdded, undefined);
    assert.equal(candidates.inputs[0]?.event.groupReactionContext, undefined);
  });

  test("uses Telegram sender for blinded actor identity and prompt attribution", async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), "murph-hosted-input-telegram-group-"),
    );
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      message: {
        channel: "telegram",
        routeAuthority: {
          channel: "telegram",
          containerMemberId: TEST_USER_ID,
          threadId: "chat_group_telegram",
        },
        senderMemberId: "member_sender_private_123",
        telegramMessage: {
          from: "1234567890",
          messageId: "tg_group_identity",
          schema: "murph.hosted-telegram-message.v1",
          senderDisplayName: "Alice Example",
          senderUsername: "alice_example",
          text: "hello group",
          threadId: "chat_group_telegram",
          threadIsDirect: false,
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
        id: "mailbox_item_telegram_group_identity_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");

    const listed = await listAssistantInputEvents({ vault: vaultRoot });
    const event = listed.events[0];
    assert.ok(event);
    const identifierBlind = createHostedAssistantConversationIdentifierBlind({
      secret: "chat_group_telegram",
      userId: TEST_USER_ID,
    });
    const expectedActorId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      "1234567890",
    );
    const expectedThreadId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      "chat_group_telegram",
    );

    // The blinded actor must derive from the same value stored for the prompt
    // so batching and admission cannot disagree about who spoke.
    assert.equal(event.conversation?.actorId, expectedActorId);
    assert.notEqual(event.conversation?.actorId, null);
    assert.equal(event.conversation?.source, "telegram");
    assert.equal(event.conversation?.threadId, expectedThreadId);
    assert.equal(event.conversation?.threadIsDirect, false);
    assert.equal(event.replyTarget?.threadId, "chat_group_telegram");
    assert.equal(
      event.sourceMetadata?.kind === "telegram"
        ? event.sourceMetadata.senderHandle
        : null,
      "1234567890",
    );
    assert.equal(
      event.sourceMetadata?.kind === "telegram"
        ? event.sourceMetadata.senderDisplayName
        : null,
      "Alice Example",
    );
    assert.equal(
      event.sourceMetadata?.kind === "telegram"
        ? event.sourceMetadata.senderUsername
        : null,
      "alice_example",
    );
    assert.equal(
      JSON.stringify(event).includes("member_sender_private_123"),
      false,
    );
  });

  test("keeps direct Telegram threads free of group sender attribution", async () => {
    const parentRoot = await mkdtemp(
      path.join(tmpdir(), "murph-hosted-input-telegram-direct-"),
    );
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      message: {
        channel: "telegram",
        telegramMessage: {
          messageId: "tg_direct_identity",
          replyContextPreview: "Replying to: earlier",
          schema: "murph.hosted-telegram-message.v1",
          text: "hello",
          threadId: "chat_direct_telegram",
          threadIsDirect: true,
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
        id: "mailbox_item_telegram_direct_identity_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");

    const listed = await listAssistantInputEvents({ vault: vaultRoot });
    const event = listed.events[0];
    assert.ok(event);
    assert.equal(event.conversation?.actorId, null);
    assert.equal(event.conversation?.threadIsDirect, true);
    assert.equal(
      Object.hasOwn(event.sourceMetadata ?? {}, "senderHandle"),
      false,
    );
    assert.equal(
      Object.hasOwn(event.sourceMetadata ?? {}, "senderDisplayName"),
      false,
    );
    assert.equal(
      Object.hasOwn(event.sourceMetadata ?? {}, "senderUsername"),
      false,
    );
  });

  test("uses Linq route account, sender actor, and group directness for assistant conversation identity", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-linq-group-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const accountLookupKey = "hbidx:phone:v1:route-account";
    const contactLookupKey = "hbidx:phone:v1:participant";
    const groupReactionContext =
      "Participant +15551110000 added a like reaction on: first message\nParticipant +15552220000 added a laugh reaction on: second message";
    const groupRunningBit = {
      expiresAt: "2026-07-28T12:00:00.000Z",
      publicAlias: "Fiscal Department",
      requestedBit: "Treat me like the exhausted CFO.",
      schema: "murph.group-sponsorship-bit.v1" as const,
    };
    const decodedWake = createConversationWake({
      message: {
        accountLookupKey,
        channel: "linq",
        contactKind: "phone",
        contactLookupKey,
        groupParticipantAdded: true,
        groupReactionContext,
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
        routeAuthority: {
          accountLookupKey,
          channel: "linq",
          containerMemberId: TEST_USER_ID,
          threadId: "chat_group_identity",
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
      item: {
        ...createResolvedConversationMailboxItem({
          dedupeKey: decodedWake.eventId,
          id: "mailbox_item_linq_group_identity_001",
        }),
        groupRunningBit,
        usageRunningLow: true,
      },
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
    const expectedActorId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      "+15551110000",
    );
    const expectedThreadId = hashHostedAssistantConversationIdentifier(
      identifierBlind,
      "chat_group_identity",
    );

    assert.equal(event.conversation?.accountId, expectedAccountId);
    assert.notEqual(event.conversation?.accountId, unexpectedSenderAccountId);
    assert.equal(event.conversation?.actorId, expectedActorId);
    assert.equal(event.conversation?.source, "linq");
    assert.equal(event.conversation?.threadId, expectedThreadId);
    assert.equal(event.conversation?.threadIsDirect, false);
    assert.equal(
      event.sourceMetadata?.kind === "linq"
        ? event.sourceMetadata.externalThreadRouteAuthorityPresent
        : false,
      true,
    );
    assert.equal(
      event.sourceMetadata?.kind === "linq"
        ? event.sourceMetadata.senderHandle
        : null,
      "+15551110000",
    );
    assert.equal(
      Object.hasOwn(event.sourceMetadata ?? {}, "groupParticipantAdded"),
      false,
    );
    assert.equal(
      Object.hasOwn(event.sourceMetadata ?? {}, "groupReactionContext"),
      false,
    );
    assert.equal(Object.hasOwn(event, "usageRunningLow"), false);
    assert.equal(JSON.stringify(event).includes(groupReactionContext), false);
    assert.equal(event.replyTarget?.threadId, "chat_group_identity");

    const source = createHostedAssistantInputSource({
      pendingInputRefreshMode: "none",
      selectedInputIds: [event.inputId],
      vaultRoot,
    });
    const candidates = await source.listInputCandidates({ sourceId: "linq" });
    assert.equal(candidates.inputs[0]?.event.groupParticipantAdded, true);
    assert.equal(
      candidates.inputs[0]?.event.groupReactionContext,
      groupReactionContext,
    );
    assert.equal(candidates.inputs[0]?.event.usageRunningLow, true);
    assert.deepEqual(
      candidates.inputs[0]?.event.groupRunningBit,
      groupRunningBit,
    );
  });

  test("does not project participant-addition context for a route-authorized direct chat", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-linq-direct-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const accountLookupKey = "hbidx:phone:v1:route-account";
    const contactLookupKey = "hbidx:phone:v1:participant";
    const groupReactionContext = "direct group reaction context sentinel";
    const decodedWake = createConversationWake({
      message: {
        accountLookupKey,
        channel: "linq",
        contactKind: "phone",
        contactLookupKey,
        groupParticipantAdded: true,
        groupReactionContext,
        linqMessage: {
          chatId: "chat_direct_identity",
          from: "+15551110000",
          isFromMe: false,
          messageId: "msg_direct_identity",
          parts: [{ type: "text", value: "hello direct" }],
          threadIsDirect: true,
        },
        phoneLookupKey: contactLookupKey,
        routeAuthority: {
          accountLookupKey,
          channel: "linq",
          containerMemberId: TEST_USER_ID,
          threadId: "chat_direct_identity",
        },
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_direct_identity_001",
          metrics: { nextWakeAt: null, parserProcessed: 0 },
        };
      },
      async prepareWakeContext() {},
      item: {
        ...createResolvedConversationMailboxItem({
          dedupeKey: decodedWake.eventId,
          id: "mailbox_item_linq_direct_identity_001",
        }),
        groupRunningBit: {
          expiresAt: "2026-07-28T12:00:00.000Z",
          publicAlias: "Fiscal Department",
          requestedBit: "Treat me like the exhausted CFO.",
          schema: "murph.group-sponsorship-bit.v1",
        },
      },
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const event = (await listAssistantInputEvents({ vault: vaultRoot })).events[0];
    assert.ok(event);
    assert.equal(event.conversation?.threadIsDirect, true);
    assert.equal(event.sourceMetadata?.kind, "linq");
    assert.equal(
      event.sourceMetadata?.kind === "linq"
        ? event.sourceMetadata.externalThreadRouteAuthorityPresent
        : false,
      true,
    );
    assert.equal(
      Object.hasOwn(event.sourceMetadata ?? {}, "groupParticipantAdded"),
      false,
    );
    assert.equal(
      Object.hasOwn(event.sourceMetadata ?? {}, "groupReactionContext"),
      false,
    );
    assert.equal(JSON.stringify(event).includes(groupReactionContext), false);

    const source = createHostedAssistantInputSource({
      pendingInputRefreshMode: "none",
      selectedInputIds: [event.inputId],
      vaultRoot,
    });
    const candidates = await source.listInputCandidates({ sourceId: "linq" });
    assert.equal(candidates.inputs[0]?.event.groupParticipantAdded, undefined);
    assert.equal(candidates.inputs[0]?.event.groupReactionContext, undefined);
    assert.equal(candidates.inputs[0]?.event.groupRunningBit, undefined);
  });

  test("projects trusted Linq correction metadata separately from replacement text", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-input-linq-edit-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const decodedWake = createConversationWake({
      eventId: "evt_synthetic_linq_edit_001",
      message: {
        channel: "linq",
        contactKind: "phone",
        contactLookupKey: "hbidx:phone:v1:edit-contact",
        linqMessage: {
          chatId: "chat_edit",
          editedSourceInputId: "ain_11111111111111111111111111111111",
          editedTextPartIndex: 0,
          from: "+15551110000",
          isFromMe: false,
          messageId: "msg_edit",
          parts: [{ type: "text", value: "corrected wording" }],
          replyToMessageId: "msg_edit",
          threadIsDirect: true,
        },
        phoneLookupKey: "hbidx:phone:v1:edit-contact",
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        return {
          captureId: "cap_synthetic_linq_edit_001",
          metrics: { nextWakeAt: null, parserProcessed: 0 },
        };
      },
      async prepareWakeContext() {},
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_linq_edit_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    const event = (await listAssistantInputEvents({ vault: vaultRoot })).events[0];
    assert.ok(event);
    assert.equal(event.content.text, "corrected wording");
    assert.equal(event.sourceMetadata?.kind, "linq");
    assert.equal(
      event.sourceMetadata?.kind === "linq"
        ? event.sourceMetadata.editedSourceInputId
        : undefined,
      "ain_11111111111111111111111111111111",
    );
    assert.equal(
      event.sourceMetadata?.kind === "linq"
        ? event.sourceMetadata.editedTextPartIndex
        : undefined,
      0,
    );
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
    const projectionOrder: string[] = [];
    await writeVaultFile(
      vaultRoot,
      "raw/inbox/linq/cap_synthetic_evidence_001/attachments/01__voice-note.m4a",
      Buffer.from("audio bytes"),
    );

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        projectionOrder.push("current-message-projection");
        return {
          captureId: "cap_synthetic_evidence_001",
          metrics: {
            nextWakeAt: null,
            parserProcessed: 1,
          },
        };
      },
      async loadAttachmentEvidenceCapture(input) {
        projectionOrder.push("attachment-evidence");
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
      async prepareWakeContext() {
        projectionOrder.push("incremental-sidecar-init");
      },
      item: createResolvedConversationMailboxItem({
        dedupeKey: decodedWake.eventId,
        id: "mailbox_item_evidence_001",
      }),
      runtime: createRuntime(),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    assert.deepEqual(projectionOrder, [
      "incremental-sidecar-init",
      "current-message-projection",
      "attachment-evidence",
    ]);

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
        routeAuthority: {
          channel: "telegram",
          containerMemberId: TEST_USER_ID,
          threadId: "123456789",
        },
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
          threadIsDirect: false,
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
    assert.equal(event.conversation?.threadIsDirect, false);
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
      externalThreadRouteAuthorityPresent: true,
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
        threadIsDirect: true,
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
    assert.equal(event.conversation?.threadIsDirect, true);
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

    const {
      conversationImportTiming: _conversationImportTiming,
      ...outcomeWithoutTiming
    } = outcome;
    assert.equal(typeof _conversationImportTiming?.projectionTotalMs, "number");
    assert.deepEqual(outcomeWithoutTiming, {
      assistantInputId: "ain_00000000000000000000000000000000",
      captureId: null,
      emailDeliveryContext: {
        senderHandle: null,
      },
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
        attachmentDescriptorCount: 1,
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

    const {
      conversationImportTiming: _firstTiming,
      ...firstWithoutTiming
    } = first;
    const {
      conversationImportTiming: _secondTiming,
      ...secondWithoutTiming
    } = second;
    assert.deepEqual(firstWithoutTiming, {
      assistantInputId: "ain_00000000000000000000000000000000",
      captureId: null,
      emailDeliveryContext: {
        senderHandle: null,
      },
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      status: "imported",
    });
    assert.deepEqual(secondWithoutTiming, {
      assistantInputId: "ain_00000000000000000000000000000000",
      captureId: null,
      emailDeliveryContext: {
        senderHandle: null,
      },
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      status: "imported",
    });
    assert.equal(typeof _firstTiming?.projectionTotalMs, "number");
    assert.equal(typeof _secondTiming?.projectionTotalMs, "number");
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

  test("rethrows mid-projection aborts after staging without recording projection failure", async () => {
    const abortReason = new DOMException("Stopped", "AbortError");
    const controller = new AbortController();
    const projectionUpdates: unknown[] = [];
    const order: string[] = [];

    await assert.rejects(
      () =>
        importHostedConversationMailboxItem({
          decodePayload: createDecodedPayloadDecoder(createConversationWake()),
          async importConversationWake(input) {
            order.push("import");
            assert.equal(input.signal, controller.signal);
            controller.abort(abortReason);
            throw abortReason;
          },
          async prepareWakeContext(input) {
            order.push("prepare");
            assert.equal(input.wake.eventId, "evt_synthetic_conversation_001");
          },
          item: createResolvedConversationMailboxItem(),
          runtime: createRuntime(),
          signal: controller.signal,
          stageAssistantInputEvent: createAssistantInputEventStager({
            order,
            projectionUpdates,
          }),
          vaultRoot: "synthetic-vault-root",
        }),
      (error) => error === abortReason,
    );

    assert.deepEqual(order, [
      "stage:evt_synthetic_conversation_001",
      "prepare",
      "import",
    ]);
    assert.deepEqual(projectionUpdates, []);
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

    const {
      conversationImportTiming: _conversationImportTiming,
      ...outcomeWithoutTiming
    } = outcome;
    assert.equal(typeof _conversationImportTiming?.projectionTotalMs, "number");
    assert.deepEqual(outcomeWithoutTiming, {
      assistantInputId: "ain_00000000000000000000000000000000",
      captureId: null,
      emailDeliveryContext: {
        senderHandle: null,
      },
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

  test("retains raw inbox projection for zero-attachment direct email", async () => {
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
    const importConversationWake = vi.fn(async () => {
      throw new HostedRawEmailMessageMissingError({
        rawMessageKey: "raw_email_missing",
        userId: TEST_USER_ID,
      });
    });
    const prepareWakeContext = vi.fn(async () => {});

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      importConversationWake,
      prepareWakeContext,
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
    const {
      conversationImportTiming: _conversationImportTiming,
      ...outcomeWithoutTiming
    } = outcome;
    assert.equal(typeof _conversationImportTiming?.projectionPrepareMs, "number");
    assert.equal(typeof _conversationImportTiming?.projectionTotalMs, "number");
    assert.deepEqual(outcomeWithoutTiming, {
      assistantInputId: listed.events[0]?.inputId,
      captureId: null,
      emailDeliveryContext: {
        senderHandle: "Sender <sender@example.test>",
      },
      metrics: {
        nextWakeAt: null,
        parserProcessed: 0,
      },
      reasonCode: "conversation-import.raw-email-missing",
      status: "imported",
    });
    expect(prepareWakeContext).toHaveBeenCalledOnce();
    expect(importConversationWake).toHaveBeenCalledOnce();
    assert.equal("afterCheckpoint" in outcome, false);
    assert.equal(listed.events.length, 1);
    assert.equal(listed.events[0]?.conversation?.threadIsDirect, null);
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
  });

  test("stages hosted email input with minimized prompt-ready metadata and body preview", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-prompt-ready-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        assistantStyleSettingsAuthorized: true,
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
        textPreview:
          "Can you compare my sauna notes from this week and include teammate@example.test? From: Sender <sender@example.test>",
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
      /Email body preview - Can you compare my sauna notes from this week and include teammate@example\.test\? From: Sender <sender@example\.test>/u,
    );
    assert.deepEqual(event.sourceMetadata, {
      assistantStyleSettingsAuthorized: true,
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
    assert.equal(event.conversation?.threadIsDirect, false);
  });

  test("renders group-routed hosted email input without resurfacing address fields", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-group-redacted-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const groupThreadTarget = serializeHostedEmailThreadTarget({
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      lastMessageId: "<group-message@example.test>",
      references: ["<group-root@example.test>", "<group-message@example.test>"],
      subject: "Group newsletter reply",
      targetKind: "group",
    });
    const item = createResolvedConversationMailboxItem();
    const decodedWake = createConversationWake({
      message: {
        channel: "email",
        cc: ["Member Two <member-two@example.test>"],
        from: "Member One <member-one@example.test>",
        identityId: "assistant@mail.example.test",
        messageId: "<group-message@example.test>",
        rawMessageKey: "raw_email_group_redacted",
        selfAddress: "assistant+g2-secret@mail.example.test",
        subject: "Group newsletter reply from member-one@example.test",
        textPreview: [
          "Loved the weekly note. The Friday sleep bit was useful.",
          "On Tue, Jul 7, Member Two <member-two@example.test> wrote:",
          "> From: Member Two <member-two@example.test>",
          "> To: Member One <member-one@example.test>, Member Three <member-three@example.test>",
          "> Cc: stale-header-recipient@example.test",
          "> Reply-To: member-two@example.test",
          "> Inline note from inline-address@example.test should be hidden.",
        ].join("\n"),
        threadTarget: groupThreadTarget,
        to: ["assistant+g2-secret@mail.example.test", "Member Three <member-three@example.test>"],
      },
    });

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      async importConversationWake() {
        throw new HostedRawEmailMessageMissingError({
          rawMessageKey: "raw_email_group_redacted",
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
    assert.equal(event.conversation?.threadIsDirect, false);
    assert.match(
      event.content.text ?? "",
      /Sender summary - Email reply from group participant: Member One/u,
    );
    assert.doesNotMatch(event.content.text ?? "", /Recipient summary/u);
    assert.doesNotMatch(event.content.text ?? "", /Cc summary/u);
    assert.doesNotMatch(event.content.text ?? "", /member-one@example\.test/u);
    assert.doesNotMatch(event.content.text ?? "", /member-two@example\.test/u);
    assert.doesNotMatch(event.content.text ?? "", /member-three@example\.test/u);
    assert.doesNotMatch(event.content.text ?? "", /assistant\+g2-/u);
    assert.doesNotMatch(event.content.text ?? "", /stale-header-recipient@example\.test/u);
    assert.doesNotMatch(event.content.text ?? "", /inline-address@example\.test/u);
    assert.match(
      event.content.text ?? "",
      /Email subject - Group newsletter reply from \[redacted email\]/u,
    );
    assert.match(
      event.content.text ?? "",
      /Loved the weekly note\. The Friday sleep bit was useful\./u,
    );
    assert.match(
      event.content.text ?? "",
      /On Tue, Jul 7, Member Two <\[redacted email\]> wrote:/u,
    );
    assert.doesNotMatch(event.content.text ?? "", /From:/u);
    assert.doesNotMatch(event.content.text ?? "", /To:/u);
    assert.doesNotMatch(event.content.text ?? "", /Cc:/u);
    assert.doesNotMatch(event.content.text ?? "", /Reply-To:/u);
    assert.equal(event.replyTarget?.threadId, groupThreadTarget);
    assert.equal(event.conversation?.threadIsDirect, false);
  });

  test("keeps hosted group email conversation identity stable while reply envelopes change", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-group-thread-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const groupId = "hgrp_AAAAAAAAAAAAAAAA";
    const stableThreadKey = "group-thread:1111111111111111111111111111111111111111";
    const targets = [
      serializeHostedEmailThreadTarget({
        groupId,
        lastMessageId: "<group-message-one@example.test>",
        references: ["<group-root@example.test>", "<group-message-one@example.test>"],
        subject: "First subject",
        targetKind: "group",
      }),
      serializeHostedEmailThreadTarget({
        groupId,
        lastMessageId: "<group-message-two@example.test>",
        references: [
          "<group-root@example.test>",
          "<group-message-one@example.test>",
          "<group-message-two@example.test>",
        ],
        subject: "Changed subject",
        targetKind: "group",
      }),
      serializeHostedEmailThreadTarget({
        groupId: "hgrp_BBBBBBBBBBBBBBBB",
        lastMessageId: "<other-group-message@example.test>",
        references: ["<group-root@example.test>", "<other-group-message@example.test>"],
        subject: "Other group",
        targetKind: "group",
      }),
    ];

    const legacyGroupId = "hgrp_CCCCCCCCCCCCCCCC";
    const legacyTargets = [
      serializeHostedEmailThreadTarget({
        groupId: legacyGroupId,
        lastMessageId: "<legacy-group-one@example.test>",
        references: ["<legacy-group-root@example.test>", "<legacy-group-one@example.test>"],
        subject: "Legacy first subject",
        targetKind: "group",
      }),
      serializeHostedEmailThreadTarget({
        groupId: legacyGroupId,
        lastMessageId: "<legacy-group-two@example.test>",
        references: [
          "<legacy-group-root@example.test>",
          "<legacy-group-one@example.test>",
          "<legacy-group-two@example.test>",
        ],
        subject: "Legacy changed subject",
        targetKind: "group",
      }),
    ];

    const cases = [
      ...targets.map((threadTarget) => ({ threadKey: stableThreadKey, threadTarget })),
      ...legacyTargets.map((threadTarget) => ({ threadKey: undefined, threadTarget })),
    ];
    for (const [index, { threadKey, threadTarget }] of cases.entries()) {
      const eventId = `evt_group_thread_${index}`;
      const decodedWake = createConversationWake({
        eventId,
        message: {
          channel: "email",
          from: "Email reply from group participant",
          identityId: null,
          rawMessageKey: `raw_group_thread_${index}`,
          textPreview: `Group reply ${index}`,
          threadIsDirect: false,
          threadKey,
          threadTarget,
        },
      });
      const outcome = await importHostedConversationMailboxItem({
        decodePayload: createDecodedPayloadDecoder(decodedWake),
        async importConversationWake() {
          throw new HostedConversationInboxProjectionError("group projection is intentionally omitted");
        },
        async prepareWakeContext() {},
        item: createResolvedConversationMailboxItem({
          dedupeKey: eventId,
          id: `mailbox_group_thread_${index}`,
          laneSeq: String(index + 1),
        }),
        runtime: createRuntime(),
        vaultRoot,
      });
      assert.equal(outcome.status, "imported");
    }

    const events = (await listAssistantInputEvents({ vault: vaultRoot })).events;
    const byReplyTarget = new Map(
      events.map((event) => [event.replyTarget?.threadId, event]),
    );
    const first = byReplyTarget.get(targets[0]);
    const second = byReplyTarget.get(targets[1]);
    const otherGroup = byReplyTarget.get(targets[2]);
    assert.ok(first?.conversation?.threadId);
    assert.equal(second?.conversation?.threadId, first.conversation.threadId);
    assert.notEqual(otherGroup?.conversation?.threadId, first.conversation.threadId);
    const legacyFirst = byReplyTarget.get(legacyTargets[0]);
    const legacySecond = byReplyTarget.get(legacyTargets[1]);
    assert.ok(legacyFirst?.conversation?.threadId);
    assert.equal(legacySecond?.conversation?.threadId, legacyFirst.conversation.threadId);
  });

  test("omits group-routed hosted email raw inbox projection and redacts attachment descriptors", async () => {
    const parentRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-email-group-raw-sweep-"));
    tempRoots.push(parentRoot);
    const vaultRoot = path.join(parentRoot, "vault");
    const groupThreadTarget = serializeHostedEmailThreadTarget({
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      lastMessageId: "<group-raw-message@example.test>",
      references: ["<group-newsletter-root@example.test>", "<group-raw-message@example.test>"],
      subject: "Redacted group newsletter subject",
      targetKind: "group",
    });
    const rawOnlyAddress = "raw-only-member@example.test";
    const rawOnlySubject = "Raw Only Group Health Reply Subject";
    const rawOnlyBody = "RAW_ONLY_GROUP_EMAIL_BODY_SHOULD_NOT_PERSIST";
    const rawEmailBytes = new TextEncoder().encode([
      `From: Raw Member <${rawOnlyAddress}>`,
      "To: assistant+g2-secret@mail.example.test, Other Member <other-raw@example.test>",
      `Subject: ${rawOnlySubject}`,
      "Message-ID: <group-raw-message@example.test>",
      "References: <group-newsletter-root@example.test>",
      "",
      rawOnlyBody,
      "> From: Other Member <other-raw@example.test>",
    ].join("\r\n"));
    const readRawEmailMessage = vi.fn(async () => rawEmailBytes);
    const decodedWake = createConversationWake({
      message: {
        attachmentSummaries: [
          {
            contentType: "application/pdf",
            fileName: "member@example.test.pdf",
            sizeBytes: 1234,
          },
        ],
        channel: "email",
        from: "Email reply from group participant: Raw Member",
        identityId: null,
        messageId: "<group-raw-message@example.test>",
        rawMessageKey: "raw_email_group_sweep",
        subject: "Redacted group newsletter subject",
        threadTarget: groupThreadTarget,
      },
    });
    const prepareWakeContext = vi.fn(async () => {});

    const outcome = await importHostedConversationMailboxItem({
      decodePayload: createDecodedPayloadDecoder(decodedWake),
      prepareWakeContext,
      item: createResolvedConversationMailboxItem(),
      runtime: createRuntime({
        platform: {
          effectsPort: {
            readRawEmailMessage,
            async sendEmail() {},
          },
        },
      }),
      vaultRoot,
    });

    assert.equal(outcome.status, "imported");
    if (outcome.status === "imported") {
      assert.equal(outcome.captureId, null);
      assert.equal(outcome.reasonCode ?? null, null);
    }
    const listed = await listAssistantInputEvents({
      vault: vaultRoot,
    });
    assert.equal(listed.events.length, 1);
    const event = listed.events[0]!;
    assert.equal(
      event.content.text,
      [
        "Received an email message.",
        "Sender summary - Email reply from group participant: Raw Member",
        "Email subject - Redacted group newsletter subject",
        "Email body unavailable.",
      ].join("\n"),
    );
    assert.deepEqual(event.content.attachmentDescriptors[0], {
      attachmentId: event.content.attachmentDescriptors[0]?.attachmentId,
      contentType: "application/pdf",
      fileName: null,
      kind: "email_attachment",
      sizeBytes: 1234,
    });
    assert.deepEqual(event.sourceMetadata, {
      kind: "email",
      promptReady: false,
      promptUnavailableReason: "email.body_unavailable",
    });
    expect(readRawEmailMessage).not.toHaveBeenCalled();
    expect(prepareWakeContext).not.toHaveBeenCalled();
    assert.equal(event.projection.status, "not_attempted");
    assert.equal(event.projection.captureId, null);
    const persistedSurface = await collectVaultTextSurface(vaultRoot);
    for (const forbidden of [
      rawOnlyAddress,
      "other-raw@example.test",
      rawOnlySubject,
      rawOnlyBody,
      "member@example.test.pdf",
    ]) {
      assert.doesNotMatch(persistedSurface, new RegExp(escapeRegExp(forbidden), "u"));
    }
    assert.doesNotMatch(persistedSurface, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
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
      assert.equal(outcome.reasonCode, undefined);
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
    assert.equal(retryOutcome.reasonCode, undefined);

    const pendingInputIds = await readHostedPendingAssistantInputIds({ vaultRoot });
    assert.equal(pendingInputIds.length, 5);
    const source = createHostedAssistantInputSource({
      pendingInputRefreshMode: "compact",
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
      [
        "not_attempted",
        "not_attempted",
        "not_attempted",
        "not_attempted",
        "not_attempted",
      ],
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

function createDeferred<T = void>(): {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
} {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    reject = innerReject;
    resolve = innerResolve;
  });
  return {
    promise,
    reject,
    resolve,
  };
}

function createLinqConversationLookupKey(input: {
  item: HostedMailboxResolvedImportItem;
  wake: HostedExecutionConversationMessageWake;
}): string {
  if (input.wake.message.channel !== "linq") {
    throw new Error("Expected Linq conversation wake.");
  }

  const accountLookupKey = readHostedLinqConversationMessageAccountLookupKey(
    input.wake.message,
  );
  const identifierBlind = createHostedAssistantConversationIdentifierBlind({
    secret: accountLookupKey,
    userId: input.item.item.userId,
  });
  const conversationKey = resolveAssistantConversationLookupKey({
    conversation: {
      channel: "linq",
      directness: input.wake.message.linqMessage.threadIsDirect === false
        ? "group"
        : "direct",
      identityId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        accountLookupKey,
      ),
      participantId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        input.wake.message.linqMessage.from,
      ),
      threadId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        input.wake.message.linqMessage.chatId,
      ),
    },
  });
  if (!conversationKey) {
    throw new Error("Expected Linq conversation lookup key.");
  }
  return conversationKey;
}

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

async function collectVaultTextSurface(vaultRoot: string): Promise<string> {
  const lines: string[] = [];

  async function visit(relativePath: string): Promise<void> {
    const absolutePath = relativePath ? path.join(vaultRoot, relativePath) : vaultRoot;
    const entries = await readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const entryRelativePath = relativePath
        ? path.posix.join(relativePath.split(path.sep).join("/"), entry.name)
        : entry.name;
      lines.push(`path:${entryRelativePath}`);
      if (entry.isDirectory()) {
        await visit(entryRelativePath);
        continue;
      }
      if (entry.isFile()) {
        const bytes = await readFile(path.join(vaultRoot, entryRelativePath));
        lines.push(bytes.toString("utf8"));
      }
    }
  }

  await visit("");
  return lines.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
