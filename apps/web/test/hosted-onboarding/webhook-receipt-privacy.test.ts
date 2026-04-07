import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import { Prisma } from "@prisma/client";
import type {
  HostedExecutionOutboxPayload,
} from "../../src/lib/hosted-execution/outbox-payload";

const {
  deleteHostedStoredDispatchPayloadBestEffort,
  maybeStageHostedExecutionDispatchPayload,
} = vi.hoisted(() => ({
  deleteHostedStoredDispatchPayloadBestEffort: vi.fn(),
  maybeStageHostedExecutionDispatchPayload: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  Prisma: {
    DbNull: null,
    JsonNull: null,
  },
}));

vi.mock("@murphai/hosted-execution", () => ({
  parseHostedExecutionDispatchRequest: (value: unknown) => {
    if (!looksLikeDispatchRequest(value)) {
      throw new TypeError("Hosted execution dispatch request is invalid.");
    }

    return cloneJson(value);
  },
  readHostedExecutionOutboxPayload: (value: unknown) => {
    if (!looksLikeReferenceOutboxPayload(value)) {
      return null;
    }

    return cloneJson(value);
  },
}));

vi.mock("../../src/lib/hosted-execution/control", () => ({
  deleteHostedStoredDispatchPayloadBestEffort,
  maybeStageHostedExecutionDispatchPayload,
}));

vi.mock("../../src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedOpaqueIdentifier: (kind: string, value: string | number | null | undefined) =>
    value === null || value === undefined
      ? null
      : `opaque:${kind}:${String(value)}`,
}));

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
  stageHostedWebhookDispatchSideEffectPayload,
} from "../../src/lib/hosted-onboarding/webhook-dispatch-payload";
import {
  queueHostedWebhookReceiptSideEffects,
} from "../../src/lib/hosted-onboarding/webhook-receipt-store";
import {
  createHostedWebhookDispatchSideEffect,
  type HostedWebhookReceiptClaim,
  type HostedWebhookReceiptState,
  type HostedWebhookSideEffect,
} from "../../src/lib/hosted-onboarding/webhook-receipt-types";

describe("hosted webhook receipt privacy cutover", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("stages dispatch side effects into reference-only Cloudflare payload refs", async () => {
    const dispatch = createSensitiveDispatch();
    const referencePayload = createReferencePayload(dispatch, "staged/dispatch-1");
    maybeStageHostedExecutionDispatchPayload.mockResolvedValue(referencePayload);

    const pendingEffect = createHostedWebhookDispatchSideEffect({ dispatch });
    const stagedPayload = await stageHostedWebhookDispatchSideEffectPayload(pendingEffect.payload);

    expect(stagedPayload).toEqual(referencePayload);
    expect(maybeStageHostedExecutionDispatchPayload).toHaveBeenCalledWith(dispatch);
  });

  it("fails closed when a dispatch side effect reaches receipt JSON before staging", () => {
    const dispatch = createSensitiveDispatch();
    const pendingEffect = createHostedWebhookDispatchSideEffect({ dispatch });

    expect(() =>
      serializeHostedWebhookReceiptSideEffect(pendingEffect),
    ).toThrowError(/must be staged/i);
  });

  it("fails closed when Cloudflare staging is unavailable for a reference-only dispatch", async () => {
    const dispatch = createSensitiveDispatch();
    const pendingEffect = createHostedWebhookDispatchSideEffect({ dispatch });
    maybeStageHostedExecutionDispatchPayload.mockResolvedValue(null);

    await expect(stageHostedWebhookDispatchSideEffectPayload(pendingEffect.payload)).rejects.toMatchObject({
      code: "HOSTED_WEBHOOK_DISPATCH_PAYLOAD_REF_REQUIRED",
      name: "HostedOnboardingError",
    });
  });

  it("cleans up newly staged payloads when receipt persistence fails", async () => {
    const dispatch = createSensitiveDispatch();
    const referencePayload = createReferencePayload(dispatch, "staged/dispatch-cleanup");
    maybeStageHostedExecutionDispatchPayload.mockResolvedValue(referencePayload);

    const claimedReceipt: HostedWebhookReceiptClaim = {
      eventId: dispatch.eventId,
      source: "linq",
      state: createReceiptState({ sideEffects: [] }),
      version: 1,
    };
    const prisma = {
      hostedWebhookReceipt: {
        updateMany: vi.fn(async () => {
          throw new Error("receipt write failed");
        }),
      },
    };

    await expect(queueHostedWebhookReceiptSideEffects({
      claimedReceipt,
      desiredSideEffects: [createHostedWebhookDispatchSideEffect({ dispatch })],
      eventId: dispatch.eventId,
      // @ts-expect-error Minimal receipt persistence stub for cleanup-path coverage.
      prisma,
      source: "linq",
    })).rejects.toThrow("receipt write failed");

    expect(deleteHostedStoredDispatchPayloadBestEffort).toHaveBeenCalledWith(referencePayload);
  });

  it("cleans up already staged payloads when a later staging step fails", async () => {
    const firstDispatch = createSensitiveDispatch();
    const secondDispatch = {
      ...createSensitiveDispatch(),
      eventId: "linq-event-456",
    };
    const firstReferencePayload = createReferencePayload(firstDispatch, "staged/dispatch-first");
    maybeStageHostedExecutionDispatchPayload
      .mockResolvedValueOnce(firstReferencePayload)
      .mockResolvedValueOnce(null);

    const claimedReceipt: HostedWebhookReceiptClaim = {
      eventId: firstDispatch.eventId,
      source: "linq",
      state: createReceiptState({ sideEffects: [] }),
      version: 1,
    };
    const prisma = {
      hostedWebhookReceipt: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    await expect(queueHostedWebhookReceiptSideEffects({
      claimedReceipt,
      desiredSideEffects: [
        createHostedWebhookDispatchSideEffect({ dispatch: firstDispatch }),
        createHostedWebhookDispatchSideEffect({ dispatch: secondDispatch }),
      ],
      eventId: firstDispatch.eventId,
      // @ts-expect-error Minimal receipt persistence stub for cleanup-path coverage.
      prisma,
      source: "linq",
    })).rejects.toMatchObject({
      code: "HOSTED_WEBHOOK_DISPATCH_PAYLOAD_REF_REQUIRED",
      name: "HostedOnboardingError",
    });

    expect(deleteHostedStoredDispatchPayloadBestEffort).toHaveBeenCalledWith(firstReferencePayload);
    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
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
          dispatchPayloadJson: {
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
          effectId: "dispatch:legacy",
          kind: "hosted_execution_dispatch",
          lastAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          linqChatId: null,
          linqInviteId: null,
          linqReplyToMessageId: null,
          linqResultChatId: null,
          linqResultMessageId: null,
          linqTemplate: null,
          revnetAmountPaid: null,
          revnetChargeId: null,
          revnetCurrency: null,
          revnetInvoiceId: null,
          revnetMemberId: null,
          revnetPaymentIntentId: null,
          revnetResultHandled: null,
          sentAt: null,
          status: "pending",
        }],
      }),
    ).toThrowError(/invalid or legacy payload shape/i);
  });

  it("serializes staged dispatch side effects without leaking message content into receipt storage", () => {
    const dispatch = createSensitiveDispatch();
    const stagedEffect = {
      ...createHostedWebhookDispatchSideEffect({ dispatch }),
      payload: createReferencePayload(dispatch, "dispatch/staged-2"),
    };

    const serialized = serializeHostedWebhookReceiptStateRecords(
      createReceiptState({
        sideEffects: [stagedEffect],
      }),
    );
    const serializedText = JSON.stringify(serialized);
    const roundTripped = readHostedWebhookReceiptState(serialized);

    expect(serializedText).toContain("dispatch/staged-2");
    expect(serializedText).not.toContain("super secret hello from linq");
    expect(serializedText).not.toContain("hbidx:phone:v1:sensitive-phone-key");
    expect(readHostedWebhookReceiptDispatchByEventId(roundTripped, dispatch.eventId)).toBeNull();
    expect(buildHostedWebhookDispatchFromPayload(stagedEffect.payload)).toBeNull();
    expect(roundTripped.sideEffects).toEqual([
      expect.objectContaining({
        effectId: stagedEffect.effectId,
        kind: "hosted_execution_dispatch",
        payload: stagedEffect.payload,
      }),
    ]);
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

function createReferencePayload(
  dispatch: ReturnType<typeof createSensitiveDispatch>,
  stagedPayloadId: string,
): HostedExecutionOutboxPayload {
  return {
    dispatchRef: {
      eventId: dispatch.eventId,
      eventKind: "linq.message.received" as const,
      occurredAt: dispatch.occurredAt,
      userId: dispatch.event.userId,
    },
    stagedPayloadId,
    storage: "reference" as const,
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
  const dispatchPayloadJson: Prisma.InputJsonValue | null =
    effect.dispatchPayloadJson === Prisma.DbNull
      ? null
      : effect.dispatchPayloadJson as Prisma.InputJsonValue;

  return {
    effectId,
    ...effect,
    dispatchPayloadJson,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function looksLikeDispatchRequest(value: unknown): value is {
  event: {
    kind: string;
    userId: string;
  };
  eventId: string;
  occurredAt: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const dispatch = value as Record<string, unknown>;
  const event = dispatch.event;

  return typeof dispatch.eventId === "string"
    && typeof dispatch.occurredAt === "string"
    && !!event
    && typeof event === "object"
    && !Array.isArray(event)
    && typeof (event as Record<string, unknown>).kind === "string"
    && typeof (event as Record<string, unknown>).userId === "string";
}

function looksLikeReferenceOutboxPayload(value: unknown): value is {
  dispatchRef: {
    eventId: string;
    eventKind: string;
    userId: string;
  };
  stagedPayloadId: string;
  storage: "reference";
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const dispatchRef = payload.dispatchRef;
  const stagedPayloadId = payload.stagedPayloadId;

  return payload.storage === "reference"
    && !!dispatchRef
    && typeof dispatchRef === "object"
    && !Array.isArray(dispatchRef)
    && typeof (dispatchRef as Record<string, unknown>).eventId === "string"
    && typeof (dispatchRef as Record<string, unknown>).eventKind === "string"
    && typeof (dispatchRef as Record<string, unknown>).userId === "string"
    && typeof stagedPayloadId === "string";
}
