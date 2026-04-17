import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionAssistantCronTickDispatch,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  buildHostedAssistantDeliveryFailedRecord,
  buildHostedAssistantDeliverySendingRecord,
  buildHostedAssistantDeliverySentRecord,
  type HostedAssistantDeliveryPayload,
  type HostedAssistantDeliveryRecord,
} from "@murphai/hosted-execution/side-effects";

const mocks = vi.hoisted(() => ({
  beginAssistantOutboxIntentMirrorDispatch: vi.fn(),
  createAssistantDeliveryAmbiguousError: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  errorImpliesAssistantDeliveryMayHaveSucceeded: vi.fn(),
  isAssistantOutboxRetryableError: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  markAssistantOutboxIntentMirrorRetryableById: vi.fn(),
  markAssistantOutboxIntentMirrorTerminalById: vi.fn(),
  markAssistantOutboxIntentSentById: vi.fn(),
  normalizeAssistantDeliveryError: vi.fn(),
  saveAssistantSession: vi.fn(),
  sendAssistantOutboxPayload: vi.fn(),
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
  beginAssistantOutboxIntentMirrorDispatch:
    mocks.beginAssistantOutboxIntentMirrorDispatch,
  createAssistantDeliveryAmbiguousError:
    mocks.createAssistantDeliveryAmbiguousError,
  errorImpliesAssistantDeliveryMayHaveSucceeded:
    mocks.errorImpliesAssistantDeliveryMayHaveSucceeded,
  isAssistantOutboxRetryableError: mocks.isAssistantOutboxRetryableError,
  listAssistantOutboxIntents: mocks.listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorRetryableById:
    mocks.markAssistantOutboxIntentMirrorRetryableById,
  markAssistantOutboxIntentMirrorTerminalById:
    mocks.markAssistantOutboxIntentMirrorTerminalById,
  markAssistantOutboxIntentSentById: mocks.markAssistantOutboxIntentSentById,
  normalizeAssistantDeliveryError: mocks.normalizeAssistantDeliveryError,
  saveAssistantSession: mocks.saveAssistantSession,
  sendAssistantOutboxPayload: mocks.sendAssistantOutboxPayload,
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

const HOSTED_DISPATCH = {
  dispatch: buildHostedExecutionAssistantCronTickDispatch({
    eventId: "evt_123",
    occurredAt: "2026-04-08T00:00:00.000Z",
    reason: "manual",
    userId: "member_123",
  }),
  vaultRoot: "/tmp/hosted-vault",
} as const;

function createPayload(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
): HostedAssistantDeliveryPayload {
  return {
    actorId: "actor_123",
    bindingDeliveryKind: "participant",
    bindingDeliveryTarget: "chat_123",
    channel: "telegram",
    explicitTarget: null,
    idempotencyKey: "assistant-outbox:intent_123",
    identityId: "identity_123",
    message: "hello from hosted",
    subject: null,
    replyToMessageId: null,
    sessionId: "session_123",
    threadId: "thread_123",
    threadIsDirect: true,
    transportIdempotent: false,
    turnId: "turn_123",
    ...overrides,
  };
}

function createEffect(
  overrides: Partial<HostedAssistantDeliveryPayload> = {},
) {
  return buildHostedAssistantDeliveryEffect({
    dedupeKey: "dedupe_123",
    effectId: "intent_123",
    payload: createPayload(overrides),
  });
}

function createDelivery(overrides: Record<string, unknown> = {}) {
  return {
    channel: "telegram",
    idempotencyKey: "assistant-outbox:intent_123",
    messageLength: 17,
    providerMessageId: "provider_123",
    providerThreadId: "thread_123",
    sentAt: "2026-04-08T00:01:00.000Z",
    target: "chat_123",
    targetKind: "participant" as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAssistantDeliveryAmbiguousError.mockImplementation((cause?: { message?: string }) => ({
    code: "ASSISTANT_DELIVERY_AMBIGUOUS",
    message: cause?.message ?? "ambiguous",
    retryable: false,
  }));
  mocks.errorImpliesAssistantDeliveryMayHaveSucceeded.mockReturnValue(false);
  mocks.isAssistantOutboxRetryableError.mockReturnValue(false);
  mocks.normalizeAssistantDeliveryError.mockImplementation((error: Error & { code?: string | null }) => ({
    code: error.code ?? null,
    message: error.message,
  }));
  mocks.shouldDispatchAssistantOutboxIntent.mockReturnValue(true);
});

describe("hosted runtime callbacks", () => {
  it("rebuilds committed resume state from the request payload", () => {
    const sideEffect = createEffect();

    const resumed = resumeHostedCommittedExecution({
      bundle: "bundle_123",
      dispatch: HOSTED_DISPATCH.dispatch,
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
    assert.deepEqual(resumed.committedAssistantDeliveryEffects, [sideEffect]);
  });

  it("collects dispatchable effects with the committed payload contract", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "participant", target: "chat_1" },
        channel: "telegram",
        dedupeKey: "dedupe_1",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "identity_1",
        intentId: "intent_1",
        message: "hello 1",
        replyToMessageId: null,
        sessionId: "session_1",
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);

    const sideEffects = await collectHostedAssistantDeliverySideEffects("/tmp/vault");

    expect(sideEffects).toEqual([
      buildHostedAssistantDeliveryEffect({
        dedupeKey: "dedupe_1",
        effectId: "intent_1",
        payload: {
          actorId: "actor_1",
          bindingDeliveryKind: "participant",
          bindingDeliveryTarget: "chat_1",
          channel: "telegram",
          explicitTarget: null,
          idempotencyKey: "assistant-outbox:intent_1",
          identityId: "identity_1",
          message: "hello 1",
          subject: null,
          replyToMessageId: null,
          sessionId: "session_1",
          threadId: "thread_1",
          threadIsDirect: true,
          transportIdempotent: false,
          turnId: "turn_1",
        },
      }),
    ]);
  });

  it("rejects hosted email participant routes before collecting committed delivery effects", async () => {
    mocks.listAssistantOutboxIntents.mockResolvedValue([
      {
        actorId: "actor_1",
        bindingDelivery: { kind: "participant", target: "user@example.com" },
        channel: "email",
        dedupeKey: "dedupe_email_participant",
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        explicitTarget: null,
        identityId: "assistant@example.com",
        intentId: "intent_email_participant",
        message: "hello 1",
        replyToMessageId: null,
        sessionId: "session_1",
        subject: null,
        threadId: "thread_1",
        threadIsDirect: true,
        turnId: "turn_1",
      },
    ]);

    await expect(
      collectHostedAssistantDeliverySideEffects("/tmp/vault"),
    ).rejects.toMatchObject({
      code: "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
    });
  });

  it("returns sent without re-sending when the journal already has a sent record", async () => {
    const effect = createEffect();
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async readAssistantDeliveryRecord() {
        return buildHostedAssistantDeliverySentRecord({
          dedupeKey: effect.fingerprint,
          delivery: createDelivery(),
          effectId: effect.effectId,
        });
      },
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      dispatch: HOSTED_DISPATCH.dispatch,
      effectsPort,
      vaultRoot: HOSTED_DISPATCH.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sent",
        effectId: effect.effectId,
        retryable: false,
      }),
    ]);
    expect(mocks.sendAssistantOutboxPayload).not.toHaveBeenCalled();
    expect(mocks.markAssistantOutboxIntentSentById).toHaveBeenCalledTimes(1);
  });

  it("waits on an in-flight sending journal record instead of sending again", async () => {
    const effect = createEffect();
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async readAssistantDeliveryRecord() {
        return buildHostedAssistantDeliverySendingRecord({
          attempt: {
            channel: "telegram",
            idempotencyKey: effect.payload.idempotencyKey,
            messageLength: effect.payload.message.length,
            providerMessageId: null,
            providerThreadId: null,
            startedAt: new Date().toISOString(),
            target: "chat_123",
            targetKind: "participant",
          },
          dedupeKey: effect.fingerprint,
          effectId: effect.effectId,
        });
      },
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      dispatch: HOSTED_DISPATCH.dispatch,
      effectsPort,
      vaultRoot: HOSTED_DISPATCH.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "sending",
        retryable: true,
      }),
    ]);
    expect(mocks.sendAssistantOutboxPayload).not.toHaveBeenCalled();
  });

  it("does not resend non-idempotent effects after the journal already recorded failed", async () => {
    const effect = createEffect({ transportIdempotent: false });
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async readAssistantDeliveryRecord() {
        return buildHostedAssistantDeliveryFailedRecord({
          attempt: {
            channel: "telegram",
            idempotencyKey: effect.payload.idempotencyKey,
            messageLength: effect.payload.message.length,
            providerMessageId: null,
            providerThreadId: null,
            startedAt: "2026-04-08T00:00:00.000Z",
            target: "chat_123",
            targetKind: "participant",
          },
          dedupeKey: effect.fingerprint,
          effectId: effect.effectId,
          failure: {
            code: "ASSISTANT_DELIVERY_FAILED",
            failedAt: "2026-04-08T00:01:00.000Z",
            message: "telegram rejected the message",
          },
        });
      },
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      dispatch: HOSTED_DISPATCH.dispatch,
      effectsPort,
      vaultRoot: HOSTED_DISPATCH.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryErrorCode: "ASSISTANT_DELIVERY_FAILED",
        deliveryStatus: "failed",
        retryable: false,
      }),
    ]);
    expect(mocks.sendAssistantOutboxPayload).not.toHaveBeenCalled();
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: effect.effectId,
        status: "failed",
        vault: HOSTED_DISPATCH.vaultRoot,
      }),
    );
  });

  it("ages a stale non-idempotent sending record into terminal ambiguity", async () => {
    const effect = createEffect({ transportIdempotent: false });
    const writes: HostedAssistantDeliveryRecord[] = [];
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async readAssistantDeliveryRecord() {
        return buildHostedAssistantDeliverySendingRecord({
          attempt: {
            channel: effect.payload.channel,
            idempotencyKey: effect.payload.idempotencyKey,
            messageLength: effect.payload.message.length,
            providerMessageId: null,
            providerThreadId: null,
            startedAt: "2026-04-08T00:00:00.000Z",
            target: effect.payload.bindingDeliveryTarget,
            targetKind: "participant",
          },
          dedupeKey: effect.fingerprint,
          effectId: effect.effectId,
        });
      },
      async writeAssistantDeliveryRecord(record) {
        writes.push(record);
        return record;
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:10:00.000Z"));

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      dispatch: HOSTED_DISPATCH.dispatch,
      effectsPort,
      vaultRoot: HOSTED_DISPATCH.vaultRoot,
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        deliveryStatus: "failed_ambiguous",
        retryable: false,
      }),
    ]);
    expect(writes.at(-1)).toEqual(
      expect.objectContaining({
        state: "failed_ambiguous",
      }),
    );
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: effect.effectId,
        status: "abandoned",
        vault: HOSTED_DISPATCH.vaultRoot,
      }),
    );
    vi.useRealTimers();
  });

  it("sends fresh effects directly from the committed payload and journals the sent receipt", async () => {
    const effect = createEffect();
    const writes: HostedAssistantDeliveryRecord[] = [];
    mocks.sendAssistantOutboxPayload.mockResolvedValue({
      delivery: createDelivery(),
      deliveryDeduplicated: false,
      outboxIntentId: null,
      session: undefined,
    });
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async writeAssistantDeliveryRecord(record) {
        writes.push(record);
        return record;
      },
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      dispatch: HOSTED_DISPATCH.dispatch,
      effectsPort,
      vaultRoot: HOSTED_DISPATCH.vaultRoot,
    });

    expect(mocks.sendAssistantOutboxPayload).toHaveBeenCalledWith({
      dependencies: expect.any(Object),
      payload: {
        actorId: effect.payload.actorId,
        bindingDelivery: { kind: "participant", target: "chat_123" },
        channel: effect.payload.channel,
        deliveryIdempotencyKey: effect.payload.idempotencyKey,
        explicitTarget: effect.payload.explicitTarget,
        identityId: effect.payload.identityId,
        message: effect.payload.message,
        replyToMessageId: effect.payload.replyToMessageId,
        sessionId: effect.payload.sessionId,
        subject: effect.payload.subject,
        threadId: effect.payload.threadId,
        threadIsDirect: effect.payload.threadIsDirect,
        turnId: effect.payload.turnId,
      },
      vault: HOSTED_DISPATCH.vaultRoot,
    });
    expect(writes.map((record) => record.state)).toEqual(["sending", "sent"]);
    expect(mocks.beginAssistantOutboxIntentMirrorDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.markAssistantOutboxIntentSentById).toHaveBeenCalledTimes(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "sent",
        retryable: false,
      }),
    );
  });

  it("rejects hosted email participant routes before journaling or sending", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "participant",
      bindingDeliveryTarget: "user@example.com",
      channel: "email",
      explicitTarget: null,
      identityId: "assistant@example.com",
    });
    const writeAssistantDeliveryRecord = vi.fn(async (record: HostedAssistantDeliveryRecord) => record);
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async writeAssistantDeliveryRecord(record) {
        return await writeAssistantDeliveryRecord(record);
      },
    });

    await expect(
      drainHostedCommittedAssistantDeliveriesAfterCommit({
        assistantDeliveryEffects: [effect],
        dispatch: HOSTED_DISPATCH.dispatch,
        effectsPort,
        vaultRoot: HOSTED_DISPATCH.vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
    });
    expect(writeAssistantDeliveryRecord).not.toHaveBeenCalled();
    expect(mocks.sendAssistantOutboxPayload).not.toHaveBeenCalled();
  });

  it("marks non-idempotent ambiguous send failures terminal without auto-retry", async () => {
    const effect = createEffect({ transportIdempotent: false });
    const writes: HostedAssistantDeliveryRecord[] = [];
    const ambiguousError = Object.assign(new Error("telegram timeout"), {
      code: "ASSISTANT_DELIVERY_TIMEOUT",
    });
    mocks.errorImpliesAssistantDeliveryMayHaveSucceeded.mockReturnValue(true);
    mocks.sendAssistantOutboxPayload.mockRejectedValue(ambiguousError);
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async writeAssistantDeliveryRecord(record) {
        writes.push(record);
        return record;
      },
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      dispatch: HOSTED_DISPATCH.dispatch,
      effectsPort,
      vaultRoot: HOSTED_DISPATCH.vaultRoot,
    });

    expect(writes.map((record) => record.state)).toEqual(["sending", "failed_ambiguous"]);
    expect(mocks.markAssistantOutboxIntentMirrorTerminalById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: effect.effectId,
        status: "abandoned",
      }),
    );
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "failed_ambiguous",
        retryable: false,
      }),
    );
  });

  it("keeps idempotent failures retryable and records a non-terminal failed journal state", async () => {
    const effect = createEffect({
      bindingDeliveryKind: "thread",
      bindingDeliveryTarget: "thread_123",
      channel: "linq",
      explicitTarget: "thread_123",
      transportIdempotent: true,
    });
    const writes: HostedAssistantDeliveryRecord[] = [];
    const retryableError = Object.assign(new Error("linq temporarily unavailable"), {
      code: "ASSISTANT_DELIVERY_UNAVAILABLE",
    });
    mocks.isAssistantOutboxRetryableError.mockReturnValue(true);
    mocks.sendAssistantOutboxPayload.mockRejectedValue(retryableError);
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async writeAssistantDeliveryRecord(record) {
        writes.push(record);
        return record;
      },
    });

    const outcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
      assistantDeliveryEffects: [effect],
      dispatch: HOSTED_DISPATCH.dispatch,
      effectsPort,
      vaultRoot: HOSTED_DISPATCH.vaultRoot,
    });

    expect(writes.map((record) => record.state)).toEqual(["sending", "failed"]);
    expect(mocks.markAssistantOutboxIntentMirrorRetryableById).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: effect.effectId,
      }),
    );
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        deliveryStatus: "retryable",
        retryable: true,
      }),
    );
  });

  it("throws a hosted journal error when the journal read fails", async () => {
    const effect = createEffect();
    const effectsPort = createHostedRuntimeEffectsPortStub({
      async readAssistantDeliveryRecord() {
        throw Object.assign(new Error("boom"), { status: 503 });
      },
    });

    await expect(
      drainHostedCommittedAssistantDeliveriesAfterCommit({
        assistantDeliveryEffects: [effect],
        dispatch: HOSTED_DISPATCH.dispatch,
        effectsPort,
        vaultRoot: HOSTED_DISPATCH.vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_SIDE_EFFECT_JOURNAL_FAILED",
    });
  });
});
