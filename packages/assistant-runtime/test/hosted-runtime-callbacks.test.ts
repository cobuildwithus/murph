import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedAssistantDeliveryFailedRecord,
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySendingRecord,
  buildHostedAssistantDeliverySentRecord,
  buildHostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";

const mocks = vi.hoisted(() => ({
  createAssistantDeliveryAmbiguousError: vi.fn(),
  dispatchAssistantOutboxIntent: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  shouldDispatchAssistantOutboxIntent: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("@murphai/assistant-engine", () => ({
  createAssistantDeliveryAmbiguousError: mocks.createAssistantDeliveryAmbiguousError,
  dispatchAssistantOutboxIntent: mocks.dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
  normalizeAssistantDeliveryError: mocks.normalizeAssistantDeliveryError,
  shouldDispatchAssistantOutboxIntent: mocks.shouldDispatchAssistantOutboxIntent,
}));

import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedCommittedAssistantDeliveriesAfterCommit,
  resumeHostedCommittedExecution,
} from "../src/hosted-runtime/callbacks.ts";
import {
  createHostedRuntimeEffectsPortStub,
} from "./hosted-runtime-test-helpers.ts";

const HOSTED_RUN_CONTEXT = {
  attempt: 1,
  runId: "run_123",
  startedAt: "2026-04-08T00:00:00.000Z",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAssistantDeliveryAmbiguousError.mockImplementation((cause?: { code?: string | null; message?: string }) => ({
    code: "ASSISTANT_DELIVERY_AMBIGUOUS",
    message: cause?.message ?? "ambiguous",
    retryable: false,
  }));
  mocks.normalizeAssistantDeliveryError.mockImplementation((error: Error & { code?: string | null }) => ({
    code: error.code ?? null,
    message: error.message,
  }));
});

describe("hosted runtime callbacks", () => {
  it("rebuilds committed resume state from the request payload", () => {
    const sideEffect = buildHostedAssistantDeliverySideEffect({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
    });

    const resumed = resumeHostedCommittedExecution({
      bundle: "bundle_123",
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_resume",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      resume: {
        committedResult: {
          assistantDeliveryEffects: [sideEffect],
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "completed",
          },
        },
      },
    });

    assert.equal(resumed.committedResult.bundle, "bundle_123");
    assert.deepEqual(resumed.committedResult.result, {
      eventsHandled: 1,
      nextWakeAt: null,
      summary: "completed",
    });
    assert.deepEqual(resumed.committedAssistantDeliveryEffects, [sideEffect]);
    assert.equal(
      resumed.committedGatewayProjectionSnapshot.schema,
      "murph.gateway-projection-snapshot.v1",
    );
  });

  it("collects only dispatchable side effects and caps the committed batch size", async () => {
    const intents = Array.from({ length: 25 }, (_, index) => ({
      dedupeKey: `dedupe_${index}`,
      intentId: `intent_${index}`,
    }));
    mocks.listAssistantOutboxIntents.mockResolvedValue(intents);
    mocks.shouldDispatchAssistantOutboxIntent.mockReturnValue(true);

    const sideEffects = await collectHostedAssistantDeliverySideEffects("/tmp/vault");

    expect(mocks.listAssistantOutboxIntents).toHaveBeenCalledWith("/tmp/vault");
    assert.equal(sideEffects.length, 20);
    assert.deepEqual(
      sideEffects.map((effect) => effect.effectId),
      intents.slice(0, 20).map((intent) => intent.intentId),
    );
  });

  it("skips intents that are not ready to dispatch", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      { dedupeKey: "dedupe_skip", intentId: "intent_skip" },
      { dedupeKey: "dedupe_send", intentId: "intent_send" },
    ]);
    mocks.shouldDispatchAssistantOutboxIntent
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const sideEffects = await collectHostedAssistantDeliverySideEffects("/tmp/vault");

    assert.deepEqual(sideEffects, [
      buildHostedAssistantDeliverySideEffect({
        dedupeKey: "dedupe_send",
        effectId: "intent_send",
      }),
    ]);
  });

  it("always passes journal hooks when draining committed side effects", async () => {
    let observedDispatchHooks: object | undefined;

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
      return {
        deliveryError: null,
        intent: {
          status: "sent",
        },
        session: null,
      };
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_no_hooks",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: {
        async deletePreparedAssistantDelivery() {},
        async readRawEmailMessage() {
          return null;
        },
        async readAssistantDeliveryRecord() {
          return null;
        },
        async sendEmail() {},
        async writeAssistantDeliveryRecord(record) {
          return record;
        },
      },
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    expect(outcomes).toEqual([
      {
        deliveryChannel: null,
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "missing-result",
        effectFingerprint: "dedupe_123",
        effectId: "intent_123",
        journalMethod: null,
        journalStatus: null,
        providerMessageId: null,
        providerThreadId: null,
        retryable: true,
        target: null,
        targetKind: null,
      },
    ]);

    expect(observedDispatchHooks).toBeDefined();
    expect(mocks.dispatchAssistantOutboxIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        allowPersistedDeliveryRecovery: false,
        deliveryStateAuthority: "hosted-journal",
      }),
    );
  });

  it("emits a structured hosted log when a committed delivery stays retryable", async () => {
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue({
      deliveryError: {
        code: "LINQ_SEND_FAILED",
        message: "Linq outbound chat creation failed with HTTP 403.",
      },
      intent: {
        status: "retryable",
      },
      session: null,
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_retryable_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub(),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_retryable",
          effectId: "intent_retryable",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    expect(outcomes).toEqual([
      {
        deliveryChannel: null,
        deliveryErrorCode: "LINQ_SEND_FAILED",
        deliveryErrorMessage: "Linq outbound chat creation failed with HTTP 403.",
        deliveryStatus: "retryable",
        effectFingerprint: "dedupe_retryable",
        effectId: "intent_retryable",
        journalMethod: null,
        journalStatus: null,
        providerMessageId: null,
        providerThreadId: null,
        retryable: true,
        target: null,
        targetKind: null,
      },
    ]);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(1, {
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        effectFingerprint: "dedupe_retryable",
        effectId: "intent_retryable",
        userId: "member_123",
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_retryable_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      message: "Hosted assistant delivery dispatch starting.",
      phase: "side-effects.draining",
      userId: "member_123",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(2, {
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        deliveryErrorCode: "LINQ_SEND_FAILED",
        deliveryErrorMessage: "Linq outbound chat creation failed with HTTP 403.",
        dispatchedIntentStatus: "retryable",
        effectFingerprint: "dedupe_retryable",
        effectId: "intent_retryable",
        retryable: true,
        userId: "member_123",
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_retryable_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      level: "warn",
      message: "Hosted assistant delivery dispatch finished.",
      phase: "side-effects.draining",
      userId: "member_123",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenNthCalledWith(3, {
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        deliveryErrorCode: "LINQ_SEND_FAILED",
        deliveryErrorMessage: "Linq outbound chat creation failed with HTTP 403.",
        deliveryStatus: "retryable",
        effectFingerprint: "dedupe_retryable",
        effectId: "intent_retryable",
        failureDomain: "dispatch",
        retryable: true,
        userId: "member_123",
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_retryable_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      level: "warn",
      message: "Hosted assistant delivery finished with retryable status during post-commit dispatch.",
      phase: "side-effects.draining",
      userId: "member_123",
    });
  });

  it("emits a structured hosted log when a committed delivery sends successfully", async () => {
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue({
      deliveryError: null,
      intent: {
        delivery: {
          channel: "linq",
          idempotencyKey: "assistant-first-contact:session_123",
          messageLength: 42,
          providerMessageId: "linq_message_123",
          providerThreadId: "chat_123",
          sentAt: "2026-04-08T00:00:00.000Z",
          target: "chat_123",
          targetKind: "thread",
        },
        status: "sent",
      },
      session: null,
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_sent_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub(),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_sent",
          effectId: "intent_sent",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        deliveryChannel: "linq",
        deliveryStatus: "sent",
        effectFingerprint: "dedupe_sent",
        effectId: "intent_sent",
        failureDomain: "dispatch",
        retryable: false,
        targetKind: "thread",
        userId: "member_123",
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_sent_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      message: "Hosted assistant delivery sent successfully during post-commit dispatch.",
      phase: "side-effects.draining",
      userId: "member_123",
    });
  });

  it("emits a warning when a committed delivery dispatch returns no result", async () => {
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue(undefined);

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_missing_delivery_result",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub(),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_missing_result",
          effectId: "intent_missing_result",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        deliveryStatus: "missing-result",
        effectFingerprint: "dedupe_missing_result",
        effectId: "intent_missing_result",
        failureDomain: "dispatch",
        retryable: true,
        userId: "member_123",
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_missing_delivery_result",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      level: "warn",
      message: "Hosted assistant delivery dispatch returned no result.",
      phase: "side-effects.draining",
      userId: "member_123",
    });
  });

  it("emits an error-level hosted log when a committed delivery fails without a normalized error", async () => {
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue({
      deliveryError: null,
      intent: {
        status: "failed",
      },
      session: null,
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_failed_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub(),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_failed",
          effectId: "intent_failed",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        deliveryErrorCode: null,
        deliveryErrorMessage: null,
        deliveryStatus: "failed",
        effectFingerprint: "dedupe_failed",
        effectId: "intent_failed",
        failureDomain: "dispatch",
        retryable: false,
        userId: "member_123",
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_failed_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      level: "error",
      message: "Hosted assistant delivery finished with failed status during post-commit dispatch.",
      phase: "side-effects.draining",
      userId: "member_123",
    });
  });

  it("reports terminal ambiguity as failed_ambiguous in hosted delivery outcomes", async () => {
    mocks.dispatchAssistantOutboxIntent.mockResolvedValue({
      deliveryError: {
        code: "ASSISTANT_DELIVERY_AMBIGUOUS",
        message: "Assistant outbound delivery could not be confirmed safely.",
      },
      intent: {
        status: "failed",
      },
      session: null,
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_failed_ambiguous_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub(),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_failed_ambiguous",
          effectId: "intent_failed_ambiguous",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    expect(outcomes).toEqual([
      {
        deliveryChannel: null,
        deliveryErrorCode: "ASSISTANT_DELIVERY_AMBIGUOUS",
        deliveryErrorMessage: "Assistant outbound delivery could not be confirmed safely.",
        deliveryStatus: "failed_ambiguous",
        effectFingerprint: "dedupe_failed_ambiguous",
        effectId: "intent_failed_ambiguous",
        journalMethod: null,
        journalStatus: null,
        providerMessageId: null,
        providerThreadId: null,
        retryable: false,
        target: null,
        targetKind: null,
      },
    ]);
  });

  it("emits a structured hosted log when post-commit dispatch throws a retry-classified error", async () => {
    const error = Object.assign(
      new Error("Linq request POST /chats failed with HTTP 429."),
      {
        code: "LINQ_API_REQUEST_FAILED",
        context: {
          operation: "create_chat",
          path: "/chats",
          retryable: false,
          status: 429,
        },
      },
    );
    mocks.dispatchAssistantOutboxIntent.mockRejectedValue(error);

    await expect(drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_throwing_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub(),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_throwing",
          effectId: "intent_throwing",
        }),
      ],
      vaultRoot: "/tmp/vault",
    })).rejects.toBe(error);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        effectFingerprint: "dedupe_throwing",
        effectId: "intent_throwing",
        failureDomain: "dispatch",
        retryable: false,
        userId: "member_123",
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_throwing_delivery",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      error,
      message: "Hosted assistant delivery threw during post-commit dispatch.",
      phase: "side-effects.draining",
      userId: "member_123",
    });
    expect(error).toMatchObject({
      details: expect.objectContaining({
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        effectFingerprint: "dedupe_throwing",
        effectId: "intent_throwing",
        userId: "member_123",
      }),
    });
  });

  it("still logs primitive post-commit dispatch throws with redacted hosted metadata", async () => {
    mocks.dispatchAssistantOutboxIntent.mockRejectedValue("plain failure");

    await expect(drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_primitive_throw",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub(),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_primitive",
          effectId: "intent_primitive",
        }),
      ],
      vaultRoot: "/tmp/vault",
    })).rejects.toBe("plain failure");

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        effectFingerprint: "dedupe_primitive",
        effectId: "intent_primitive",
        failureDomain: "dispatch",
        retryable: null,
        userId: "member_123",
      },
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_primitive_throw",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      error: "plain failure",
      message: "Hosted assistant delivery threw during post-commit dispatch.",
      phase: "side-effects.draining",
      userId: "member_123",
    });
  });

  it("writes sending and sent delivery records through the hosted side-effect journal hooks", async () => {
    let observedDispatchHooks:
      | {
          prepareDispatchIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<void>;
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const writes: object[] = [];
    const sendingRecord = buildHostedAssistantDeliverySendingRecord({
      attempt: {
        channel: "email",
        idempotencyKey: null,
        messageLength: 13,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "2026-04-08T00:00:00.000Z",
        target: "user@example.com",
        targetKind: "explicit",
      },
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
    });
    const sentRecord = buildHostedAssistantDeliverySentRecord({
      dedupeKey: "dedupe_123",
      delivery: {
        channel: "email",
        idempotencyKey: "idem_123",
        messageLength: 5,
        providerMessageId: "provider_message_123",
        providerThreadId: "provider_thread_123",
        sentAt: "2026-04-08T00:01:00.000Z",
        target: "user@example.com",
        targetKind: "explicit",
      },
      effectId: "intent_123",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
      return {
        deliveryError: null,
        intent: {
          status: "sent",
        },
        session: null,
      };
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_hooks",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: {
        ...createHostedRuntimeEffectsPortStub(),
        async readAssistantDeliveryRecord() {
          return sentRecord;
        },
        async writeAssistantDeliveryRecord(record) {
          writes.push(record);
          return record;
        },
      },
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await observedDispatchHooks.prepareDispatchIntent({
      intent: {
        channel: "email",
        dedupeKey: "dedupe_123",
        explicitTarget: "user@example.com",
        intentId: "intent_123",
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
        message: "hello there!!",
      },
      vault: "/tmp/vault",
    });
    assert.deepEqual(writes[0], sendingRecord);

    const resolved = await observedDispatchHooks.resolveDeliveredIntent({
      intent: {
        dedupeKey: "dedupe_123",
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    });

    assert.deepEqual(resolved, {
      channel: "email",
      idempotencyKey: "idem_123",
      messageLength: 5,
      providerMessageId: "provider_message_123",
      providerThreadId: "provider_thread_123",
      sentAt: "2026-04-08T00:01:00.000Z",
      target: "user@example.com",
      targetKind: "explicit",
    });
  });

  it("uses the current time when preparing a delivery without a lastAttemptAt and returns null when the journal has no record", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T02:03:04.000Z"));

    try {
      let observedDispatchHooks:
        | {
            prepareDispatchIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<void>;
            resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
          }
        | undefined;
      const writes: object[] = [];

      mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
        observedDispatchHooks = input.dispatchHooks;
      });

      await drainHostedCommittedAssistantDeliveriesAfterCommit({
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_123",
          },
          eventId: "evt_prepare_fallback",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        effectsPort: {
          ...createHostedRuntimeEffectsPortStub(),
          async readAssistantDeliveryRecord() {
            return null;
          },
          async writeAssistantDeliveryRecord(record) {
            writes.push(record);
            return record;
          },
        },
        assistantDeliveryEffects: [
          buildHostedAssistantDeliverySideEffect({
            dedupeKey: "dedupe_123",
            effectId: "intent_123",
          }),
        ],
        vaultRoot: "/tmp/vault",
      });

      assert.ok(observedDispatchHooks);
      await observedDispatchHooks.prepareDispatchIntent({
        intent: {
          bindingDelivery: {
            kind: "thread",
            target: "thread_123",
          },
          channel: "telegram",
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
          message: "fallback",
        },
        vault: "/tmp/vault",
      });
      assert.deepEqual(writes, [
        buildHostedAssistantDeliverySendingRecord({
          attempt: {
            channel: "telegram",
            idempotencyKey: null,
            messageLength: 8,
            providerMessageId: null,
            providerThreadId: null,
            startedAt: "2026-04-08T02:03:04.000Z",
            target: "thread_123",
            targetKind: "thread",
          },
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ]);

      const resolved = await observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      });

      assert.equal(resolved, null);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears non-terminal delivery records through the hosted side-effect journal hooks", async () => {
    let observedDispatchHooks:
      | {
          clearPreparedIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<void>;
        }
      | undefined;
    const deleted: Array<Record<string, string>> = [];

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_delete_hook",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async deletePreparedAssistantDelivery(input) {
          deleted.push(input);
        },
      }),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await observedDispatchHooks.clearPreparedIntent({
      intent: {
        dedupeKey: "dedupe_123",
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    });

    assert.deepEqual(deleted, [{
      effectId: "intent_123",
      fingerprint: "dedupe_123",
    }]);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: expect.objectContaining({
          effectId: "intent_123",
          journalMethod: "DELETE",
          retryable: true,
        }),
        message: "Hosted assistant delivery clearing non-terminal journal intent.",
        phase: "side-effects.draining",
      }),
    );
  });

  it("fails closed when local delivery confirmation is still pending after the send", async () => {
    let observedDispatchHooks:
      | {
          persistDeliveredIntent(args: {
            delivery: Record<string, unknown>;
            intent: Record<string, unknown>;
            vault: string;
          }): Promise<void>;
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_pending_confirmation",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: {
        ...createHostedRuntimeEffectsPortStub(),
        async readAssistantDeliveryRecord() {
          return preparedRecord;
        },
      },
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
      details: expect.objectContaining({
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        deliveryMayHaveSucceeded: true,
        effectId: "intent_123",
        failureDomain: "confirmation_pending",
        userId: "member_123",
      }),
      deliveryMayHaveSucceeded: true,
      retryable: true,
    });

    await expect(
      observedDispatchHooks.persistDeliveredIntent({
        delivery: {
          channel: "email",
          idempotencyKey: "",
          messageLength: 5,
          providerMessageId: "provider_message_123",
          providerThreadId: null,
          sentAt: "2026-04-08T00:01:00.000Z",
          target: "user@example.com",
          targetKind: "explicit",
        },
        intent: {
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toThrow(/require a non-empty idempotencyKey/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: expect.objectContaining({
          deliveryChannel: "email",
          effectId: "intent_123",
          journalMethod: "PUT",
          retryable: false,
          targetKind: "explicit",
        }),
        message: "Hosted assistant delivery persisting sent journal record.",
        phase: "side-effects.draining",
      }),
    );
  });

  it("fails closed when the local delivery record is missing both idempotency key fields", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_missing_local_idempotency",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readAssistantDeliveryRecord() {
          return preparedRecord;
        },
      }),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          dedupeKey: "dedupe_123",
          delivery: {
            channel: "email",
            messageLength: 5,
            providerMessageId: "provider_message_123",
            providerThreadId: null,
            sentAt: "2026-04-08T00:01:00.000Z",
            target: "user@example.com",
            targetKind: "explicit",
          },
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
      details: expect.objectContaining({
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        effectId: "intent_123",
        failureDomain: "confirmation_pending",
        userId: "member_123",
      }),
      deliveryMayHaveSucceeded: true,
      retryable: true,
    });
  });

  it("reconciles sent deliveries with null provider ids", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const writes: object[] = [];
    const sentRecord = buildHostedAssistantDeliverySentRecord({
      dedupeKey: "dedupe_123",
      delivery: {
        channel: "email",
        idempotencyKey: "idem_123",
        messageLength: 5,
        providerMessageId: null,
        providerThreadId: null,
        sentAt: "2026-04-08T00:01:00.000Z",
        target: "user@example.com",
        targetKind: "explicit",
      },
      effectId: "intent_123",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_null_provider_ids",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: {
        ...createHostedRuntimeEffectsPortStub(),
        async readAssistantDeliveryRecord() {
          return sentRecord;
        },
        async writeAssistantDeliveryRecord(record) {
          writes.push(record);
          return record;
        },
      },
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    const resolved = await observedDispatchHooks.resolveDeliveredIntent({
      intent: {
        dedupeKey: "dedupe_123",
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    });

    assert.deepEqual(resolved, {
      channel: "email",
      idempotencyKey: "idem_123",
      messageLength: 5,
      providerMessageId: null,
      providerThreadId: null,
      sentAt: "2026-04-08T00:01:00.000Z",
      target: "user@example.com",
      targetKind: "explicit",
    });
    assert.deepEqual(writes, []);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: expect.objectContaining({
          deliveryChannel: "email",
          effectId: "intent_123",
          journalRecordState: "sent",
          retryable: false,
          targetKind: "explicit",
        }),
        message: "Hosted assistant delivery journal already recorded a sent outcome.",
        phase: "side-effects.draining",
      }),
    );
  });

  it("reconciles delivered intents from the local record only for idempotent hosted transports", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const writes: object[] = [];
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_local_reconcile",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readAssistantDeliveryRecord() {
          return preparedRecord;
        },
        async writeAssistantDeliveryRecord(record) {
          writes.push(record);
          return record;
        },
      }),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    const resolved = await observedDispatchHooks.resolveDeliveredIntent({
      intent: {
        channel: "linq",
        dedupeKey: "dedupe_123",
        delivery: {
          channel: "linq",
          messageLength: 5,
          providerMessageId: "provider_message_123",
          providerThreadId: "chat_123",
          sentAt: "2026-04-08T00:01:00.000Z",
          target: "chat_123",
          targetKind: "thread",
        },
        deliveryIdempotencyKey: "idem_fallback",
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    });

    assert.deepEqual(resolved, {
      channel: "linq",
      idempotencyKey: "idem_fallback",
      messageLength: 5,
      providerMessageId: "provider_message_123",
      providerThreadId: "chat_123",
      sentAt: "2026-04-08T00:01:00.000Z",
      target: "chat_123",
      targetKind: "thread",
    });
    assert.deepEqual(writes, [
      buildHostedAssistantDeliverySentRecord({
        dedupeKey: "dedupe_123",
        delivery: {
          channel: "linq",
          idempotencyKey: "idem_fallback",
          messageLength: 5,
          providerMessageId: "provider_message_123",
          providerThreadId: "chat_123",
          sentAt: "2026-04-08T00:01:00.000Z",
          target: "chat_123",
          targetKind: "thread",
        },
        effectId: "intent_123",
      }),
    ]);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: expect.objectContaining({
          effectId: "intent_123",
          journalMethod: "GET",
          retryable: true,
        }),
        message: "Hosted assistant delivery reconciling journal state.",
        phase: "side-effects.draining",
      }),
    );
  });

  it("marks stale non-idempotent sending records as terminally ambiguous", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:03:30.000Z"));

    try {
      let observedDispatchHooks:
        | {
            resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
          }
        | undefined;
      const writes: object[] = [];
      const sendingRecord = buildHostedAssistantDeliverySendingRecord({
        attempt: {
          channel: "telegram",
          idempotencyKey: "assistant-outbox:intent_123",
          messageLength: 2,
          providerMessageId: null,
          providerThreadId: null,
          startedAt: "2026-04-08T00:00:00.000Z",
          target: "thread_123",
          targetKind: "thread",
        },
        dedupeKey: "dedupe_123",
        effectId: "intent_123",
      });

      mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
        observedDispatchHooks = input.dispatchHooks;
      });

      await drainHostedCommittedAssistantDeliveriesAfterCommit({
        dispatch: {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "member_123",
          },
          eventId: "evt_terminal_ambiguity",
          occurredAt: "2026-04-08T00:00:00.000Z",
        },
        effectsPort: createHostedRuntimeEffectsPortStub({
          async readAssistantDeliveryRecord() {
            return sendingRecord;
          },
          async writeAssistantDeliveryRecord(record) {
            writes.push(record);
            return record;
          },
        }),
        assistantDeliveryEffects: [
          buildHostedAssistantDeliverySideEffect({
            dedupeKey: "dedupe_123",
            effectId: "intent_123",
          }),
        ],
        vaultRoot: "/tmp/vault",
      });

      assert.ok(observedDispatchHooks);
      await expect(
        observedDispatchHooks.resolveDeliveredIntent({
          intent: {
            bindingDelivery: {
              kind: "thread",
              target: "thread_123",
            },
            channel: "telegram",
            dedupeKey: "dedupe_123",
            deliveryTransportIdempotent: false,
            explicitTarget: null,
            intentId: "intent_123",
            lastAttemptAt: "2026-04-08T00:00:00.000Z",
            message: "yo",
          },
          vault: "/tmp/vault",
        }),
      ).rejects.toMatchObject({
        code: "ASSISTANT_DELIVERY_AMBIGUOUS",
        retryable: false,
      });

      assert.deepEqual(writes, [
        buildHostedAssistantDeliveryFailedRecord({
          attempt: {
            channel: "telegram",
            idempotencyKey: "assistant-outbox:intent_123",
            messageLength: 2,
            providerMessageId: null,
            providerThreadId: null,
            startedAt: "2026-04-08T00:00:00.000Z",
            target: "thread_123",
            targetKind: "thread",
          },
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
          failure: {
            code: "ASSISTANT_DELIVERY_AMBIGUOUS",
            failedAt: "2026-04-08T00:03:30.000Z",
            message: "The hosted delivery journal remained in sending state past the confirmation grace window.",
          },
          state: "failed_ambiguous",
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats terminal journal ambiguity as authoritative over any local delivery snapshot", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const ambiguousRecord = buildHostedAssistantDeliveryFailedRecord({
      attempt: {
        channel: "telegram",
        idempotencyKey: "assistant-outbox:intent_123",
        messageLength: 2,
        providerMessageId: "provider_123",
        providerThreadId: "thread_123",
        startedAt: "2026-04-08T00:00:00.000Z",
        target: "thread_123",
        targetKind: "thread",
      },
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      failure: {
        code: "ASSISTANT_DELIVERY_AMBIGUOUS",
        failedAt: "2026-04-08T00:03:30.000Z",
        message: "The hosted delivery journal remained in sending state past the confirmation grace window.",
      },
      state: "failed_ambiguous",
    });
    const writes: object[] = [];

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_terminal_authority",
        occurredAt: "2026-04-08T00:04:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readAssistantDeliveryRecord() {
          return ambiguousRecord;
        },
        async writeAssistantDeliveryRecord(record) {
          writes.push(record);
          return record;
        },
      }),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          bindingDelivery: {
            kind: "thread",
            target: "thread_123",
          },
          channel: "telegram",
          dedupeKey: "dedupe_123",
          delivery: {
            channel: "telegram",
            idempotencyKey: "assistant-outbox:intent_123",
            messageLength: 2,
            providerMessageId: "provider_123",
            providerThreadId: "thread_123",
            sentAt: "2026-04-08T00:00:10.000Z",
            target: "thread_123",
            targetKind: "thread",
          },
          deliveryTransportIdempotent: false,
          explicitTarget: null,
          intentId: "intent_123",
          lastAttemptAt: "2026-04-08T00:00:00.000Z",
          message: "yo",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_DELIVERY_AMBIGUOUS",
      retryable: false,
    });
    expect(writes).toEqual([]);
  });

  it("treats terminal journal failure as authoritative for non-idempotent recovery", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const failedRecord = buildHostedAssistantDeliveryFailedRecord({
      attempt: {
        channel: "telegram",
        idempotencyKey: "assistant-outbox:intent_123",
        messageLength: 2,
        providerMessageId: null,
        providerThreadId: null,
        startedAt: "2026-04-08T00:00:00.000Z",
        target: "thread_123",
        targetKind: "thread",
      },
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      failure: {
        code: "ASSISTANT_DELIVERY_FAILED",
        failedAt: "2026-04-08T00:02:00.000Z",
        message: "Telegram rejected the send.",
      },
      state: "failed",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_terminal_failure",
        occurredAt: "2026-04-08T00:03:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readAssistantDeliveryRecord() {
          return failedRecord;
        },
      }),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          bindingDelivery: {
            kind: "thread",
            target: "thread_123",
          },
          channel: "telegram",
          dedupeKey: "dedupe_123",
          deliveryTransportIdempotent: false,
          explicitTarget: null,
          intentId: "intent_123",
          lastAttemptAt: "2026-04-08T00:00:00.000Z",
          message: "yo",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_DELIVERY_FAILED",
      message: "Telegram rejected the send.",
      retryable: false,
    });
  });

  it("marks delivery confirmation pending when journal reconciliation fails after a local send", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const journalError = new Error("journal unavailable");
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_reconcile_error",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readAssistantDeliveryRecord() {
          return preparedRecord;
        },
        async writeAssistantDeliveryRecord() {
          throw journalError;
        },
      }),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          channel: "linq",
          dedupeKey: "dedupe_123",
          delivery: {
            channel: "linq",
            idempotencyKey: "idem_123",
            messageLength: 5,
            providerMessageId: "provider_message_123",
            providerThreadId: "chat_123",
            sentAt: "2026-04-08T00:01:00.000Z",
            target: "chat_123",
            targetKind: "thread",
          },
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        cause: journalError,
        code: "HOSTED_SIDE_EFFECT_JOURNAL_FAILED",
        details: expect.objectContaining({
          assistantDeliveryBoundary: "hosted_runtime_finalize",
          effectId: "intent_123",
          failureDomain: "journal",
          journalMethod: "PUT",
          userId: "member_123",
        }),
      }),
      code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
      details: expect.objectContaining({
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        deliveryMayHaveSucceeded: true,
        effectId: "intent_123",
        failureDomain: "confirmation_pending",
        userId: "member_123",
      }),
      deliveryMayHaveSucceeded: true,
      retryable: true,
    });
  });

  it("uses normalized delivery errors for pending-confirmation messages without surfacing raw cause details", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const journalError = new Error("Authorization: Bearer secret-token user@example.com");
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    mocks.normalizeAssistantDeliveryError.mockReturnValue({
      message: "Hosted side-effect journal retry required. authorization=[redacted] [redacted-email]",
    });
    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_reconcile_redacted",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readAssistantDeliveryRecord() {
          return preparedRecord;
        },
        async writeAssistantDeliveryRecord() {
          throw journalError;
        },
      }),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    const thrown = await observedDispatchHooks.resolveDeliveredIntent({
      intent: {
        channel: "linq",
        dedupeKey: "dedupe_123",
        delivery: {
          channel: "linq",
          idempotencyKey: "idem_123",
          messageLength: 5,
          providerMessageId: "provider_message_123",
          providerThreadId: "chat_123",
          sentAt: "2026-04-08T00:01:00.000Z",
          target: "chat_123",
          targetKind: "thread",
        },
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    }).catch((error: unknown) => error);

    assert.ok(thrown instanceof Error);
    expect(mocks.normalizeAssistantDeliveryError).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: journalError,
        code: "HOSTED_SIDE_EFFECT_JOURNAL_FAILED",
      }),
    );
    assert.match(
      thrown.message,
      /Hosted side-effect journal retry required\. authorization=\[redacted\] \[redacted-email\]/u,
    );
    assert.doesNotMatch(thrown.message, /secret-token|user@example\.com/u);
  });

  it("fails closed when the hosted effects port is missing callback journal methods", async () => {
    let observedDispatchHooks:
      | {
          clearPreparedIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<void>;
          prepareDispatchIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<void>;
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const effectsPort = createHostedRuntimeEffectsPortStub();
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
    });

    Reflect.deleteProperty(effectsPort, "deletePreparedAssistantDelivery");
    Reflect.deleteProperty(effectsPort, "readAssistantDeliveryRecord");
    Reflect.deleteProperty(effectsPort, "writeAssistantDeliveryRecord");

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_missing_callbacks",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort,
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);

    await expect(
      observedDispatchHooks.clearPreparedIntent({
        intent: {
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toThrow(/side-effect journal DELETE failed/u);

    await expect(
      observedDispatchHooks.prepareDispatchIntent({
        intent: {
          channel: "telegram",
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
          lastAttemptAt: "2026-04-08T00:00:00.000Z",
          message: "missing hooks",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toThrow(/side-effect journal PUT failed/u);

    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toThrow(/side-effect journal GET failed/u);

    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          dedupeKey: "dedupe_123",
          delivery: {
            channel: "email",
            idempotencyKey: "idem_123",
            messageLength: 5,
            providerMessageId: "provider_message_123",
            providerThreadId: null,
            sentAt: "2026-04-08T00:01:00.000Z",
            target: "user@example.com",
            targetKind: "explicit",
          },
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toThrow(/side-effect journal GET failed/u);

    assert.deepEqual(preparedRecord.state, "prepared");
  });

  it("preserves hosted journal HTTP status codes on retryable delivery confirmation failures", async () => {
    let observedDispatchHooks:
      | {
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const upstreamError = new Error("Hosted side-effect read failed with HTTP 503.") as Error & {
      status: number;
    };
    upstreamError.status = 503;

    mocks.dispatchAssistantOutboxIntent.mockImplementation(async (input) => {
      observedDispatchHooks = input.dispatchHooks;
    });

    await drainHostedCommittedAssistantDeliveriesAfterCommit({
      dispatch: {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_123",
        },
        eventId: "evt_journal_status",
        occurredAt: "2026-04-08T00:00:00.000Z",
      },
      effectsPort: createHostedRuntimeEffectsPortStub({
        async readAssistantDeliveryRecord() {
          throw upstreamError;
        },
      }),
      assistantDeliveryEffects: [
        buildHostedAssistantDeliverySideEffect({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
        }),
      ],
      vaultRoot: "/tmp/vault",
    });

    assert.ok(observedDispatchHooks);
    await expect(
      observedDispatchHooks.resolveDeliveredIntent({
        intent: {
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_SIDE_EFFECT_JOURNAL_FAILED",
      context: {
        retryable: true,
        status: 503,
      },
    });
  });
});
