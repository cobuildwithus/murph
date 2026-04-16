import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySentRecord,
  buildHostedAssistantDeliverySideEffect,
} from "@murphai/hosted-execution/side-effects";

const mocks = vi.hoisted(() => ({
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
  mocks.normalizeAssistantDeliveryError.mockImplementation((error: Error) => ({
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

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "assistant-delivery",
      details: {
        assistantDeliveryBoundary: "hosted_runtime_finalize",
        deliveryErrorCode: "LINQ_SEND_FAILED",
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
      message: "Linq outbound chat creation failed with HTTP 403.",
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
        providerMessageId: "linq_message_123",
        providerThreadId: "chat_123",
        retryable: false,
        target: "chat_123",
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

  it("writes prepared and sent delivery records through the hosted side-effect journal hooks", async () => {
    let observedDispatchHooks:
      | {
          prepareDispatchIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<void>;
          resolveDeliveredIntent(args: { intent: Record<string, unknown>; vault: string }): Promise<unknown>;
        }
      | undefined;
    const writes: object[] = [];
    const preparedRecord = buildHostedAssistantDeliveryPreparedRecord({
      dedupeKey: "dedupe_123",
      effectId: "intent_123",
      recordedAt: "2026-04-08T00:00:00.000Z",
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
        dedupeKey: "dedupe_123",
        intentId: "intent_123",
        lastAttemptAt: "2026-04-08T00:00:00.000Z",
      },
      vault: "/tmp/vault",
    });
    assert.deepEqual(writes[0], preparedRecord);

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
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
        },
        vault: "/tmp/vault",
      });
      assert.deepEqual(writes, [
        buildHostedAssistantDeliveryPreparedRecord({
          dedupeKey: "dedupe_123",
          effectId: "intent_123",
          recordedAt: "2026-04-08T02:03:04.000Z",
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

  it("clears prepared delivery records through the hosted side-effect journal hooks", async () => {
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
  });

  it("reconciles delivered intents from the local record when the journal is still prepared", async () => {
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
        deliveryIdempotencyKey: "idem_fallback",
        intentId: "intent_123",
      },
      vault: "/tmp/vault",
    });

    assert.deepEqual(resolved, {
      channel: "email",
      idempotencyKey: "idem_fallback",
      messageLength: 5,
      providerMessageId: "provider_message_123",
      providerThreadId: null,
      sentAt: "2026-04-08T00:01:00.000Z",
      target: "user@example.com",
      targetKind: "explicit",
    });
    assert.deepEqual(writes, [
      buildHostedAssistantDeliverySentRecord({
        dedupeKey: "dedupe_123",
        delivery: {
          channel: "email",
          idempotencyKey: "idem_fallback",
          messageLength: 5,
          providerMessageId: "provider_message_123",
          providerThreadId: null,
          sentAt: "2026-04-08T00:01:00.000Z",
          target: "user@example.com",
          targetKind: "explicit",
        },
        effectId: "intent_123",
      }),
    ]);
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
          dedupeKey: "dedupe_123",
          intentId: "intent_123",
          lastAttemptAt: "2026-04-08T00:00:00.000Z",
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
