import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import { Prisma } from "@prisma/client";

const {
  claimHostedWebhookReceiptForContinuation,
  continueHostedWebhookReceipt,
  createHostedWebhookReceiptHandlers,
  listHostedWebhookReceiptContinuationCandidates,
} = vi.hoisted(() => ({
  claimHostedWebhookReceiptForContinuation: vi.fn(),
  continueHostedWebhookReceipt: vi.fn(),
  createHostedWebhookReceiptHandlers: vi.fn(),
  listHostedWebhookReceiptContinuationCandidates: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  Prisma: {
    DbNull: null,
    JsonNull: null,
  },
}));

vi.mock("../../src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutboxBestEffort: vi.fn(),
}));

vi.mock("../../src/lib/hosted-onboarding/linq", () => ({
  requireHostedLinqMessageReceivedEvent: vi.fn(),
  verifyAndParseHostedLinqWebhookRequest: vi.fn(),
}));

vi.mock("../../src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeWebhookVerificationConfig: vi.fn(),
}));

vi.mock("../../src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  recordHostedStripeEvent: vi.fn(),
  reconcileHostedStripeEventById: vi.fn(),
}));

vi.mock("../../src/lib/hosted-onboarding/stripe-revnet-issuance", () => ({
  drainHostedRevnetIssuanceSubmissionQueue: vi.fn(),
}));

vi.mock("../../src/lib/hosted-onboarding/telegram", () => ({
  assertHostedTelegramWebhookSecret: vi.fn(),
  buildHostedTelegramWebhookEventId: vi.fn(),
  parseHostedTelegramWebhookUpdate: vi.fn(),
}));

vi.mock("../../src/lib/hosted-onboarding/webhook-provider-linq", () => ({
  planHostedOnboardingLinqWebhook: vi.fn(),
}));

vi.mock("../../src/lib/hosted-onboarding/webhook-provider-telegram", () => ({
  planHostedOnboardingTelegramWebhook: vi.fn(),
}));

vi.mock("../../src/lib/hosted-onboarding/webhook-receipts", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/hosted-onboarding/webhook-receipts")
  >("../../src/lib/hosted-onboarding/webhook-receipts");

  return {
    ...actual,
    claimHostedWebhookReceiptForContinuation,
    continueHostedWebhookReceipt,
    listHostedWebhookReceiptContinuationCandidates,
  };
});

vi.mock("../../src/lib/hosted-onboarding/webhook-transport", () => ({
  createHostedWebhookReceiptHandlers,
}));

vi.mock("../../src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in webhook-receipt-privacy.test.ts");
  }),
}));

vi.mock("../../src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedOpaqueIdentifier: (kind: string, value: string | number | null | undefined) =>
    value === null || value === undefined
      ? null
      : `opaque:${kind}:${String(value)}`,
}));

import {
  HOSTED_ONBOARDING_REDACTED_ERROR_MESSAGE,
  sanitizeHostedOnboardingLogString,
} from "../../src/lib/hosted-onboarding/http";
import {
  buildHostedWebhookDispatchFromPayload,
  readHostedWebhookReceiptDispatchByEventId,
} from "../../src/lib/hosted-onboarding/webhook-receipt-dispatch";
import {
  readHostedWebhookReceiptState,
  serializeHostedWebhookReceiptErrorState,
  serializeHostedWebhookReceiptSideEffect,
} from "../../src/lib/hosted-onboarding/webhook-receipt-codec";
import {
  createHostedWebhookDispatchSideEffect,
  createHostedWebhookLinqMessageSideEffect,
  type HostedWebhookReceiptState,
  type HostedWebhookSideEffect,
} from "../../src/lib/hosted-onboarding/webhook-receipt-types";
import {
  drainHostedOnboardingWebhookReceipts,
} from "../../src/lib/hosted-onboarding/webhook-service";

describe("hosted webhook receipt privacy baseline", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates inline canonical outbox payloads immediately for dispatch side effects", () => {
    const dispatch = createSensitiveDispatch();
    const inlineEffect = createHostedWebhookDispatchSideEffect({ dispatch });

    expect(inlineEffect.payload).toEqual({
      dispatch,
      storage: "inline",
    });
    expect(buildHostedWebhookDispatchFromPayload(inlineEffect.payload)).toEqual(dispatch);
  });

  it("serializes freshly created dispatch side effects without a staging pass", () => {
    const dispatch = createSensitiveDispatch();
    const inlineEffect = createHostedWebhookDispatchSideEffect({ dispatch });

    expect(serializeHostedWebhookReceiptSideEffect(inlineEffect)).toMatchObject({
      payloadJson: {
        dispatch,
        storage: "inline",
      },
    });
  });

  it("fails closed when receipt hydration sees a legacy dispatch snapshot shape", () => {
    expect(() =>
      readHostedWebhookReceiptState({
        receipt: {
          attemptCount: 1,
          attemptId: "attempt_legacy",
          completedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: new Date("2026-04-06T09:00:00.000Z"),
          plannedAt: new Date("2026-04-06T09:00:00.000Z"),
          status: "processing",
        },
        sideEffects: [{
          attemptCount: 0,
          payloadJson: {
            dispatchRef: {
              eventId: "legacy",
              eventKind: "telegram.message.received",
              occurredAt: "2026-04-06T09:00:00.000Z",
              userId: "member_123",
            },
            storage: "reference",
            telegramUpdate: {
              message: {
                text: "legacy plaintext",
              },
            },
          },
          resultJson: null,
          effectId: "dispatch:legacy",
          kind: "hosted_execution_dispatch",
          lastAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          sentAt: null,
          status: "pending",
        }],
      }),
    ).toThrowError(/invalid or legacy payload shape/i);
  });

  it("round-trips inline dispatch payloads when legacy receipt storage still contains them", () => {
    const dispatch = createSensitiveDispatch();
    const payload = createHostedWebhookDispatchSideEffect({ dispatch }).payload;
    const stagedEffect = {
      ...createHostedWebhookDispatchSideEffect({ dispatch }),
      payload,
    };

    const serialized = serializeHostedWebhookReceiptStateRecords(
      createReceiptState({
        sideEffects: [stagedEffect],
      }),
    );
    const serializedText = JSON.stringify(serialized);
    const roundTripped = readHostedWebhookReceiptState(serialized);

    expect(serializedText).toContain("\"storage\":\"inline\"");
    expect(readHostedWebhookReceiptDispatchByEventId(roundTripped, dispatch.eventId)).toEqual(dispatch);
    expect(buildHostedWebhookDispatchFromPayload(stagedEffect.payload)).toEqual(dispatch);
    expect(roundTripped.sideEffects).toEqual([
      expect.objectContaining({
        effectId: stagedEffect.effectId,
        kind: "hosted_execution_dispatch",
        payload: stagedEffect.payload,
      }),
    ]);
  });

  it("serializes receipt-local side effects without introducing dispatch payload storage", () => {
    const linqEffect = createHostedWebhookLinqMessageSideEffect({
      chatId: "chat_123",
      inviteId: "invite_123",
      replyToMessageId: "msg_123",
      sourceEventId: "evt_local",
      template: "invite_signup",
    });

    const serialized = serializeHostedWebhookReceiptStateRecords(
      createReceiptState({
        sideEffects: [linqEffect],
      }),
    );
    const serializedText = JSON.stringify(serialized);

    expect(serializedText).toContain("\"kind\":\"linq_message_send\"");
    expect(serializedText).not.toContain("\"kind\":\"hosted_execution_dispatch\"");
    expect(readHostedWebhookReceiptDispatchByEventId(
      readHostedWebhookReceiptState(serialized),
      "evt_local",
    )).toBeNull();
  });

  it("redacts persisted receipt error messages while keeping sanitized codes and names", () => {
    const serialized = serializeHostedWebhookReceiptErrorState({
      code: "https://example.test/error?token=secret",
      message: "operator@example.test /Users/example/private +15555550123",
      name: "HostedOnboardingError",
      retryable: true,
    });

    expect(serialized).toEqual({
      lastErrorCode: "<redacted-url>",
      lastErrorMessage: HOSTED_ONBOARDING_REDACTED_ERROR_MESSAGE,
      lastErrorName: "HostedOnboardingError",
      lastErrorRetryable: true,
    });
  });

  it("redacts urls, emails, phones, and paths in hosted onboarding log strings", () => {
    expect(
      sanitizeHostedOnboardingLogString(
        "See https://example.test/a?token=secret contact operator@example.test +15555550123 /Users/example/private /app/run/task",
      ),
    ).toBe(
      "See <redacted-url> contact <redacted-email> <redacted-phone> <redacted-path> <redacted-path>",
    );
  });

  it("redacts hosted onboarding console.error output before logging claim failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listHostedWebhookReceiptContinuationCandidates.mockResolvedValue([
      {
        eventId: "evt_sensitive",
        source: "linq",
      },
    ]);
    claimHostedWebhookReceiptForContinuation.mockRejectedValue(
      new Error(
        "Failed to read https://example.test/a?token=secret from operator@example.test at +15555550123 /Users/example/private",
      ),
    );

    await expect(drainHostedOnboardingWebhookReceipts({
      prisma: {
        prisma: true,
      } as never,
    })).resolves.toEqual([
      {
        eventId: "evt_sensitive",
        source: "linq",
        status: "failed",
      },
    ]);

    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted webhook receipt claim failed during cron recovery.",
      "Failed to read <redacted-url> from <redacted-email> at <redacted-phone> <redacted-path>",
    );
    errorSpy.mockRestore();
  });
});

function createSensitiveDispatch(): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "linq.message.received" as const,
      linqEvent: {
        data: {
          from: "+15555550123",
          message: {
            id: "linq-message-1",
            parts: [
              {
                text: "super secret hello from linq",
                type: "text",
              },
            ],
          },
        },
      },
      phoneLookupKey: "hbidx:phone:v1:sensitive-phone-key",
      userId: "member_123",
    },
    eventId: "linq-event-123",
    occurredAt: "2026-04-06T09:00:00.000Z",
  };
}

function createReceiptState(input: {
  sideEffects: HostedWebhookSideEffect[];
}): HostedWebhookReceiptState {
  return {
    attemptCount: 1,
    attemptId: "attempt_123",
    completedAt: null,
    lastError: null,
    lastReceivedAt: "2026-04-06T09:00:00.000Z",
    plannedAt: "2026-04-06T09:00:00.000Z",
    sideEffects: input.sideEffects,
    status: "processing" as const,
  };
}

function serializeHostedWebhookReceiptStateRecords(
  state: HostedWebhookReceiptState,
): Parameters<typeof readHostedWebhookReceiptState>[0] {
  return {
    receipt: {
      attemptCount: state.attemptCount,
      attemptId: state.attemptId,
      completedAt: state.completedAt ? new Date(state.completedAt) : null,
      ...serializeHostedWebhookReceiptErrorState(state.lastError),
      lastReceivedAt: new Date(state.lastReceivedAt),
      plannedAt: state.plannedAt ? new Date(state.plannedAt) : null,
      status: state.status,
    },
    sideEffects: state.sideEffects.map((effect) =>
      normalizeSerializedSideEffectForRead(effect.effectId, serializeHostedWebhookReceiptSideEffect(effect))
    ),
  };
}

function normalizeSerializedSideEffectForRead(
  effectId: string,
  effect: ReturnType<typeof serializeHostedWebhookReceiptSideEffect>,
): NonNullable<Parameters<typeof readHostedWebhookReceiptState>[0]["sideEffects"]>[number] {
  const {
    resultJson,
    ...rest
  } = effect;

  if (isPrismaDbNull(resultJson)) {
    return {
      effectId,
      ...rest,
      resultJson: null,
    };
  }

  return {
    effectId,
    ...rest,
    resultJson,
  };
}

function isPrismaDbNull(
  value: ReturnType<typeof serializeHostedWebhookReceiptSideEffect>["resultJson"],
): value is typeof Prisma.DbNull {
  return value === Prisma.DbNull;
}
